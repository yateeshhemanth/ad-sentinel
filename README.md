# ADSentinel Enterprise — Multi-Tenant AD Auditing Portal

## Environments

| | Dev | Prod |
|---|---|---|
| HTTP  | `localhost:8080` | `localhost:80`  |
| HTTPS | `localhost:8443` | `localhost:443` |
| DB exposed | ✅ port 5432 | ❌ internal only |
| Source mount | ✅ live reload | ❌ built image |
| Log level | `debug` | `info` |
| Rate limits | relaxed | strict |

---

## Quick Start

### 1. Make startup script executable
```bash
chmod +x start.sh
```

### 2. Configure your env file
```bash
# For dev — edit passwords/secrets
nano .env.dev

# For prod — edit ALL secrets
nano .env.prod
```

### 3. Start

```bash
./start.sh dev        # Dev  → http://localhost:8080  (foreground)
./start.sh prod       # Prod → http://localhost:80    (detached)
```

### All commands
```bash
./start.sh dev  up        # Start (default)
./start.sh dev  down      # Stop
./start.sh dev  logs      # Tail logs
./start.sh dev  build     # Force rebuild images
./start.sh dev  restart   # Rebuild + restart
./start.sh dev  ps        # Show containers
./start.sh prod up        # Start prod detached
./start.sh prod down
./start.sh prod logs
```

### Manual docker compose (equivalent)
```bash
# Dev
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml --env-file .env.dev up

# Prod
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## File Structure

```
ad-sentinel/
├── start.sh                       ← Entry point
├── docker-compose.base.yml        ← Shared services (no ports)
├── docker-compose.dev.yml         ← Dev overrides (8080/8443)
├── docker-compose.prod.yml        ← Prod overrides (80/443)
├── .env.dev                       ← Dev environment variables
├── .env.prod                      ← Prod environment variables
├── nginx/
│   ├── nginx.conf                 ← Prod (strict, rate-limited)
│   ├── nginx.dev.conf             ← Dev (relaxed, debug headers)
│   └── ssl/cert.pem + key.pem    ← TLS certificates
├── frontend/
│   ├── Dockerfile                 ← node:18 builder + nginx
│   ├── public/index.html
│   └── src/
│       ├── App.jsx
│       ├── constants/theme.js
│       ├── context/AuthContext.jsx
│       ├── utils/api.js
│       ├── utils/exportUtils.js
│       ├── data/mockData.js
│       └── components/
│           ├── Auth/              ← Login, ForgotPwd, ResetPwd
│           ├── Layout/Topbar.jsx
│           ├── shared/            ← Design system components
│           ├── Dashboard/
│           ├── CustomerAudit/
│           ├── Alerts/            ← AlertsPanel + CreateTicketModal
│           ├── Tickets/
│           ├── Reports/
│           ├── Settings/
│           └── AuditLog/
└── backend/
    ├── server.js
    ├── config/db.js + redis.js + logger.js
    ├── middleware/auth.js
    └── routes/
        ├── auth.js      ← Login/logout/reset password
        ├── alerts.js
        ├── tickets.js   ← CRUD + comments + alert linkage
        ├── reports.js   ← PDFKit + CSV
        ├── customers.js
        ├── logo.js
        └── settings.js
```

---

## Default Login

```
Dev URL:  http://localhost:8080
Prod URL: http://localhost

Email:    admin@adsentinel.local
Password: Admin@Dev1234!  (dev — set in .env.dev)
          set ADMIN_PASSWORD in .env.prod
```

Change the admin password immediately after first login.

---

## SSL / HTTPS

Self-signed cert for dev:
```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem \
  -subj "/CN=localhost"
```
Place real certs in `nginx/ssl/` for prod.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, React Router v6 |
| PDF (client) | jsPDF + jspdf-autotable |
| CSV | PapaParse + file-saver |
| Backend | Node.js 18 + Express |
| Database | PostgreSQL 15 |
| Cache | Redis 7 |
| PDF (server) | PDFKit |
| Email | Nodemailer |
| AD | ldapjs |
| Proxy | Nginx 1.25 |
| Containers | Docker Compose v2 |
