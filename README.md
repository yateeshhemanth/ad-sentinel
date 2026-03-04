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

## API Usage Guide (Admin & Automation)

All API routes are under `/api` and (except login/forgot/reset) require a Bearer token.

### 1) Authenticate and capture token

```bash
curl -s -X POST http://localhost:8080/api/auth/login   -H 'Content-Type: application/json'   -d '{"email":"admin@adsentinel.local","password":"Admin@Dev1234!"}'
```

Use the returned `token` as:

```bash
-H "Authorization: Bearer <TOKEN>"
```

### 2) Change password (authenticated user)

```bash
curl -s -X POST http://localhost:8080/api/auth/change-password   -H "Authorization: Bearer <TOKEN>"   -H 'Content-Type: application/json'   -d '{"currentPassword":"OldPass123!","newPassword":"NewPass123!"}'
```

### 3) Customer onboarding template

Fetch required/optional fields before building CSV/import payloads:

```bash
curl -s http://localhost:8080/api/customers/template   -H "Authorization: Bearer <TOKEN>"
```

### 4) Create one AD domain/customer

```bash
curl -s -X POST http://localhost:8080/api/customers   -H "Authorization: Bearer <TOKEN>"   -H 'Content-Type: application/json'   -d '{
    "name":"HQ Forest",
    "domain":"corp.example.com",
    "dc_ip":"10.0.10.15",
    "ldap_port":389,
    "bind_dn":"CN=svc_ldap,OU=Service Accounts,DC=corp,DC=example,DC=com",
    "bind_password":"super-secret",
    "hr_status_url":"https://hr.example.com/api/status",
    "hr_status_token":"hr-token"
  }'
```

### 5) Bulk create/update customers

`POST /api/customers/bulk` accepts `{ "customers": [...] }` and upserts by `domain`.

```bash
curl -s -X POST http://localhost:8080/api/customers/bulk   -H "Authorization: Bearer <TOKEN>"   -H 'Content-Type: application/json'   -d '{
    "customers":[
      {"name":"HQ","domain":"corp.example.com","dc_ip":"10.0.10.15","ldap_port":389},
      {"name":"EU","domain":"eu.example.com","dc_ip":"10.20.0.15","ldap_port":636}
    ]
  }'
```

Response shape:
- `created`: newly inserted customers
- `updated`: existing domains updated and re-activated
- `errors`: per-item failures with original index

### 6) Settings schema + safe update

Get setting contract (types/defaults) before writing values:

```bash
curl -s http://localhost:8080/api/settings/schema   -H "Authorization: Bearer <TOKEN>"
```

Save validated settings:

```bash
curl -s -X PUT http://localhost:8080/api/settings   -H "Authorization: Bearer <TOKEN>"   -H 'Content-Type: application/json'   -d '{
    "portal_title":"ADSentinel",
    "primary_color":"#0ea5e9",
    "scan_interval_hours":"6",
    "retention_days":"365",
    "default_domain":"corp.example.com"
  }'
```

### 7) Frontend helper mapping

The frontend wrappers for these endpoints are in `frontend/src/utils/api.js`:
- `authApi.changePassword(...)`
- `customersApi.template()`
- `customersApi.create(...)`
- `customersApi.bulk(...)`
- `settingsApi.schema()`
- `settingsApi.save(...)`

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
