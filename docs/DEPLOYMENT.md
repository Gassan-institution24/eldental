# Deployment

## Railway (one service, Railway-generated domain)

The backend serves the built frontend, so the app and the API share one origin (`11_SECURITY.md` §4). One Railway service runs everything; there is no separate frontend service.

### Services
| Service | Source | Notes |
|---|---|---|
| **app** | this repo, root directory `/` (empty) | Build `npm run build`, start `npm start` (root `package.json`). Generate a domain under Settings → Networking. |
| **Redis** | Railway Redis | Required in production (BullMQ, rate limits, permission cache). |
| **MongoDB** | MongoDB Atlas (replica set) | Railway's Mongo template is a standalone server; transactions need a replica set. In Atlas, allow `0.0.0.0/0` or Railway's egress IPs. |

Add a **Volume** to the app service mounted at `/data` so uploads survive redeploys (or use `STORAGE_DRIVER=s3`).

### App service variables
`<app>` is the generated host, e.g. `my-app-production.up.railway.app`. No trailing slash anywhere.

```env
NODE_ENV=production
API_PREFIX=/api/v1
APP_NAME=ElDental
API_PUBLIC_URL=https://<app>
FRONTEND_URL=https://<app>
CORS_ORIGINS=https://<app>
FRONTEND_DIST_DIR=../frontend/dist
LOG_LEVEL=info
TRUST_PROXY_HOPS=1
ENABLE_API_DOCS=false
RUN_WORKERS_IN_PROCESS=true

MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/eldental?retryWrites=true&w=majority
REDIS_URL=${{Redis.REDIS_URL}}

JWT_ACCESS_SECRET=<96 hex>
JWT_REFRESH_SECRET=<different 96 hex>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30
REFRESH_COOKIE_NAME=eld_rt
COOKIE_DOMAIN=
COOKIE_SECURE=true
BCRYPT_COST=12
OTP_TTL_MINUTES=10
FIELD_ENCRYPTION_KEY=<64 hex — never change it once data exists>

SEED_SUPERADMIN_EMAIL=<email>
SEED_SUPERADMIN_PASSWORD=<strong password>

DEFAULT_TIMEZONE=Asia/Amman
DEFAULT_CURRENCY=JOD
DEFAULT_LOCALE=ar
DEFAULT_COUNTRY_CODE=962

# Email: Resend over HTTPS (recommended on Railway, where outgoing SMTP can be blocked) …
RESEND_API_KEY=<re_… from resend.com → API keys>
# … or SMTP (used when RESEND_API_KEY is empty)
SMTP_HOST=<host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<user>
SMTP_PASSWORD=<password>
MAIL_FROM="ElDental <sender@address>"

STORAGE_DRIVER=local
UPLOAD_DIR=/data/uploads
MAX_UPLOAD_MB=25
JOFOTARA_ENABLED=false

# Read by the frontend build (Vite bakes them in; redeploy after changing)
VITE_APP_NAME=ElDental
VITE_API_URL=https://<app>/api/v1
VITE_SOCKET_URL=https://<app>
VITE_DEFAULT_LANG=ar
VITE_DEFAULT_TIMEZONE=Asia/Amman
VITE_DEFAULT_CURRENCY=JOD
```

Secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (96 hex) and `randomBytes(32)` for `FIELD_ENCRYPTION_KEY` (64 hex). WhatsApp and JoFotara credentials are never env variables; they are entered in the app (`11` §6).

### First deploy
1. Deploy, then check `https://<app>/health` (liveness) and `https://<app>/ready` (Mongo + Redis).
2. Seed the database once (Railway shell). It also creates the indexes (`autoIndex` is off in production).
   - **Real use:** `npm run seed:admin` — role templates, catalogs and the root superadmin only (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`). Create clinics from the admin panel.
   - **Demo:** `npm run seed` — the same plus the demo clinic and demo users with `Password123!`.
3. Open `https://<app>` and sign in.

**Email sender (Resend):** `MAIL_FROM` must use a domain verified in Resend (Domains → Add domain, then the DNS records). Without a domain use `ElDental <onboarding@resend.dev>`: Resend then delivers **only to the email of your Resend account**, which is enough for testing but not for patients.

If the service does not start, the deploy log begins with `[env] Invalid environment configuration` and the variable at fault.
