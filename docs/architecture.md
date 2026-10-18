# Architecture

One FastAPI process (`app/main.py`) serves the static frontend (`web/`) and the authenticated JSON API. The CSV is parsed once into memory; Python does all filtering, weighting and sorting. Nemotron never computes a score: it selects among three bounded tools and explains their results.

```
browser ──Basic auth──▶ FastAPI ──▶ shortlist / compare (pure Python over the CSV)
                          │
                          ├─▶ /api/chat ─▶ Token Factory (Nemotron, tool calling) ─▶ tools: rank_suppliers, inspect_suppliers, research_company
                          │
                          └─▶ /api/research ─▶ background job: Nemotron plan → Tavily ×3 → Nemotron gap check → optional Tavily follow-up → Nemotron brief
                                                 └─▶ data/reports/<job>.json (restored at startup)
```

## Bounds

- Chat: 3 concurrent agent requests, at most 5 model rounds and 4 tool calls per round, 120 s total, 60 s per model call. The model receives a compact shortlist (id, name, rank, buyer score, TRI and the three weighted scores), not the full dataset; `inspect_suppliers` returns full records for up to 20 IDs.
- Research: 2 concurrent jobs, 4 queued or running, 150 s per job, 25 s per Tavily call, 40 retained jobs. Three planned searches plus at most one follow-up, four results each.
- Uploads: 20 MB, 50,000 rows, unique IDs, at least one rankable row. A rejected upload leaves the previous dataset in place.
- Provider failures surface as the HTTP status and a short body excerpt without credentials; nothing is simulated.

## State

Dataset, research jobs and connection-test results live in process memory; completed research jobs are also written to `REPORTS_DIR` and reloaded on start. Run one worker and one replica. UI imports replace the dataset for everyone until restart; the bundled organizer CSV is loaded at startup.

## Frontend

Vanilla JavaScript (`web/assets/app.js`): same-origin fetch with the browser's Basic-auth session, a small Markdown renderer for Nemotron output, dialogs for details, comparison and research, and a client-side Markdown export of the sourcing brief. Provider keys never reach the browser.
