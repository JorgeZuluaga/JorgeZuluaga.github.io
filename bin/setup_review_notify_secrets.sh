#!/usr/bin/env bash
# Prepara .secrets/ para suscripción a reseñas (worker + Gmail SMTP).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$REPO_DIR/.secrets"
mkdir -p "$SECRETS"

if [[ ! -f "$SECRETS/review-notify-token" ]]; then
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  printf '%s\n' "$TOKEN" > "$SECRETS/review-notify-token"
  echo "Creado $SECRETS/review-notify-token"
  echo "Configúrelo en Cloudflare:"
  echo "  npx wrangler secret put NOTIFY_TOKEN --config wrangler-review-notify.toml"
  echo "  (pegue el token mostrado arriba o el contenido del archivo)"
else
  echo "Ya existe $SECRETS/review-notify-token"
fi

if [[ ! -f "$SECRETS/gmail-smtp-user" ]]; then
  read -r -p "Gmail para enviar (ej. puntobernal@gmail.com): " GMAIL_USER
  if [[ -n "$GMAIL_USER" ]]; then
    printf '%s\n' "$GMAIL_USER" > "$SECRETS/gmail-smtp-user"
  fi
fi

if [[ ! -f "$SECRETS/gmail-app-password" ]]; then
  echo "Cree una contraseña de aplicación en Google (Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones)."
  read -r -s -p "Contraseña de aplicación Gmail (16 caracteres): " GMAIL_PW
  echo ""
  if [[ -n "$GMAIL_PW" ]]; then
    printf '%s\n' "$GMAIL_PW" > "$SECRETS/gmail-app-password"
    chmod 600 "$SECRETS/gmail-app-password" "$SECRETS/review-notify-token" 2>/dev/null || true
  fi
fi

echo ""
echo "Despliegue del worker (requiere CLOUDFLARE_API_TOKEN o wrangler login):"
echo "  1. npx wrangler kv namespace create REVIEW_NOTIFY --config wrangler-review-notify.toml"
echo "  2. Pegar el id en wrangler-review-notify.toml"
echo "  3. make review-notify-deploy"
echo "  4. make review-notify-seed-test"
echo "  5. make review-notify-test-send"
