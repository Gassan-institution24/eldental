# ElDental — Dental Clinic Management (SaaS)

Multi-clinic web platform for dental practices. It covers:
- appointments and scheduling;
- dental charting and treatment plans;
- billing with **full double-entry accounting** and JoFotara e-invoicing;
- HR and payroll;
- roles and permissions;
- a patient portal.

Arabic (RTL) is the default language, with English as the second.

> Status: **specification stage**. The code is built phase by phase following [`BUILD_PROMPT.md`](BUILD_PROMPT.md) and [`docs/13_ROADMAP.md`](docs/13_ROADMAP.md).

## Tech Stack
| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express 4, TypeScript, Mongoose 8, Zod, JWT (access + rotating refresh), BullMQ, Socket.IO, pino |
| Database | MongoDB 7 (replica set) |
| Cache / Jobs | Redis 7 |
| Frontend | Vite, React 18, TypeScript, MUI v5, TanStack Query, react-hook-form + Zod, i18next, FullCalendar |
| Dev infra | Docker Compose (Mongo, Redis, Mailpit) |

## Repository
```
dentalproject/
├── BUILD_PROMPT.md      # paste these prompts to build the project
├── CLAUDE.md            # rules for AI-assisted development
├── docker-compose.yml   # mongo + redis + mailpit for local dev
├── docs/                # full specification (01–14)
├── backend/             # API (.env / .env.example already provided)
└── frontend/            # web app (.env / .env.example already provided)
```

## Quick Start (after Phase 0 is built)
```bash
docker compose up -d
cd backend  && npm install && npm run seed && npm run dev    # http://localhost:4000/api/v1
cd frontend && npm install && npm run dev                    # http://localhost:5173
```
- Dev emails: http://localhost:8025 (Mailpit).
- API docs: http://localhost:4000/api/docs.

## Documentation
1. [Product Requirements](docs/01_PRD.md)
2. [Architecture](docs/02_ARCHITECTURE.md)
3. [Data Model](docs/03_DATA_MODEL.md)
4. [Roles & Permissions](docs/04_ROLES_AND_PERMISSIONS.md)
5. [API Conventions & Endpoints](docs/05_API_CONVENTIONS.md)
6. [Appointments](docs/06_MODULE_APPOINTMENTS.md)
7. [Dental Clinical](docs/07_MODULE_DENTAL_CLINICAL.md)
8. [HR & Payroll](docs/08_MODULE_HR.md)
9. [Billing & Accounting](docs/09_MODULE_ACCOUNTING.md)
10. [Frontend](docs/10_FRONTEND.md)
11. [Security](docs/11_SECURITY.md)
12. [Coding Standards](docs/12_CODING_STANDARDS.md)
13. [Roadmap](docs/13_ROADMAP.md)
14. [Hakeemna Reference](docs/14_HAKEEMNA_REFERENCE.md)
15. [Logging & Monitoring](docs/15_LOGGING_AND_MONITORING.md)
16. [UX/UI & Input Validation](docs/16_UX_UI_AND_VALIDATION.md)
