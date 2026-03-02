#!/bin/bash
set -e

SMTP_HOSTNAME=${SMTP_HOSTNAME:-localhost}
DKIM_KEYS_DIR=${DKIM_KEYS_DIR:-/dkim-keys}
MYNETWORKS=${MYNETWORKS:-"127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"}

mkdir -p "$DKIM_KEYS_DIR" /etc/opendkim/keys /var/run/opendkim
chown opendkim:opendkim /var/run/opendkim /etc/opendkim/keys 2>/dev/null || true

echo "[postfix] Hostname: $SMTP_HOSTNAME"

# ── OpenDKIM config ──────────────────────────────────────────
cat > /etc/opendkim.conf << EOF
AutoRestart             Yes
AutoRestartRate         10/1h
Syslog                  yes
SyslogSuccess           yes
LogWhy                  yes
Canonicalization        relaxed/simple
Mode                    sv
PidFile                 /var/run/opendkim/opendkim.pid
SignatureAlgorithm      rsa-sha256
UserID                  opendkim:opendkim
UMask                   002
Socket                  inet:12301@localhost
KeyTable                refile:/etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
InternalHosts           refile:/etc/opendkim/TrustedHosts
EOF

cat > /etc/opendkim/TrustedHosts << EOF
127.0.0.1
localhost
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
EOF

