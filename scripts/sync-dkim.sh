#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  sync-dkim.sh — Aggiorna OpenDKIM per tutti i domini cliente
#  Chiamato dal backend quando un dominio viene aggiunto/rimosso
#  Eseguito come root via sudo (vedi /etc/sudoers.d/smtpflow-dkim)
# ─────────────────────────────────────────────────────────────
KEYS_DIR="${DKIM_KEYS_DIR:-/opt/smtpflow/keys}"
SERVER_HOSTNAME="${SMTP_HOSTNAME:-$(hostname -f)}"
SERVER_KEY="/etc/opendkim/keys/${SERVER_HOSTNAME}/smtpflow.private"
OPENDKIM_KEYS="/etc/opendkim/keys"
KT="/etc/opendkim/KeyTable"
ST="/etc/opendkim/SigningTable"

new_kt=""
new_st=""
count=0

for domain_dir in "$KEYS_DIR"/*/; do
    [[ -d "$domain_dir" ]] || continue
    domain=$(basename "$domain_dir")
    key_src="$domain_dir/smtpflow.private"
    [[ -f "$key_src" ]] || continue

    dest_dir="$OPENDKIM_KEYS/$domain"
    mkdir -p "$dest_dir"
    cp "$key_src" "$dest_dir/smtpflow.private"
    chmod 600 "$dest_dir/smtpflow.private"
    chown opendkim:opendkim "$dest_dir/smtpflow.private" 2>/dev/null || true

    new_kt+="smtpflow._domainkey.$domain $domain:smtpflow:$dest_dir/smtpflow.private\n"
    new_st+="*@$domain smtpflow._domainkey.$domain\n"
    count=$((count + 1))
done

# Fallback: chiave server-wide
new_kt+="smtpflow._domainkey.$SERVER_HOSTNAME $SERVER_HOSTNAME:smtpflow:$SERVER_KEY\n"
new_st+="* smtpflow._domainkey.$SERVER_HOSTNAME\n"

printf "%b" "$new_kt" > "$KT"
printf "%b" "$new_st" > "$ST"

systemctl reload opendkim 2>/dev/null || pkill -HUP opendkim 2>/dev/null || true
echo "DKIM synced: $count domini cliente + fallback ($SERVER_HOSTNAME)"
