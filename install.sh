#!/usr/bin/env bash
# ============================================================
#  SMTPFlow - SaaS SMTP Server
#  Installation Script for Ubuntu 20.04+ / Debian 11+
# ============================================================
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }

# ── Banner ───────────────────────────────────────────────────
echo -e "
${BOLD}${BLUE}
 ███████╗███╗   ███╗████████╗██████╗ ███████╗██╗      ██████╗ ██╗    ██╗
 ██╔════╝████╗ ████║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║
 ███████╗██╔████╔██║   ██║   ██████╔╝█████╗  ██║     ██║   ██║██║ █╗ ██║
 ╚════██║██║╚██╔╝██║   ██║   ██╔═══╝ ██╔══╝  ██║     ██║   ██║██║███╗██║
 ███████║██║ ╚═╝ ██║   ██║   ██║     ██║     ███████╗╚██████╔╝╚███╔███╔╝
 ╚══════╝╚═╝     ╚═╝   ╚═╝   ╚═╝     ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝
${NC}${CYAN}  SaaS SMTP Server Platform  —  v1.0.0${NC}
"

# ── Check root ───────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"

# ── Detect OS ────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS=$ID
  OS_VERSION=$VERSION_ID
else
  error "Cannot detect OS"
fi

[[ "$OS" =~ ^(ubuntu|debian)$ ]] || error "Only Ubuntu/Debian supported. Got: $OS"
info "Detected: $PRETTY_NAME"

# ── Script dir ───────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Configuration ────────────────────────────────────────────
APP_DIR="/opt/smtpflow"
APP_USER="smtpflow"
NODE_VERSION="20"

# Generate secrets
DB_PASS=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 64)
BOUNCE_SECRET=$(openssl rand -hex 32)

# ── Interactive prompts ───────────────────────────────────────
echo ""
echo -e "${BOLD}Configurazione installazione${NC}"
echo "────────────────────────────────"

read -rp "Dominio (es: smtp.tuodominio.com): " DOMAIN
[[ -z "$DOMAIN" ]] && error "Il dominio è obbligatorio"

read -rp "Email admin: " ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && error "Email admin obbligatoria"

