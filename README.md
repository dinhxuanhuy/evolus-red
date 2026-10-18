# EVOLUS RED — LLM red-team console

Authorized red-team loops against any chat endpoint: paste the request as a **cURL command**, and the
Evolus agents probe the target round after round, score every reply with ExplainJudge and export a full
HTML/JSON report.

The web console follows the **obsidian** design language of the AI_RedTeam reference UI (dark surfaces,
hairline borders, mono labels, red action accent). All UI copy is English.

## Structure

**`server/` — Node 24 (TypeScript run directly, no build) + Express + SQLite (`node:sqlite`)**

| File | Role |
| --- | --- |
| `src/orchestrator.ts` | Quick loop: recon → attack → judge per round, runs in background, streams SSE events |
| `src/curl.ts` | cURL parser: shell tokenizer (quotes, `\` and `$'…'` continuations) → URL / method / headers / body template, maps the message field to `{{messageJson}}` or `{{message}}` |
| `src/target.ts` | Dynamic target adapter: URL placeholders (GET query), method, headers (array or object), body template, response path, session header, timeout; `suggestReplyPaths()` powers the reply-field chips |
| `src/evolus.ts` | Evolus platform client: 4 agents + REST workflow calls; 3 retries with backoff, 600 s timeout |
| `src/routes.ts` | REST + SSE `/api/campaigns/:id/events` (reconnect via `Last-Event-ID`), `/api/parse-curl`, `/api/targets/test` |
| `src/mock.ts` | Deliberately vulnerable mock chatbot (system-prompt leak, fake admin mode, multi-turn memory poisoning) |
| `src/report.ts` | Markdown / JSON report builder (the printable HTML export is rendered client-side from the report JSON) |
| `scripts/refresh-report.ts` | Regenerate a stored report (e.g. after label changes) |
| `scripts/build-api-lib.mjs` | Generate the CommonJS modules `api-lib/curl.js` + `api-lib/target.js` from `src/` for the Vercel function |
| `scripts/export-demo-seed.ts` | Snapshot the SQLite demo data into `api-lib/seed-data.js` for the static Vercel demo |

**`api/` + `api-lib/` — Vercel serverless demo of the whole stack (static, read-only)**

| File | Role |
| --- | --- |
| `api/index.ts` | The only serverless function: routes every `/api/*` (rewritten from `/api/:path(.*)` via `vercel.json`) |
| `api-lib/http.js` | CommonJS helpers (JSON/text replies, body reader) + the demo `501` note |
| `api-lib/curl.js`, `api-lib/target.js` | Generated from `server/src/*.ts` by `scripts/build-api-lib.mjs` |
| `api-lib/seed-data.js` | Generated campaign/round/event/report snapshot for the demo |
| `api-lib/mock.js` | The same vulnerable mock chatbot, ported to CommonJS |
| `vercel.json` | Build `web/`, serve `web/dist`, rewrite `/api/:path(.*)` → `/api/index?__path=:path`, SPA fallback |

**`web/` — React 19 + Vite + Tailwind v4 + lucide icons**

- `src/components/Shell.tsx` — sidebar (nav, running campaigns with stop, platform status) + breadcrumb topbar.
- `src/pages/CampaignsPage.tsx` — stats strip + campaign table with status / mode / target / report download.
- `src/pages/NewCampaignPage.tsx` — the curl-first flow: paste → **Parse & fill** → editable target →
  **Test connection** (benign probe, HTTP status, latency, extracted reply, reply-field suggestions) →
  campaign settings → **Create & start** or **Save draft**.
- `src/pages/CampaignPage.tsx` — live SSE feed / rounds with verdicts / report with severity tiles and
  `report.html` (self-contained, printable) + JSON export; start, re-run and stop controls.
- `src/pages/SettingsPage.tsx` — Evolus agents, the AttackLoop workflow gate (deep scans) and the mock target.

## Run

```bash
# 1) backend
cd server
cp .env.example .env        # EVOLUS_API_KEY, EVOLUS_APPLICATION_ID, the 4 agent IDs (+ workflow for deep scans)
npm install
npm start                   # http://localhost:8787

# 2) frontend
cd ../web
npm install
npm run dev                 # http://localhost:5173  (proxy /api → 8787)
```

## Use

1. Open the chat you are allowed to test, send one message, DevTools → Network → right-click the request →
   **Copy as cURL**.
2. Open http://localhost:5173 → **New campaign** → paste the curl → **Parse & fill**. Endpoint, method,
   headers and the request template are extracted; the field that carries the user message becomes the probe
   slot. Warnings are shown for anything that could not be mapped.
3. **Test connection** sends one benign hello through the exact campaign pipeline and suggests reply fields —
   click one to use it.
4. Set the campaign name, mode (Quick loop), max rounds, the Security Policy (the judge's rubric) and confirm
   authorization → **Create & start**.
5. The campaign page streams the loop live; when it finishes, the Report tab shows severity tiles, findings
   with remediation and the **report.html** (self-contained, printable) / JSON exports.

No target handy? Use the **Demo mock** button: `http://localhost:8787/api/mock/target` implements three
planted weaknesses, so a demo run reliably ends with a Critical verdict on the system-prompt leak.

**Deep scan** runs the `AttackLoop` workflow on the Evolus platform instead of the local loop. It can take
30–60 minutes per campaign and requires the workflow to be enabled — the console never activates it on its
own; you flip it on explicitly in **Settings**.

## Deploy

The stack has two deployment shapes:

- **Monorepo on Vercel (static demo, read-only)** — the entire repo as one Vercel project: the console is
  served statically and a single serverless function answers `/api/*` from a recorded-data snapshot. This is
  how **amd.vinai.io.vn** runs. Browsing campaigns, cURL parsing, connection tests, live Evolus workflow
  status and the mock target are real; starting/stopping campaigns needs the self-hosted backend.
- **Split deployment (full app)** — `web/` static on Vercel (or anywhere) + `server/` as a long-running,
  stateful process on Railway/Render/Fly/VPS. Serverless platforms cannot run `server/` as-is: the SQLite
  file is ephemeral there and quick loops / Deep-scan polling / SSE outlive a function invocation.

### Vercel (monorepo static demo)

1. Import the repo as a Vercel project and leave **Root Directory empty**, framework preset **None** —
   `vercel.json` supplies everything:
   - build `cd web && npm install && npm run build`, output `web/dist`;
   - rewrite `/api/:path(.*)` → `/api/index?__path=:path` (one router function: the Hobby plan caps a
     deployment at 12 functions, and standalone file-based functions cannot match multi-segment dynamic
     routes like `/api/campaigns/:id/report`);
   - SPA fallback to `index.html` for the client-side routes.
2. Environment variables (Production): `EVOLUS_API_KEY`, `EVOLUS_APPLICATION_ID` and the four agent IDs
   (`EVOLUS_RECON_AGENT`, `EVOLUS_ATTACKER_AGENT`, `EVOLUS_JUDGE_AGENT`, `EVOLUS_PLANNER_AGENT`) plus
   `EVOLUS_WORKFLOW_ID` — used only by `/api/meta` (live workflow status) and `/api/targets/test`. When they
   are absent the demo still works; meta reports `Evolus API key not configured on this deployment`.
3. In **demo mode** (the `api/` functions) the frontend hides start/stop controls and skips SSE; `start`,
   `stop`, `events` and `workflow/toggle` answer `501` with a note pointing at the self-hosted backend —
   `/api/meta` exposes `demo.readOnly` so the UI adapts automatically. In self-hosted mode `demo` is `null`
   and everything is live.

Two modules under `api-lib/` are **generated** — re-run these after changing the target/curl pipeline or
after recording new demo campaigns (then commit the regenerated files):

```bash
node server/scripts/build-api-lib.mjs          # api-lib/curl.js + api-lib/target.js  (from server/src)
cd server && node scripts/export-demo-seed.ts  # api-lib/seed-data.js               (from server/data/*.db)
```

They are CommonJS by necessity: Vercel compiles `api/` to CJS and rejects ESM `.mjs` requires
(`ERR_REQUIRE_ESM`); TypeScript imports outside `api/` fail to resolve at runtime.

### Full app, part 1 — frontend on Vercel (Root Directory `web`)

1. Vercel → **Add New… → Project** → import this repo.
2. **Root Directory: `web`** (framework preset *Vite* is auto-detected; build `npm run build`, output `dist`).
3. Environment variables — only `VITE_API_BASE` belongs on Vercel, and it is **build-time** (Vite bakes it
   into the bundle, so a change requires a new deployment):
   - Dashboard: **Project → Settings → Environment Variables** → `VITE_API_BASE=https://<your-server-domain>`
     (Production; add Preview too if you use preview URLs) → **Redeploy**.
   - CLI: `cd web && npx vercel env add VITE_API_BASE production`, then `npx vercel --prod`;
     `npx vercel env ls` to check, `npx vercel env pull .env.local` to use the values locally.
   - No dashboard at all: commit `web/.env.production` with the same line — a public server URL, not a
     secret, and Vite reads `.env.production` during the build.
   - Leave it empty for single-server mode. `web/vercel.json` adds the SPA fallback for client-side routes.
   - All `EVOLUS_*` secrets stay on the server (see below) — never on Vercel.

### Full app, part 2 — backend on Railway (or Render/Fly, same Dockerfile)

1. Railway → **New Project → Deploy from GitHub repo**, root directory `server` — the `Dockerfile` is used
   (Node 24, TypeScript run directly, `node:sqlite`).
2. Add a **Volume** mounted at `/data` and set `DATA_DIR=/data` so the SQLite database survives redeploys.
3. Env vars: the `EVOLUS_*` block from `server/.env.example` plus
   `CORS_ORIGINS=https://<your-vercel-app>.vercel.app` (comma-separated list of allowed browser origins).
   `server/.env` is gitignored and never deployed — re-enter the values in the Railway service variables
   (dashboard **Variables**, or `railway variables --set 'K=V'`).
4. Railway injects `PORT`; `/api/health` is the healthcheck. Copy the generated domain into `VITE_API_BASE`
   on Vercel, redeploy the frontend, done.

**Single-server** (no Vercel): `cd web && npm run build`, then start the server as usual — when `web/dist`
exists the Express server serves it directly, and no CORS/`VITE_API_BASE` setup is needed.

## Notes

- The workspace model (deepseek-v4.1-flash) is flaky on the gateway (occasional 499 / 504 / 422): the client
  retries 3 times and a campaign that soft-fails can simply be re-run — stored rounds are cleared on re-run
  by design.
- API keys live only in `server/.env` (chmod 600) and are never exposed to the browser. Headers parsed from
  a curl (including credentials) are stored in the campaign record in the local SQLite DB only.
- SQLite database: `server/data/evolus-red.db`.
