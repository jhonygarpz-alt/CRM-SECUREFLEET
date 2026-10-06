#!/bin/bash
# Activa el modo "WhatsApp Web" del CRM: se vincula tu WhatsApp Business escaneando un QR
# (Dispositivos vinculados), sin API oficial. Ejecútalo en Google Cloud Shell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/claude/securefleet-crm-whatsapp-lipfmm/deploy/gcp/whatsapp-web.sh)
set -euo pipefail
NAME="securefleet-crm"
ZONE="us-central1-a"

if [ -z "$(gcloud config get-value project 2>/dev/null)" ]; then
  for P in $(gcloud projects list --format="value(projectId)"); do
    if gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$P" >/dev/null 2>&1; then
      gcloud config set project "$P" >/dev/null && echo "Proyecto: $P" && break
    fi
  done
fi

ENV_NOW=$(gcloud compute instances describe "$NAME" --zone "$ZONE" --format=json | python3 -c "
import sys, json
items = json.load(sys.stdin)['metadata']['items']
print(next(i['value'] for i in items if i['key'] == 'crm-env'))")
NEW_ENV=$(echo "$ENV_NOW" | grep -v -E '^WHATSAPP_PROVIDER=')
NEW_ENV+=$'\n'"WHATSAPP_PROVIDER=waweb"
TMP=$(mktemp); chmod 600 "$TMP"; printf '%s\n' "$NEW_ENV" > "$TMP"
gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file crm-env="$TMP"
rm -f "$TMP"

echo "Instalando la versión nueva y activando WhatsApp Web (puede tardar ~10 minutos)…"
gcloud compute ssh "$NAME" --zone "$ZONE" --command 'sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo docker ps --format "{{.Names}}: {{.Status}}"'
echo
echo "✅ Listo. Entra al CRM → Configuración y escanea el código QR con:"
echo "   WhatsApp Business → ⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo"