# ── Rebuild OpenDKIM tables from /dkim-keys ──────────────────
rebuild_dkim_config() {
    local kt="/etc/opendkim/KeyTable"
    local st="/etc/opendkim/SigningTable"
    local new_kt="" new_st="" count=0

    for domain_dir in "$DKIM_KEYS_DIR"/*/; do
        [[ -d "$domain_dir" ]] || continue
        local domain
        domain=$(basename "$domain_dir")
        local src_key="$domain_dir/smtpflow.private"
        [[ -f "$src_key" ]] || continue

        local dest_dir="/etc/opendkim/keys/$domain"
        mkdir -p "$dest_dir"

        if ! diff -q "$src_key" "$dest_dir/smtpflow.private" &>/dev/null 2>&1; then
            cp "$src_key" "$dest_dir/smtpflow.private"
            chmod 600 "$dest_dir/smtpflow.private"
            chown opendkim:opendkim "$dest_dir/smtpflow.private" 2>/dev/null || true
        fi

        new_kt+="smtpflow._domainkey.$domain $domain:smtpflow:$dest_dir/smtpflow.private\n"
        new_st+="*@$domain smtpflow._domainkey.$domain\n"
        count=$((count + 1))
    done

    printf "%b" "$new_kt" > "$kt"
    printf "%b" "$new_st" > "$st"
    echo "[dkim] Config rebuilt: $count domains"
}

# ── Configure Postfix ────────────────────────────────────────
postconf -e "myhostname = $SMTP_HOSTNAME"
postconf -e "myorigin = \$myhostname"
postconf -e "mydestination = localhost"
postconf -e "relayhost ="
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mynetworks = $MYNETWORKS"
postconf -e "mailbox_size_limit = 0"
postconf -e "message_size_limit = 52428800"
postconf -e "biff = no"
postconf -e "append_dot_mydomain = no"
postconf -e "smtpd_banner = \$myhostname ESMTP"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_note_starttls_offer = yes"
postconf -e "smtp_dns_support_level = enabled"
postconf -e "milter_protocol = 6"
postconf -e "milter_default_action = accept"
postconf -e "smtpd_milters = inet:localhost:12301"
postconf -e "non_smtpd_milters = inet:localhost:12301"

# ── Bounce processing ─────────────────────────────────────────
# Accept bounce+<trackingId>@$SMTP_HOSTNAME as a virtual mailbox
# and pipe it to the process_bounce script
postconf -e "virtual_mailbox_domains = \$myhostname"
postconf -e "virtual_mailbox_maps = regexp:/etc/postfix/bounce_regex"
postconf -e "virtual_transport = bounce_notify"

# Only accept addresses matching bounce+<hex>@
cat > /etc/postfix/bounce_regex << 'EOF'
/^bounce\+[0-9a-f]+@/    bounce
EOF

# Add bounce_notify pipe service to master.cf (only once)
grep -q "^bounce_notify" /etc/postfix/master.cf || cat >> /etc/postfix/master.cf << 'MASTER'
bounce_notify unix  -       n       n       -       1       pipe
  flags=FR user=nobody argv=/usr/local/bin/process_bounce ${recipient}
MASTER

# Generate the bounce processor script with credentials baked in
cat > /usr/local/bin/process_bounce << 'ENDSCRIPT'
#!/bin/bash
RECIPIENT="$1"
TRACKING_ID=$(echo "$RECIPIENT" | sed 's/bounce+\([^@]*\)@.*/\1/')
[ -z "$TRACKING_ID" ] && exit 0

EMAIL=$(cat)

# Extract status code and diagnostic message from DSN
STATUS=$(echo "$EMAIL" | grep -m1 "^Status:" | cut -d: -f2 | tr -d ' \r\n')
DIAGNOSTIC=$(echo "$EMAIL" | grep -m1 "^Diagnostic-Code:" | cut -d: -f2- | sed 's/^ *smtp; *//' | tr -d '\r' | xargs | cut -c1-500)

# 4.x.x = temporary/soft, 5.x.x = permanent/hard
BOUNCE_TYPE="hard"
echo "$STATUS" | grep -qE "^4\." && BOUNCE_TYPE="soft"

# Fallback: look for SMTP error line in body
[ -z "$DIAGNOSTIC" ] && DIAGNOSTIC=$(echo "$EMAIL" | grep -oE "(5[0-9]{2}|4[0-9]{2}) [^\r\n]+" | head -1 | cut -c1-300)

BOUNCE_MSG="${DIAGNOSTIC:-Unknown bounce reason}"
BOUNCE_MSG=$(printf '%s' "$BOUNCE_MSG" | sed 's/\\/\\\\/g; s/"/\\"/g')

curl -s -X POST "__BACKEND_URL__/t/bounce" \
  -H "Content-Type: application/json" \
  -H "X-Bounce-Secret: __BOUNCE_SECRET__" \
  -d "{\"tracking_id\":\"${TRACKING_ID}\",\"bounce_type\":\"${BOUNCE_TYPE}\",\"bounce_message\":\"${BOUNCE_MSG}\"}" \
  >/dev/null 2>&1
exit 0
ENDSCRIPT

# Substitute runtime values into the script
sed -i "s|__BACKEND_URL__|${BACKEND_URL:-http://app:3000}|g" /usr/local/bin/process_bounce
sed -i "s|__BOUNCE_SECRET__|${BOUNCE_SECRET:-}|g" /usr/local/bin/process_bounce
chmod +x /usr/local/bin/process_bounce
echo "[bounce] Processor configured for ${BACKEND_URL:-http://app:3000}"

# ── Abilita porta 587 (submission) per Node.js → Postfix ────
# La porta 25 rimane per la consegna Postfix → internet (server destinatari)
grep -q "^submission" /etc/postfix/master.cf || cat >> /etc/postfix/master.cf << 'MASTER'
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=may
  -o smtpd_sasl_auth_enable=no
  -o smtpd_relay_restrictions=permit_mynetworks,reject
MASTER

# ── Start rsyslog ────────────────────────────────────────────
rsyslogd 2>/dev/null || true

# ── Initial DKIM config ──────────────────────────────────────
rebuild_dkim_config

# ── Start OpenDKIM ───────────────────────────────────────────
opendkim
sleep 2
echo "[opendkim] Started"

# ── Start Postfix ────────────────────────────────────────────
postfix start
echo "[postfix] Started — direct delivery mode (no relay)"

# ── DKIM watcher: poll every 10s for new domain keys ────────
(
    while true; do
        sleep 10
        rebuild_dkim_config
        # Signal OpenDKIM to reload if running
        pkill -HUP opendkim 2>/dev/null || true
    done
) &

# ── Keep alive: restart Postfix if it dies ───────────────────
echo "[smtpflow-postfix] Container ready."
while true; do
    if ! postfix status &>/dev/null; then
        echo "[postfix] Process died, restarting..."
        postfix start
    fi
    sleep 5
done
