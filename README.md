# Auto Workshop — نظام إدارة هندسة السيارات

An Arabic-first (RTL) management system for a vehicle service workshop: vehicle
reception and inspection, live work-order tracking, inventory and parts, payroll,
accounting, customer records, warranty, and automated WhatsApp customer
notifications — plus strictly-formatted A4 inspection reports for printing.

> **Note for contributors / AI agents:** This project targets **Next.js 16**, which
> renamed several conventions (e.g. `middleware` → `proxy`). Read
> [`AGENTS.md`](./AGENTS.md) and the bundled guides in
> `node_modules/next/dist/docs/` before changing framework-level code.

---

## Tech stack

| Area        | Choice |
| ----------- | ------ |
| Framework   | Next.js 16 (App Router), React 19 |
| Language    | TypeScript (strict mode) |
| Styling     | TailwindCSS 4 (dark, glass-card aesthetic), RTL-native |
| Icons       | `lucide-react` |
| Data & Auth | Supabase (PostgreSQL + Auth + Storage) |
| Charts      | Recharts |
| Printing    | `react-to-print` (A4 inspection reports) |
| Spreadsheets| `xlsx` (data export / backup) |
| i18n        | Custom `LanguageProvider` (Arabic default, English available) |

---

## Getting started

### 1. Prerequisites
- Node.js 20+
- A Supabase project (PostgreSQL database + Auth enabled)

### 2. Environment variables
Create a `.env` file in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your publishable key>
SUPABASE_SECRET_KEY=<your secret key>
```

- `NEXT_PUBLIC_*` keys are exposed to the browser (safe — anon key is protected by
  Row-Level Security).
- `SUPABASE_SECRET_KEY` is **server-only**. It bypasses RLS and must never be
  sent to the client. It is used solely by the admin server actions in
  [`src/app/actions/admin.ts`](./src/app/actions/admin.ts), which are guarded by
  `requireAdmin()`.
- Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` variables
  remain supported for existing deployments.

### 3. Run

```bash
npm install
npm run dev      # start the dev server at http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
npm run lint     # ESLint
```

---

## Authentication & authorization

The app uses Supabase Auth with a **username-based** login. Usernames are mapped to
synthetic emails of the form `username@workshop.local`, so staff log in with a
username + password rather than a real email address.

Authorization has three layers:

1. **`proxy.ts`** ([`src/proxy.ts`](./src/proxy.ts)) — coarse, edge-level gate that
   redirects requests without a Supabase session cookie to `/login`. The public
   customer booklet route (`/b/...`) and `/login` are excluded.
2. **`requireAdmin()`** ([`src/lib/supabase-server.ts`](./src/lib/supabase-server.ts))
   — every privileged server action validates the caller's JWT with
   `supabase.auth.getUser()` and confirms their role is `Owner`/`Admin` **before**
   touching the service-role client. Server Actions are public POST endpoints, so
   this in-action check — not the proxy — is the real security boundary.
3. **Supabase Row-Level Security** — the ultimate boundary for all client-side data
   access via the anon key.

Roles: `Owner`, `Admin`, `Supervisor`, `Receptionist`. Per-page access is further
controlled by boolean permission flags on the `employees` row
(`permission_dashboard`, `permission_reception`, `permission_work_orders`,
`permission_customers`, `permission_reports`, `permission_employees`). These are
surfaced through [`AuthProvider`](./src/lib/AuthProvider.tsx).

---

## Project structure

```
src/
├── app/
│   ├── page.tsx               # Dashboard
│   ├── login/                 # Username/password login
│   ├── reception/             # Vehicle intake + inspection (Standard / Sector variants)
│   ├── work-orders/           # Live workshop floor + per-order detail
│   ├── customers/             # Customer & vehicle registry + profiles
│   ├── inventory/ parts-db/   # Stock and parts catalogue
│   ├── payroll/ accounting/   # Finance
│   ├── financial-reports/ reports/ analytics/
│   ├── warranty/ documents/ services/ suggestions/ status/ alerts/
│   ├── whatsapp/              # WhatsApp BSP notification console
│   ├── settings/ employees/   # Admin: user & employee management
│   ├── b/[serial]/            # PUBLIC customer-facing vehicle booklet (QR)
│   ├── print/[id]/            # Clean print shell for A4 reports
│   └── actions/admin.ts       # Service-role server actions (admin-guarded)
├── components/                # Shared UI, charts, printable reports
└── lib/
    ├── supabase.ts            # Browser (anon) client
    ├── supabase-server.ts     # Server (cookie) client + requireAdmin()
    ├── AuthProvider.tsx       # Session + role + permissions context
    ├── i18n/                  # LanguageProvider + dictionaries
    └── types.ts               # Supabase Database types
```

---

## Routing notes

- **Public route:** `/b/[serial]` is intentionally accessible without login — it is
  the customer-facing vehicle service booklet opened via QR code.
- **Print routes:** `/print/[id]` render on a clean white shell without the sidebar
  or providers, for accurate A4 output.

---

## Known tech debt

Tracked here so it isn't rediscovered each time:

- **`any` types (~213 occurrences).** Several Supabase query results and JSON
  columns (e.g. `selected_services`) are typed `any`, which weakens `strict` mode.
- **Large client components.** `reception/components/StandardReception.tsx` and
  `SectorReception.tsx` (~2,000 lines each) mix data fetching, business logic and
  JSX; candidates for extraction.
- **Client-heavy data fetching.** Most pages are `"use client"` and read directly
  from Supabase; the security model therefore leans on RLS. Moving read paths to
  Server Components would add defense-in-depth.
- **A few `react-hooks/set-state-in-effect` warnings** in providers that initialise
  from `localStorage` (theme/language/currency). Behaviour-sensitive — change with
  care to avoid hydration regressions.
