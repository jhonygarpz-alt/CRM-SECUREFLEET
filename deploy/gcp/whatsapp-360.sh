#!/bin/bash
# Conecta el CRM a WhatsApp mediante 360dialog (proveedor oficial de Meta, con coexistencia:
# el número sigue funcionando en la app WhatsApp Business del celular).
# Ejecútalo en Google Cloud Shell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/jhonygarpz-alt/CRM-SECUREFLEET/claude/securefleet-crm-whatsapp-lipfmm/deploy/gcp/whatsapp-360.sh)
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

get_meta() {
  gcloud compute instances describe "$NAME" --zone "$ZONE" --format=json | python3 -c "
import sys, json
items = json.load(sys.stdin)['metadata']['items']
print(next(i['value'] for i in items if i['key'] == '$1'))"
}

ENV_NOW=$(get_meta crm-env)
DOMAIN=$(get_meta crm-domain)
VERIFY=$(echo "$ENV_NOW" | sed -n 's/^WHATSAPP_VERIFY_TOKEN=//p')
[ -n "$VERIFY" ] || { echo "Falta WHATSAPP_VERIFY_TOKEN en el servidor."; exit 1; }

read -rsp "Pega tu API KEY de 360dialog (no se muestra): " KEY; echo
[ -n "$KEY" ] || { echo "La API KEY es obligatoria."; exit 1; }

WEBHOOK="https://$DOMAIN/api/whatsapp/webhook/360/$VERIFY"
echo "Registrando el webhook en 360dialog…"
RESP=$(curl -s -w '\n%{http_code}' -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
  -H "D360-API-KEY: $KEY" -H 'Content-Type: application/json' -d "{\"url\": \"$WEBHOOK\"}")
CODE=$(echo "$RESP" | tail -n1)
if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
  echo "✖ 360dialog respondió $CODE: $(echo "$RESP" | head -n -1)"
  echo "Revisa que la API KEY sea correcta (360dialog Hub → tu número → API Key) y vuelve a intentarlo."
  exit 1
fi
echo "  Webhook registrado ✅"

NEW_ENV=$(echo "$ENV_NOW" | grep -v -E '^(D360_API_KEY|WHATSAPP_TOKEN|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_BUSINESS_ACCOUNT_ID)=')
NEW_ENV+=$'\n'"D360_API_KEY=$KEY"
TMP=$(mktemp); chmod 600 "$TMP"; printf '%s\n' "$NEW_ENV" > "$TMP"
gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata-from-file crm-env="$TMP"
rm -f "$TMP"

echo "Aplicando en el servidor (unos minutos)…"
gcloud compute ssh "$NAME" --zone "$ZONE" --command 'sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo docker ps --format "{{.Names}}: {{.Status}}"'
echo
echo "✅ WhatsApp conectado por 360dialog. Entra al CRM → Configuración: debe decir \"WhatsApp conectado mediante 360dialog\"."
echo "   Prueba: desde otro celular escribe a tu WhatsApp Business; el mensaje debe aparecer en el CRM → WhatsApp."
