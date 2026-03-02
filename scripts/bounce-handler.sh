#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  bounce-handler.sh — Processa DSN bounce da Postfix
#  Chiamato da Postfix pipe transport per bounce+<trackingId>@hostname
#  $1 = indirizzo destinatario (bounce+<trackingId>@hostname)
# ─────────────────────────────────────────────────────────────
RECIPIENT="${1}"
TRACKING_ID=$(echo "$RECIPIENT" | grep -oP 'bounce\+\K[^@]+')
[[ -z "$TRACKING_ID" ]] && exit 0

EMAIL=$(cat)
BOUNCE_TYPE="hard"

# Status 4.x.x = temporary/soft, 5.x.x = permanent/hard
if echo "$EMAIL" | grep -qiP 'Status:\s+4\.'; then
    BOUNCE_TYPE="soft"
fi

# Cattura Diagnostic-Code incluse le righe di continuazione (header folded)
BOUNCE_MESSAGE=$(echo "$EMAIL" | \
    awk 'BEGIN{p=0} /^[Dd]iagnostic-[Cc]ode:/{p=1; sub(/^[Dd]iagnostic-[Cc]ode:[ \t]*/,""); printf "%s",$0; next} p && /^[ \t]/{sub(/^[ \t]+/," "); printf "%s",$0; next} p{exit}' | \
    sed 's/^smtp;[ ]*//' | \
    tr -d '\r' | \
    xargs | \
    cut -c1-500)

# Fallback: cerca codice SMTP nel body
if [[ -z "$BOUNCE_MESSAGE" ]]; then
    BOUNCE_MESSAGE=$(echo "$EMAIL" | grep -oP '(5|4)[0-9]{2}[-. ][^\r\n]+' | head -1 | cut -c1-300)
fi

# Legge BOUNCE_SECRET dal .env
ENV_FILE="$(dirname "$0")/backend/.env"
BOUNCE_SECRET=$(grep '^BOUNCE_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
[[ -z "$BOUNCE_SECRET" ]] && exit 0

BODY=$(printf '{"tracking_id":"%s","bounce_type":"%s","bounce_message":"%s"}' \
    "$TRACKING_ID" "$BOUNCE_TYPE" "$(echo "$BOUNCE_MESSAGE" | sed 's/"/\\"/g')")

curl -s -X POST http://localhost:3000/t/bounce \
    -H "Content-Type: application/json" \
    -H "X-Bounce-Secret: $BOUNCE_SECRET" \
    -d "$BODY" --max-time 10 || true

exit 0
