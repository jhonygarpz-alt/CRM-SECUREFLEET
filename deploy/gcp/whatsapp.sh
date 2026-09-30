#!/bin/bash
# Configura la app de Meta (WhatsApp) en el servidor del CRM.
# Ejecútalo en Google Cloud Shell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/claude/securefleet-crm-whatsapp-lipfmm/deploy/gcp/whatsapp.sh)
set -euo pipefail
NAME="securefleet-crm"
ZONE="us-central1-a"

get_meta() {
  gcloud compute instances describe "$NAME" --zone "$ZONE" --format=json | python3 -c "
import sys, json
items = json.load(sys.stdin)['metadata']['items']
print(next(i['value'] for i in items if i['key'] == '$1'))"
}

ENV_NOW=$(get_meta crm-env)
DOMAIN=$(get_meta crm-domain)
VERIFY=$(echo "$ENV_NOW" | sed -n 's/^WHATSAPP_VERIFY_TOKEN=//p')

echo "Datos de tu app en developers.facebook.com (los secretos no se muestran al escribir):"
read -rp  "Identificador de la app (App ID): " APP_ID
read -rsp "Clave secreta de la app (Configuración de la app → Básica): " APP_SECRET; echo
read -rp  "ID de configuración del registro integrado (Facebook Login for Business → Configuraciones): " CONFIG_ID
[ -n "$APP_ID" ] && [ -n "$APP_SECRET" ] && [ -n "$CONFIG_ID" ] || { echo "Los tres datos son obligatorios."; exit 1; }

NEW_ENV=$(echo "$ENV_NOW" | grep -v -E '^WHATSAPP_(APP_ID|APP_SECRET|CONFIG_ID)=')
NEW_ENV+=$'\n'"WHATSAPP_APP_ID=$APP_ID"
NEW_ENV+=$'\n'"WHATSAPP_APP_SECRET=$APP_SECRET"
NEW_ENV+=$'\n'"WHATSAPP_CONFIG_ID=$CONFIG_ID"

TMP=$(mktemp); chmod 600 "$TMP"; printf '%s\n' "$NEW_ENV" > "$TMP"
gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file crm-env="$TMP"
rm -f "$TMP"

echo "Aplicando en el servidor (puede tardar unos minutos)…"
gcloud compute ssh "$NAME" --zone "$ZONE" --command 'sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo docker ps --format "{{.Names}}: {{.Status}}"'

cat <<MSG

✅ App de Meta configurada. Ahora en developers.facebook.com → tu app → WhatsApp → Configuración → Webhook:
   URL de devolución de llamada:  https://$DOMAIN/api/whatsapp/webhook
   Token de verificación:          $VERIFY
   Campos a suscribir: messages, smb_message_echoes, history, smb_app_state_sync

Después entra al CRM → Configuración → "Conectar WhatsApp Business".
MSG
