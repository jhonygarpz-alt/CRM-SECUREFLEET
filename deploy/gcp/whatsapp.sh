#!/bin/bash
# Configura las credenciales de WhatsApp Business Cloud API en el servidor del CRM.
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

echo "Pega los datos de Meta (WhatsApp → Configuración de la API). No se muestran en pantalla los secretos."
read -rp  "Phone Number ID (Identificador del número de teléfono): " PHONE_ID
read -rp  "WhatsApp Business Account ID (Identificador de la cuenta): " WABA_ID
read -rsp "Token de acceso permanente: " TOKEN; echo
read -rsp "App Secret (Configuración de la app → Básica → Clave secreta): " APP_SECRET; echo
[ -n "$PHONE_ID" ] && [ -n "$TOKEN" ] || { echo "Phone Number ID y token son obligatorios."; exit 1; }

NEW_ENV=$(echo "$ENV_NOW" | grep -v -E '^WHATSAPP_(TOKEN|PHONE_NUMBER_ID|BUSINESS_ACCOUNT_ID|APP_SECRET)=')
NEW_ENV+=$'\n'"WHATSAPP_TOKEN=$TOKEN"
NEW_ENV+=$'\n'"WHATSAPP_PHONE_NUMBER_ID=$PHONE_ID"
NEW_ENV+=$'\n'"WHATSAPP_BUSINESS_ACCOUNT_ID=$WABA_ID"
NEW_ENV+=$'\n'"WHATSAPP_APP_SECRET=$APP_SECRET"

TMP=$(mktemp); chmod 600 "$TMP"; printf '%s\n' "$NEW_ENV" > "$TMP"
gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file crm-env="$TMP"
rm -f "$TMP"

echo "Aplicando en el servidor (1-3 minutos)…"
gcloud compute ssh "$NAME" --zone "$ZONE" --command 'sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo docker ps --format "{{.Names}}: {{.Status}}"'

cat <<MSG

✅ Credenciales guardadas. Ahora en Meta → WhatsApp → Configuración → Webhook:
   URL de devolución de llamada:  https://$DOMAIN/api/whatsapp/webhook
   Token de verificación:          $VERIFY
   Luego en "Campos del webhook" suscríbete a:  messages
MSG
