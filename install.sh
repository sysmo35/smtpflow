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
  ufw fail2ban || error "Installazione pacchetti di sistema fallita"

success "Pacchetti di sistema installati"

# ── Install Node.js 20 ────────────────────────────────────────
step "Installazione Node.js $NODE_VERSION"
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs || error "Installazione Node.js fallita"
fi
command -v node &>/dev/null || error "Node.js non trovato dopo l'installazione"
# Install PM2 globally (npm package, non apt)
npm install -g pm2 || error "Installazione PM2 globale fallita"
success "Node.js $(node -v) installato"

# ── PostgreSQL setup ──────────────────────────────────────────
step "Configurazione PostgreSQL"

# Rileva versione PostgreSQL installata dal binario
PG_VERSION=$(pg_config --version 2>/dev/null | grep -oE '[0-9]+' | head -1)
[[ -z "$PG_VERSION" ]] && error "PostgreSQL non installato correttamente (pg_config non trovato)"
info "PostgreSQL versione $PG_VERSION rilevata"

# Assicura che esista un cluster (su alcuni VPS non viene creato automaticamente)
if ! pg_lsclusters 2>/dev/null | grep -q "^$PG_VERSION "; then
  info "Nessun cluster PostgreSQL trovato, creo 'main'..."
  pg_createcluster "$PG_VERSION" main || error "Impossibile creare il cluster PostgreSQL $PG_VERSION"
fi

# Prova prima il service versioned (postgresql@16-main), poi il generico
PG_SERVICE="postgresql@${PG_VERSION}-main"
if ! systemctl cat "$PG_SERVICE" &>/dev/null; then
  PG_SERVICE="postgresql"
fi
if ! systemctl cat "$PG_SERVICE" &>/dev/null; then
  error "Servizio PostgreSQL non trovato ($PG_SERVICE). Controlla l'installazione."
fi

systemctl enable "$PG_SERVICE" --quiet
systemctl start "$PG_SERVICE"
systemctl is-active --quiet "$PG_SERVICE" || error "PostgreSQL non si è avviato (service: $PG_SERVICE)"

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
systemctl is-active --quiet redis-server || error "Redis non si è avviato correttamente"
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
# Node.js ascolta porta 587/465 per i client SMTP
# e passa la posta a Postfix sulla porta 25 (locale, loopback only)
RELAY_PROVIDER=postfix
RELAY_HOST=127.0.0.1
RELAY_PORT=25
RELAY_SECURE=false
RELAY_TLS_REJECT_UNAUTHORIZED=false

# DKIM — chiave unica server-wide (approccio CNAME, come Mailgun/Brevo)

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

# ── Configure OpenDKIM (chiave unica server-wide, approccio CNAME) ───────────
step "Configurazione OpenDKIM"

DKIM_KEY_DIR="/etc/opendkim/keys/${DOMAIN}"
mkdir -p "$DKIM_KEY_DIR"

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

# Genera la chiave DKIM del server (una sola, usata per tutti i domini clienti)
opendkim-genkey -b 2048 -d "${DOMAIN}" -D "${DKIM_KEY_DIR}" -s smtpflow 2>/dev/null || true
chown -R opendkim:opendkim "${DKIM_KEY_DIR}"
chmod 600 "${DKIM_KEY_DIR}/smtpflow.private"

# KeyTable: unica entry per il server
echo "smtpflow._domainkey.${DOMAIN} ${DOMAIN}:smtpflow:${DKIM_KEY_DIR}/smtpflow.private" > /etc/opendkim/KeyTable

# SigningTable: firma TUTTI i domini con la chiave del server (wildcard)
echo "* smtpflow._domainkey.${DOMAIN}" > /etc/opendkim/SigningTable

# Collega Postfix a OpenDKIM
postconf -e "milter_protocol = 6"
postconf -e "milter_default_action = accept"
postconf -e "smtpd_milters = inet:localhost:12301"
postconf -e "non_smtpd_milters = inet:localhost:12301"

systemctl enable opendkim --quiet 2>/dev/null || true
systemctl restart opendkim 2>/dev/null || true
systemctl restart postfix
success "OpenDKIM configurato (chiave server-wide)"

# ── Configure Nginx ───────────────────────────────────────────
step "Configurazione Nginx"

# Remove default
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Install config (HTTP first, HTTPS after certbot)
# Nginx fa da reverse proxy completo verso Node.js (porta 3000)
# che serve sia le API che il frontend React in production
cat > "/etc/nginx/sites-available/smtpflow" << NGINX_HTTP
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
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

# Il frontend/dist deve essere leggibile da nginx (www-data)
# Le directory superiori devono avere il bit execute per la traversal
chmod o+x "$APP_DIR"
chmod o+x "$APP_DIR/frontend"
find "$APP_DIR/frontend/dist" -type d -exec chmod 755 {} \;
find "$APP_DIR/frontend/dist" -type f -exec chmod 644 {} \;

# Aggiungi www-data al gruppo smtpflow come ulteriore fallback
usermod -aG "$APP_USER" www-data 2>/dev/null || true

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
DKIM_TXT_FILE="/etc/opendkim/keys/${DOMAIN}/smtpflow.txt"

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
echo -e "  ${CYAN}Tipo   Host                                  Valore${NC}"
echo -e "  A      ${DOMAIN}                     <IP del server>"
echo -e "  MX     ${DOMAIN}                     10 ${DOMAIN}"
echo -e "  TXT    ${DOMAIN}                     v=spf1 a:${DOMAIN} ~all"
if [[ -f "$DKIM_TXT_FILE" ]]; then
  DKIM_VAL=$(grep -oP '".*?"' "$DKIM_TXT_FILE" | tr -d '"' | tr -d '\n' 2>/dev/null)
  echo -e "  TXT    smtpflow._domainkey.${DOMAIN}"
  echo -e "         ${DKIM_VAL}"
fi
echo -e ""
echo -e "${BOLD}Record DNS che i tuoi clienti devono aggiungere (per ogni loro dominio):${NC}"
echo -e "  ${CYAN}Tipo   Host                    Valore${NC}"
echo -e "  TXT    @                       v=spf1 include:_spf.${DOMAIN} ~all"
echo -e "  CNAME  smtpflow._domainkey     smtpflow._domainkey.${DOMAIN}"
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
