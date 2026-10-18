# EVOLUS RED — LLM red-team console

Authorized red-team loops against any chat endpoint: paste the request as a **cURL command**, and the
Evolus agents probe the target round after round, score every reply with ExplainJudge and export a full
markdown/JSON report.

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
| `src/report.ts` | Markdown / JSON report builder |
| `scripts/refresh-report.ts` | Regenerate a stored report (e.g. after label changes) |

**`web/` — React 19 + Vite + Tailwind v4 + lucide icons**

- `src/components/Shell.tsx` — sidebar (nav, running campaigns with stop, platform status) + breadcrumb topbar.
- `src/pages/CampaignsPage.tsx` — stats strip + campaign table with status / mode / target / report download.
- `src/pages/NewCampaignPage.tsx` — the curl-first flow: paste → **Parse & fill** → editable target →
  **Test connection** (benign probe, HTTP status, latency, extracted reply, reply-field suggestions) →
  campaign settings → **Create & start** or **Save draft**.
- `src/pages/CampaignPage.tsx` — live SSE feed / rounds with verdicts / report with severity tiles and
  `report.md` + JSON export; start, re-run and stop controls.
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
   with remediation and the **report.md** / JSON exports.

No target handy? Use the **Demo mock** button: `http://localhost:8787/api/mock/target` implements three
planted weaknesses, so a demo run reliably ends with a Critical verdict on the system-prompt leak.

**Deep scan** runs the `AttackLoop` workflow on the Evolus platform instead of the local loop. It can take
30–60 minutes per campaign and requires the workflow to be enabled — the console never activates it on its
own; you flip it on explicitly in **Settings**.

## Notes

- The workspace model (deepseek-v4.1-flash) is flaky on the gateway (occasional 499 / 504 / 422): the client
  retries 3 times and a campaign that soft-fails can simply be re-run — stored rounds are cleared on re-run
  by design.
- API keys live only in `server/.env` (chmod 600) and are never exposed to the browser. Headers parsed from
  a curl (including credentials) are stored in the campaign record in the local SQLite DB only.
- SQLite database: `server/data/evolus-red.db`.
