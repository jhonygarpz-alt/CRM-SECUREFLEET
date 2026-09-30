#!/bin/bash
# Instala o actualiza SecureFleet CRM en Google Cloud (Compute Engine e2-micro, nivel gratuito).
# Ejecútalo en Google Cloud Shell (https://shell.cloud.google.com):
#   bash <(curl -fsSL https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/claude/securefleet-crm-whatsapp-lipfmm/deploy/gcp/instalar.sh)
set -euo pipefail

REPO_URL="https://github.com/jhonygarpz-alt/CRM-SECUREFLEET.git"
BRANCH="${CRM_BRANCH:-claude/securefleet-crm-whatsapp-lipfmm}"
RAW="https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/$BRANCH/deploy/gcp"
NAME="securefleet-crm"
REGION="us-central1"   # región del nivel gratuito de e2-micro
ZONE="us-central1-a"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [ -z "$PROJECT" ]; then
  PROJECTS=$(gcloud projects list --format="value(projectId)" 2>/dev/null || true)
  if [ -n "$PROJECTS" ]; then
    echo "Tus proyectos de Google Cloud:"
    gcloud projects list --format="table(projectId,name)"
    read -rp "Escribe el PROJECT_ID donde instalar el CRM (o Enter para crear uno nuevo): " PROJECT
  fi
  if [ -z "$PROJECT" ]; then
    PROJECT="securefleet-crm-$(openssl rand -hex 3)"
    say "Creando el proyecto $PROJECT…"
    gcloud projects create "$PROJECT" --name "SecureFleet CRM"
  fi
  gcloud config set project "$PROJECT" >/dev/null
fi
say "Proyecto: $PROJECT"

BILLING=$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || echo "?")
if [ "$(echo "$BILLING" | tr '[:upper:]' '[:lower:]')" != "true" ]; then
  ACCOUNTS=$(gcloud billing accounts list --filter=open=true --format="value(name)" 2>/dev/null || true)
  if [ -z "$ACCOUNTS" ]; then
    die "Tu cuenta de Google no tiene una cuenta de facturación. Créala (con tarjeta; la e2-micro es gratuita) en:
   https://console.cloud.google.com/billing/create
Luego vuelve a ejecutar este mismo comando."
  fi
  ACCOUNT=$(echo "$ACCOUNTS" | head -n1)
  if [ "$(echo "$ACCOUNTS" | wc -l)" -gt 1 ]; then
    gcloud billing accounts list --filter=open=true
    read -rp "ID de la cuenta de facturación a usar [$ACCOUNT]: " CHOSEN
    ACCOUNT=${CHOSEN:-$ACCOUNT}
  fi
  say "Vinculando la facturación $ACCOUNT al proyecto…"
  gcloud billing projects link "$PROJECT" --billing-account "${ACCOUNT#billingAccounts/}"
fi

say "Activando Compute Engine (puede tardar 1 minuto)…"
gcloud services enable compute.googleapis.com

STARTUP=$(mktemp)
curl -fsSL "$RAW/startup.sh" -o "$STARTUP"

if gcloud compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1; then
  say "El CRM ya está instalado: actualizando a la última versión…"
  gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file startup-script="$STARTUP" \
    --metadata crm-branch="$BRANCH"
  gcloud compute instances reset "$NAME" --zone "$ZONE" --quiet
  DOMAIN=$(gcloud compute instances describe "$NAME" --zone "$ZONE" --format=json | \
    python3 -c "import sys,json; print(next(i['value'] for i in json.load(sys.stdin)['metadata']['items'] if i['key']=='crm-domain'))")
else
  read -rp "Correo del administrador del CRM: " ADMIN_EMAIL
  while true; do
    read -rsp "Contraseña del administrador (mínimo 8 caracteres): " ADMIN_PASSWORD; echo
    [ ${#ADMIN_PASSWORD} -ge 8 ] && break
    echo "Muy corta, intenta de nuevo."
  done

  say "Reservando IP fija…"
  gcloud compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 || \
    gcloud compute addresses create "$NAME-ip" --region "$REGION" --network-tier STANDARD
  IP=$(gcloud compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)')

  echo
  echo "Si tienes un dominio propio (ej. crm.securefleet.mx) apúntalo con un registro A a $IP y escríbelo aquí."
  read -rp "Dominio (Enter para usar uno gratuito automático): " DOMAIN
  DOMAIN=${DOMAIN:-"${IP//./-}.sslip.io"}

  say "Abriendo puertos web 80/443…"
  gcloud compute firewall-rules describe "$NAME-web" >/dev/null 2>&1 || \
    gcloud compute firewall-rules create "$NAME-web" --allow tcp:80,tcp:443 --target-tags "$NAME" --quiet

  ENVFILE=$(mktemp)
  cat > "$ENVFILE" <<ENV
NODE_ENV=production
PORT=4000
DB_PATH=/data/crm.db
TZ=America/Mexico_City
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
LOAD_CATALOG=1
WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 12)
ENV

  say "Creando el servidor (e2-micro, nivel gratuito)…"
  gcloud compute instances create "$NAME" --zone "$ZONE" --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard \
    --network-tier STANDARD --address "$IP" --tags "$NAME" \
    --metadata-from-file startup-script="$STARTUP",crm-env="$ENVFILE" \
    --metadata crm-repo="$REPO_URL",crm-branch="$BRANCH",crm-domain="$DOMAIN"
  rm -f "$ENVFILE"

  say "Programando respaldo diario del disco (se guardan 7 días)…"
  gcloud compute resource-policies describe "$NAME-backup" --region "$REGION" >/dev/null 2>&1 || \
    gcloud compute resource-policies create snapshot-schedule "$NAME-backup" --region "$REGION" \
      --daily-schedule --start-time 08:00 --max-retention-days 7
  gcloud compute disks add-resource-policies "$NAME" --zone "$ZONE" --resource-policies "$NAME-backup" 2>/dev/null || true
fi

say "Instalando y compilando en el servidor. La primera vez tarda 5-10 minutos…"
for i in $(seq 1 90); do
  if curl -sf --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    printf '\n\033[1;32m✅ SecureFleet CRM está en línea:  https://%s\033[0m\n' "$DOMAIN"
    echo "   Webhook de WhatsApp:  https://$DOMAIN/api/whatsapp/webhook"
    exit 0
  fi
  printf '.'; sleep 10
done
echo
echo "Aún no responde. Revisa el avance con:"
echo "  gcloud compute ssh $NAME --zone $ZONE --command 'sudo tail -n 50 /var/log/securefleet-crm.log'"
echo "Cuando termine, estará en: https://$DOMAIN"