while true; do
  read -rsp "Password admin (min 8 caratteri): " ADMIN_PASS
  echo ""
  [[ ${#ADMIN_PASS} -ge 8 ]] && break
  warn "Password troppo corta, riprova"
done

read -rp "Certificato SSL Let's Encrypt? [Y/n]: " SSL_CHOICE
SSL_CHOICE=${SSL_CHOICE:-Y}

echo ""
echo -e "${BOLD}Riepilogo installazione:${NC}"
echo "  Dominio:     $DOMAIN"
echo "  Admin email: $ADMIN_EMAIL"
echo "  SSL:         $([[ "$SSL_CHOICE" =~ ^[Yy] ]] && echo 'Sì (certbot)' || echo 'No')"
echo "  Directory:   $APP_DIR"
echo ""
read -rp "Procedere? [Y/n]: " CONFIRM
[[ "${CONFIRM:-Y}" =~ ^[Nn] ]] && echo "Installazione annullata." && exit 0

# ── Install system packages ───────────────────────────────────
step "Aggiornamento sistema e installazione dipendenze"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

apt-get install -y -qq \
  curl wget gnupg2 lsb-release ca-certificates \
  software-properties-common apt-transport-https \
  build-essential git openssl \
  postfix postfix-pcre \
  opendkim opendkim-tools \
  nginx \
  postgresql postgresql-contrib \
  redis-server \
  certbot python3-certbot-nginx \
  ufw fail2ban \
  pm2 2>/dev/null || true

success "Pacchetti di sistema installati"

# ── Install Node.js 20 ────────────────────────────────────────
step "Installazione Node.js $NODE_VERSION"
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - 2>/dev/null
  apt-get install -y nodejs 2>/dev/null
fi
# Install PM2 globally
npm install -g pm2 2>/dev/null || true
success "Node.js $(node -v) installato"

# ── PostgreSQL setup ──────────────────────────────────────────
step "Configurazione PostgreSQL"
systemctl enable postgresql --quiet
systemctl start postgresql

sudo -u postgres psql -c "SELECT 1 FROM pg_roles WHERE rolname='smtpflow'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER smtpflow WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='smtpflow'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE smtpflow OWNER smtpflow;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE smtpflow TO smtpflow;" 2>/dev/null || true
success "PostgreSQL configurato"

# ── Redis setup ───────────────────────────────────────────────
step "Configurazione Redis"
systemctl enable redis-server --quiet
systemctl start redis-server
success "Redis configurato"

# ── Create app user and directories ───────────────────────────
step "Creazione utente e directory applicazione"
id -u "$APP_USER" &>/dev/null || useradd --system --shell /bin/false --home "$APP_DIR" "$APP_USER"
mkdir -p "$APP_DIR"/{backend,frontend,logs,keys,ssl}
success "Directory create: $APP_DIR"

# ── Copy application files ────────────────────────────────────
step "Copia file applicazione"
# Copy backend
cp -r "$SCRIPT_DIR/backend"/* "$APP_DIR/backend/"
# Copy frontend
cp -r "$SCRIPT_DIR/frontend"/* "$APP_DIR/frontend/"
success "File copiati in $APP_DIR"

# ── Create .env file ──────────────────────────────────────────
step "Creazione file di configurazione (.env)"
cat > "$APP_DIR/backend/.env" << EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
BASE_URL=https://${DOMAIN}
CORS_ORIGIN=https://${DOMAIN}

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=smtpflow
DB_USER=smtpflow
DB_PASS=${DB_PASS}

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=${JWT_SECRET}

# SMTP
SMTP_PORT=587
SMTP_PORT_SSL=465
SMTP_HOSTNAME=${DOMAIN}

# Relay → Postfix locale (consegna diretta)
RELAY_PROVIDER=postfix
RELAY_HOST=127.0.0.1
RELAY_PORT=587
RELAY_SECURE=false

# DKIM multi-dominio
DKIM_KEYS_DIR=${APP_DIR}/dkim-keys
DKIM_MODE=vps
DKIM_SYNC_SCRIPT=${APP_DIR}/sync-dkim.sh

# Bounce handling
BOUNCE_SECRET=${BOUNCE_SECRET}
BOUNCE_ADDRESS=bounce

# Admin
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASS=${ADMIN_PASS}

# Logging
LOG_DIR=/var/log/smtpflow
LOG_LEVEL=info
EOF
chmod 600 "$APP_DIR/backend/.env"
success ".env creato"

# ── Install Node dependencies ──────────────────────────────────
step "Installazione dipendenze backend (npm)"
cd "$APP_DIR/backend"
npm install --production --silent
success "Dipendenze backend installate"

# ── Run DB migrations ──────────────────────────────────────────
step "Migrazione database"
cd "$APP_DIR/backend"
node src/database.js migrate
success "Database migrato"

# ── Build frontend ─────────────────────────────────────────────
step "Build frontend React"
cd "$APP_DIR/frontend"
npm install --silent
npm run build
success "Frontend compilato"

# ── Configure Postfix ──────────────────────────────────────────
step "Configurazione Postfix (consegna diretta)"

postconf -e "myhostname = ${DOMAIN}"
postconf -e "mydomain = ${DOMAIN}"
postconf -e "myorigin = \$mydomain"
postconf -e "inet_interfaces = loopback-only"
postconf -e "mydestination = \$myhostname, localhost.\$mydomain, localhost"
postconf -e "relayhost ="
postconf -e "mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128"
postconf -e "mailbox_size_limit = 0"
postconf -e "message_size_limit = 52428800"
postconf -e "recipient_delimiter = +"
postconf -e "inet_protocols = ipv4"
postconf -e "smtpd_banner = \$myhostname ESMTP"
postconf -e "biff = no"
postconf -e "append_dot_mydomain = no"
postconf -e "readme_directory = no"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_note_starttls_offer = yes"
postconf -e "smtp_dns_support_level = enabled"

# Abilita porta 587 (submission) per Node.js → Postfix
grep -q "^submission" /etc/postfix/master.cf || cat >> /etc/postfix/master.cf << 'MASTER'
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=may
  -o smtpd_sasl_auth_enable=no
  -o smtpd_relay_restrictions=permit_mynetworks,reject
MASTER

systemctl restart postfix
systemctl enable postfix --quiet
success "Postfix configurato (submission 587 abilitato)"

# ── Configure OpenDKIM (multi-dominio) ────────────────────────
step "Configurazione OpenDKIM multi-dominio"

DKIM_KEYS_DIR="${APP_DIR}/dkim-keys"
mkdir -p "$DKIM_KEYS_DIR" /etc/opendkim/keys
chown "${APP_USER}:${APP_USER}" "$DKIM_KEYS_DIR"

cat > /etc/opendkim.conf << EOF
AutoRestart             Yes
AutoRestartRate         10/1h
Syslog                  yes
SyslogSuccess           Yes
LogWhy                  Yes
Canonicalization        relaxed/simple
InternalHosts           refile:/etc/opendkim/TrustedHosts
KeyTable                refile:/etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
Mode                    sv
PidFile                 /run/opendkim/opendkim.pid
SignatureAlgorithm      rsa-sha256
UserID                  opendkim:opendkim
UMask                   002
Socket                  inet:12301@localhost
EOF

cat > /etc/opendkim/TrustedHosts << EOF
127.0.0.1
localhost
${DOMAIN}
EOF

# Script di sincronizzazione DKIM (eseguito da Node.js via sudo)
# Legge le chiavi da dkim-keys/ e aggiorna la config OpenDKIM
cat > "${APP_DIR}/sync-dkim.sh" << 'SYNC_SCRIPT'
#!/bin/bash
# Sincronizza le chiavi DKIM dal volume dell'app a OpenDKIM
# Eseguito come root via sudo da dkimManager.js
set -e

DKIM_KEYS_DIR="APP_DIR_PLACEHOLDER/dkim-keys"
OPENDKIM_KEYS="/etc/opendkim/keys"
KEY_TABLE="/etc/opendkim/KeyTable"
SIGNING_TABLE="/etc/opendkim/SigningTable"

> "$KEY_TABLE"
> "$SIGNING_TABLE"

for domain_dir in "$DKIM_KEYS_DIR"/*/; do
    [[ -d "$domain_dir" ]] || continue
    domain=$(basename "$domain_dir")
    src_key="$domain_dir/smtpflow.private"
    [[ -f "$src_key" ]] || continue

    dest_dir="$OPENDKIM_KEYS/$domain"
    mkdir -p "$dest_dir"
    cp "$src_key" "$dest_dir/smtpflow.private"
    chown opendkim:opendkim "$dest_dir/smtpflow.private"
    chmod 600 "$dest_dir/smtpflow.private"

    echo "smtpflow._domainkey.$domain $domain:smtpflow:$dest_dir/smtpflow.private" >> "$KEY_TABLE"
    echo "*@$domain smtpflow._domainkey.$domain" >> "$SIGNING_TABLE"
done

systemctl reload opendkim
echo "DKIM sync: $(wc -l < "$KEY_TABLE") domains"
SYNC_SCRIPT

sed -i "s|APP_DIR_PLACEHOLDER|${APP_DIR}|g" "${APP_DIR}/sync-dkim.sh"
chmod 750 "${APP_DIR}/sync-dkim.sh"
chown root:root "${APP_DIR}/sync-dkim.sh"

# Sudoers: permette a smtpflow di eseguire solo sync-dkim.sh come root
echo "${APP_USER} ALL=(ALL) NOPASSWD: ${APP_DIR}/sync-dkim.sh" > /etc/sudoers.d/smtpflow-dkim
chmod 440 /etc/sudoers.d/smtpflow-dkim

# Genera la chiave DKIM per il dominio principale del server
mkdir -p "${DKIM_KEYS_DIR}/${DOMAIN}"
opendkim-genkey -b 2048 -d "${DOMAIN}" -D "${DKIM_KEYS_DIR}/${DOMAIN}" -s smtpflow -v 2>/dev/null || true
# opendkim-genkey genera "smtpflow.private" — nome già corretto
chown -R "${APP_USER}:${APP_USER}" "${DKIM_KEYS_DIR}"

# Prima sync
bash "${APP_DIR}/sync-dkim.sh"

# Collega Postfix a OpenDKIM
postconf -e "milter_protocol = 6"
postconf -e "milter_default_action = accept"
postconf -e "smtpd_milters = inet:localhost:12301"
postconf -e "non_smtpd_milters = inet:localhost:12301"

systemctl enable opendkim --quiet 2>/dev/null || true
systemctl restart opendkim 2>/dev/null || true
systemctl restart postfix
success "OpenDKIM multi-dominio configurato"

# ── Configure Nginx ───────────────────────────────────────────
step "Configurazione Nginx"

# Remove default
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Install config (HTTP first, HTTPS after certbot)
cat > "/etc/nginx/sites-available/smtpflow" << NGINX_HTTP
server {
    listen 80;
    server_name ${DOMAIN};

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /t/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        add_header Cache-Control "no-store";
    }

    location / {
        root ${APP_DIR}/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX_HTTP

ln -sf /etc/nginx/sites-available/smtpflow /etc/nginx/sites-enabled/smtpflow
nginx -t 2>/dev/null && systemctl restart nginx && systemctl enable nginx --quiet
success "Nginx configurato"

# ── SSL Certificate ───────────────────────────────────────────
if [[ "$SSL_CHOICE" =~ ^[Yy] ]]; then
  step "Installazione certificato SSL Let's Encrypt"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect 2>/dev/null || \
    warn "Certbot fallito. Configurare SSL manualmente."
fi

# ── Permissions ───────────────────────────────────────────────
step "Impostazione permessi"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod -R 750 "$APP_DIR"
chmod 600 "$APP_DIR/backend/.env"
mkdir -p /var/log/smtpflow
chown -R "$APP_USER:$APP_USER" /var/log/smtpflow

# ── PM2 Process Manager ───────────────────────────────────────
step "Configurazione PM2"

cat > "$APP_DIR/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: 'smtpflow',
    script: '${APP_DIR}/backend/src/index.js',
    cwd: '${APP_DIR}/backend',
    user: '${APP_USER}',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
    env_file: '${APP_DIR}/backend/.env',
    log_file: '/var/log/smtpflow/pm2.log',
    out_file: '/var/log/smtpflow/out.log',
    error_file: '/var/log/smtpflow/error.log',
  }],
};
EOF

# Start with PM2
pm2 delete smtpflow 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.js" --env production
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || \
  env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root || true

success "PM2 configurato e applicazione avviata"

# ── Firewall (UFW) ────────────────────────────────────────────
step "Configurazione firewall UFW"
ufw --force reset 2>/dev/null || true
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 587/tcp   comment 'SMTP STARTTLS'
ufw allow 465/tcp   comment 'SMTP SSL'
ufw allow 25/tcp    comment 'SMTP'
ufw --force enable
success "Firewall configurato"

# ── Logrotate ─────────────────────────────────────────────────
cat > /etc/logrotate.d/smtpflow << 'EOF'
/var/log/smtpflow/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 smtpflow smtpflow
    sharedscripts
    postrotate
        pm2 reloadLogs 2>/dev/null || true
    endscript
}
EOF

