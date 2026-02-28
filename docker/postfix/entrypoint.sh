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
