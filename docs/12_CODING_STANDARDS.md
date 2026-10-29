# ElDental — Coding Standards

---

## 1. General
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` (use `unknown` + narrowing). No `@ts-ignore` without a linked reason.
- ESM everywhere. Path alias `@/` maps to `src/` in both apps.
- Prettier: 100 columns, single quotes, trailing commas, semicolons. ESLint must pass with zero warnings in CI.
- English identifiers, correctly spelled. Hakeemna had `Apointment`, `expences`, `remiders`, `attendence`, `Phone_number`; do not repeat that.
- Naming:
  - `camelCase` for variables, fields and functions;
  - `PascalCase` for types, classes and React components;
  - `UPPER_SNAKE` for constants and error codes;
  - kebab-case for URL paths;
  - files are `feature.role.ts` (backend) and `PascalCase.tsx` for components.
- Small functions, early returns, no nested ternaries. Pure functions for business calculations (availability, payroll, posting rules, invoice totals) so they are unit-testable.
- Comments explain **why**, not what. JSDoc on exported service functions.

## 2. Backend specifics
- Controllers are thin. Business logic lives in services, and DB access only in repositories.
- Always `throw new ApiError(status, 'ERROR_CODE', message, details?)`. A global handler formats it. Async handlers are wrapped (Express 5-style, or `asyncHandler`).
- Wrap multi-document writes in `withTransaction`. Never send network calls (email, WhatsApp, JoFotara) inside a transaction; emit events after commit and let jobs do it.
- Read `env` from `config/env.ts` only.
- Use `logger` (pino) and never `console.log`.
- Dates: store `Date` in UTC; clinic-local "calendar dates" are `YYYY-MM-DD` strings. Use the helpers in `shared/dates.ts` for anything involving the timezone.
- Money: only through `shared/money.ts`.
- Every new model gets the base plugins plus indexes declared in the schema. Every query that could be large uses an index (check with `explain` in tests for hot paths).

## 3. Frontend specifics
- Data via TanStack Query hooks from `features/<f>/api`. Components do not call axios directly.
- Forms use react-hook-form + Zod. Never `useState` per field.
- All strings go through i18n (`ar` and `en` keys added together).
- Components are ≤ ~200 lines; extract sub-components and hooks.
- MUI `sx` for one-off styles; theme overrides for repeated styles. No inline colours; use theme tokens.

## 4. Testing
| Layer | Tool | What |
|---|---|---|
| Pure logic | Vitest | availability engine, payroll calc, posting rules, money, state machines, permission resolution |
| API | Vitest + supertest + mongodb-memory-server (replica set) | every route: happy path, validation 422, 401/403, scope 404, tenant isolation |
| Frontend unit | Vitest + Testing Library | complex components (ToothChart, InvoiceEditor, RoleEditor), hooks |
| E2E | Playwright | critical journeys: login → book → check-in → chart → perform → invoice → pay; leave request → approve; payroll run |

- Test data via factories (`test/factories/*.ts`). No shared mutable fixtures.
- Coverage target: services and pure logic ≥ 85%, overall ≥ 70%.

## 5. Git
- Branches: `main` (protected), `feat/<module>-<short>`, `fix/…`, `chore/…`.
- Conventional Commits: `feat(scheduling): compute availability from dentist schedules`.
- Small PRs per feature slice. CI (GitHub Actions) runs lint, typecheck, test and build for both apps.
- Never commit `.env`, uploads, logs or dumps (see `.gitignore`).

## 6. Definition of Done (per module)
- [ ] Models + indexes + base plugins
- [ ] Zod DTOs + OpenAPI registration
- [ ] Repository (tenant-scoped) + service + controller + routes with `authorize`
- [ ] Domain events and jobs wired (if any)
- [ ] Audit logging for sensitive actions
- [ ] Unit + API tests (incl. 403/404-scope/tenant isolation) passing
- [ ] Frontend: API hooks, pages, forms, permission gating, ar + en translations, loading/empty/error states
- [ ] Seed data updated (if relevant)
- [ ] Docs updated if behaviour differs from the spec
- [ ] `npm run lint && npm run typecheck && npm test` green in both apps