# ── Print summary ─────────────────────────────────────────────
DKIM_PUBLIC=""
if [[ -f "/etc/opendkim/keys/${DOMAIN}/smtpflow.txt" ]]; then
  DKIM_PUBLIC=$(cat "/etc/opendkim/keys/${DOMAIN}/smtpflow.txt" 2>/dev/null || echo "Vedi /etc/opendkim/keys/${DOMAIN}/smtpflow.txt")
fi

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════"
echo -e "  ✅  SMTPFlow installato con successo!"
echo -e "════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}Accesso Web:${NC}"
echo -e "  URL:        ${CYAN}https://${DOMAIN}${NC}"
echo -e "  Admin:      ${CYAN}${ADMIN_EMAIL}${NC}"
echo -e "  Password:   ${YELLOW}${ADMIN_PASS}${NC}"
echo ""
echo -e "${BOLD}Server SMTP:${NC}"
echo -e "  Host:       ${CYAN}${DOMAIN}${NC}"
echo -e "  Porta:      ${CYAN}587 (STARTTLS) / 465 (SSL)${NC}"
echo -e "  Auth:       Le credenziali si creano automaticamente per ogni utente"
echo ""
echo -e "${BOLD}Database:${NC}"
echo -e "  DB:         smtpflow"
echo -e "  User:       smtpflow"
echo -e "  Pass:       ${YELLOW}${DB_PASS}${NC}"
echo ""
echo -e "${BOLD}Record DNS da configurare sul dominio ${DOMAIN}:${NC}"
echo -e "  ${CYAN}Tipo  Host                              Valore${NC}"
echo -e "  A     ${DOMAIN}                 <IP del server>"
echo -e "  MX    ${DOMAIN}                 10 ${DOMAIN}"
echo -e "  TXT   ${DOMAIN}                 v=spf1 a:${DOMAIN} ~all"
if [[ -f "${APP_DIR}/dkim-keys/${DOMAIN}/smtpflow.txt" ]]; then
  echo -e "  TXT   smtpflow._domainkey.${DOMAIN}"
  echo -e "        $(grep -oP '".*?"' "${APP_DIR}/dkim-keys/${DOMAIN}/smtpflow.txt" | tr -d '"' | tr -d '\n' 2>/dev/null || echo "(vedi ${APP_DIR}/dkim-keys/${DOMAIN}/smtpflow.txt)")"
