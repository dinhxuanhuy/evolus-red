# EVOLUS RED — web console

React 19 + Vite + Tailwind v4 + lucide-react. Full project context lives in the root `README.md`.

```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api → http://localhost:8787)
npm run build    # type-check + production bundle
npm run lint     # oxlint
```

Pages:

| Route | What |
| --- | --- |
| `/` | Campaigns — stats strip + red-team log table with report downloads |
| `/new` | New campaign — paste a cURL, parse, test the connection, launch |
| `/campaigns/:id` | Live SSE feed, per-round probes/verdicts, exported report |
| `/settings` | Evolus agents, AttackLoop workflow gate, mock demo target |

The visual language (obsidian dark surfaces, mono labels, red accent) is ported from the AI_RedTeam
reference UI.
