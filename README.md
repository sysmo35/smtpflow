# SMTPFlow — SaaS SMTP Server Platform

SMTPFlow è una piattaforma SaaS per server SMTP self-hosted, con dashboard admin e utente, tracking email, gestione pacchetti e provisioning automatico delle credenziali.

## Funzionalità

### Utente
- **Invio email** via SMTP (porta 587/STARTTLS o 465/SSL) con credenziali generate automaticamente
- **Tracking** aperture, click, bounce, spam in tempo reale
- **Dashboard** con statistiche grafiche (trend 30 giorni, donut chart stato email)
- **Storico email** con filtri e dettaglio per singola email
- **Gestione domini** con record DNS (SPF, DKIM, DMARC, MX) auto-generati
- **Credenziali SMTP** visibili e reimpostabili dalla dashboard

### Admin
- **Dashboard globale** con statistiche sistema, top mittenti, trend invii
- **Gestione utenti**: crea, modifica, sospendi, reset SMTP password
- **Gestione pacchetti**: limiti mensili/giornalieri, prezzi, features
- **Log email** globale

## Installazione rapida su VPS

### Requisiti
- Ubuntu 20.04+ o Debian 11+
- VPS con almeno 2 CPU, 2GB RAM, 20GB disco
- Dominio configurato che punta al server

### Procedura

```bash
# 1. Clona il repository
git clone https://github.com/tuorepo/smtpflow.git
cd smtpflow

# 2. Esegui l'installer come root
sudo bash install.sh
```

Lo script installa e configura automaticamente:
- **Node.js 20** — backend runtime
- **PostgreSQL** — database principale
- **Redis** — cache e code
- **Postfix** — MTA per delivery email
- **OpenDKIM** — firma DKIM
- **Nginx** — reverse proxy + static files
- **Certbot** — certificato SSL Let's Encrypt
- **PM2** — process manager con auto-restart
- **UFW** — firewall

### Post-installazione

Configura i record DNS per il tuo dominio:

| Tipo | Host | Valore |
|------|------|--------|
| MX | tuodominio.com | `10 smtp.tuodominio.com` |
| TXT | tuodominio.com | `v=spf1 include:smtp.tuodominio.com ~all` |
| TXT | smtpflow._domainkey.tuodominio.com | (vedi `/etc/opendkim/keys/...`) |
| TXT | _dmarc.tuodominio.com | `v=DMARC1; p=quarantine; rua=mailto:dmarc@smtp.tuodominio.com` |

## Struttura progetto

```
smtpflow/
├── install.sh              ← Script installazione
├── backend/
│   ├── src/
│   │   ├── index.js        ← Entry point
│   │   ├── config.js       ← Configurazione
│   │   ├── database.js     ← Pool PostgreSQL
│   │   ├── logger.js       ← Winston logger
│   │   ├── middleware/
│   │   │   └── auth.js     ← JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js     ← Login/register
│   │   │   ├── admin.js    ← API admin
│   │   │   ├── user.js     ← API utente
│   │   │   ├── send.js     ← HTTP send API
│   │   │   └── tracking.js ← Pixel/bounce
│   │   └── services/
│   │       └── smtpServer.js ← Custom SMTP server
│   └── migrations/
│       └── init.sql        ← Schema DB
└── frontend/
    └── src/
        ├── pages/
        │   ├── admin/       ← Dashboard admin
        │   └── user/        ← Dashboard utente
        └── components/
```

## API HTTP (alternativa a SMTP)

```bash
# Login
curl -X POST https://tuodominio.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"utente@example.com","password":"password"}'

# Invia email (con token JWT)
curl -X POST https://tuodominio.com/api/send \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "destinatario@example.com",
    "subject": "Test email",
    "html": "<h1>Hello!</h1>",
    "from_name": "Il mio servizio"
  }'
```

## Comandi utili

```bash
pm2 status                   # Stato servizi
pm2 logs smtpflow            # Log in tempo reale
pm2 restart smtpflow         # Riavvia app
systemctl status postfix     # Stato Postfix
tail -f /var/log/mail.log    # Log mail server
```

## Licenza

MIT
