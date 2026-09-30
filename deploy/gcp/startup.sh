#!/bin/bash
# Script de arranque de la VM (se ejecuta como root en cada encendido).
# Descarga la última versión del CRM, la compila y la levanta con HTTPS (Caddy).
set -euo pipefail
exec > >(tee -a /var/log/securefleet-crm.log) 2>&1
echo "=== $(date) arranque SecureFleet CRM ==="

md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
REPO=$(md crm-repo)
BRANCH=$(md crm-branch)
DOMAIN=$(md crm-domain)

# Memoria de intercambio: la e2-micro tiene 1 GB y la compilación necesita más.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon /swapfile 2>/dev/null || true

if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y docker.io git
  systemctl enable --now docker
fi

if [ -d /opt/crm/.git ]; then
  git -C /opt/crm fetch --depth 1 origin "$BRANCH"
  git -C /opt/crm reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" /opt/crm
fi

md crm-env > /opt/crm-env
chmod 600 /opt/crm-env
mkdir -p /var/lib/crm-data /opt/crm-caddy
cat > /opt/crm-caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy crm:4000
}
CADDY

docker build -t securefleet-crm /opt/crm
docker network inspect crm >/dev/null 2>&1 || docker network create crm
docker rm -f crm caddy >/dev/null 2>&1 || true
docker run -d --name crm --restart unless-stopped --network crm \
  -v /var/lib/crm-data:/data --env-file /opt/crm-env securefleet-crm
docker run -d --name caddy --restart unless-stopped --network crm \
  -p 80:80 -p 443:443 -v caddy_data:/data -v /opt/crm-caddy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2
docker image prune -f >/dev/null
echo "=== listo: https://$DOMAIN ==="