fi
echo -e ""
echo -e "  ${YELLOW}⚠  PTR (rDNS): configura il record PTR dell'IP del server → ${DOMAIN}${NC}"
echo -e "     (impostalo nel pannello del provider VPS/cloud)"
echo ""
echo -e "${BOLD}Comandi utili:${NC}"
echo -e "  pm2 status             → Stato applicazione"
echo -e "  pm2 logs smtpflow      → Log in tempo reale"
echo -e "  pm2 restart smtpflow   → Riavvio"
echo -e "  tail -f /var/log/smtpflow/error.log"
echo ""
echo -e "${YELLOW}⚠  Salva le credenziali qui sopra in un posto sicuro!${NC}"
echo ""

# Save credentials to file
cat > /root/smtpflow-credentials.txt << EOF
SMTPFlow Credentials - $(date)
================================
Web URL:    https://${DOMAIN}
Admin:      ${ADMIN_EMAIL}
Password:   ${ADMIN_PASS}

DB User:    smtpflow
DB Pass:    ${DB_PASS}

JWT Secret: ${JWT_SECRET}
Bounce Secret: ${BOUNCE_SECRET}
EOF
chmod 600 /root/smtpflow-credentials.txt
echo -e "${GREEN}Credenziali salvate in: /root/smtpflow-credentials.txt${NC}"
echo ""
