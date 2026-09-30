#!/bin/bash
# Conecta al CRM un número de WhatsApp dado de alta directamente en la API de WhatsApp Cloud
# (número dedicado, sin la app del celular). Ejecútalo en Google Cloud Shell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/claude/securefleet-crm-whatsapp-lipfmm/deploy/gcp/whatsapp-numero.sh)
set -euo pipefail
NAME="securefleet-crm"
ZONE="us-central1-a"
API="https://graph.facebook.com/v26.0"

if [ -z "$(gcloud config get-value project 2>/dev/null)" ]; then
  for P in $(gcloud projects list --format="value(projectId)"); do
    if gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$P" >/dev/null 2>&1; then
      gcloud config set project "$P" >/dev/null && echo "Proyecto: $P" && break
    fi
  done
fi

get_meta() {
  gcloud compute instances describe "$NAME" --zone "$ZONE" --format=json | python3 -c "
import sys, json
items = json.load(sys.stdin)['metadata']['items']
print(next(i['value'] for i in items if i['key'] == '$1'))"
}

echo "Datos de Meta (los secretos no se muestran al escribir):"
read -rp  "Identificador del número de teléfono (Phone Number ID): " PHONE_ID
read -rp  "Identificador de la cuenta de WhatsApp Business (WABA ID): " WABA_ID
read -rsp "Token permanente del usuario del sistema: " TOKEN; echo
[ -n "$PHONE_ID" ] && [ -n "$WABA_ID" ] && [ -n "$TOKEN" ] || { echo "Los tres datos son obligatorios."; exit 1; }

echo
echo "Verificando el número con Meta…"
INFO=$(curl -s "$API/$PHONE_ID?fields=display_phone_number,verified_name,code_verification_status,status" -H "Authorization: Bearer $TOKEN")
echo "$INFO" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print('✖ Meta respondió:', d['error'].get('message')); sys.exit(1)
print('  Número:', d.get('display_phone_number'), '·', d.get('verified_name'), '· estado:', d.get('status'))"

read -rp "¿Registrar el número en la API ahora? (s/n) [s]: " DO_REG
if [ "${DO_REG:-s}" != "n" ]; then
  read -rp "Elige un PIN de 6 dígitos para la verificación en dos pasos (guárdalo): " PIN
  REG=$(curl -s -X POST "$API/$PHONE_ID/register" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d "{\"messaging_product\":\"whatsapp\",\"pin\":\"$PIN\"}")
  echo "  Registro: $REG"
fi

SUB=$(curl -s -X POST "$API/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $TOKEN")
echo "  Suscripción de la app a los mensajes: $SUB"

ENV_NOW=$(get_meta crm-env)
NEW_ENV=$(echo "$ENV_NOW" | grep -v -E '^WHATSAPP_(TOKEN|PHONE_NUMBER_ID|BUSINESS_ACCOUNT_ID|API_VERSION)=')
NEW_ENV+=$'\n'"WHATSAPP_TOKEN=$TOKEN"
NEW_ENV+=$'\n'"WHATSAPP_PHONE_NUMBER_ID=$PHONE_ID"
NEW_ENV+=$'\n'"WHATSAPP_BUSINESS_ACCOUNT_ID=$WABA_ID"
NEW_ENV+=$'\n'"WHATSAPP_API_VERSION=v26.0"
TMP=$(mktemp); chmod 600 "$TMP"; printf '%s\n' "$NEW_ENV" > "$TMP"
gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file crm-env="$TMP"
rm -f "$TMP"

echo "Aplicando en el servidor (unos minutos)…"
gcloud compute ssh "$NAME" --zone "$ZONE" --command 'sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo docker ps --format "{{.Names}}: {{.Status}}"'
echo
echo "✅ Número conectado. Entra al CRM → Configuración: debe decir \"Conectado a la API de WhatsApp Cloud\"."
