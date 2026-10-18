# API

All `/api` routes and `/` require HTTP Basic authentication (`APP_USERNAME` / `APP_PASSWORD`). `/healthz` is public. Errors use FastAPI's `detail` field.

| Method | Route | Purpose |
|---|---|---|
| GET | /healthz | Process health |
| GET | /api/status | Dataset metadata, model name, `providers.{nemotron,tavily}` with `configured`, `ok`, `tested_at`, `detail` |
| POST | /api/connection-test | Sends one small live request to each configured provider and returns `/api/status` |
| POST | /api/upload | Multipart CSV import, up to 20 MB |
| POST | /api/shortlist | Stateless screening and ranking; at most 20 results |
| POST | /api/compare | Full source records for 1–20 distinct known supplier IDs |
| POST | /api/chat | Nemotron tool loop; returns `reply`, updated `selection`, optional `comparison`, `job_id`, `trace[]`, `model` |
| POST | /api/research | Start asynchronous real-company research; returns `job_id` (202) |
| GET | /api/research | Recent jobs (id, company, status, created, elapsed, sources, error) |
| GET | /api/research/{job_id} | Job steps, sources, follow-up decision, report, citation_warning, error |

`Selection`: component, profile (`quality_first` | `balanced` | `financial_first`), max_risk (0–100 source TRI), query, exclude[], candidate_ids[], limit (1–20).

Shortlist response: suppliers[] (id, name, tri, level, scores{}, source_levels{}, operations{}, buyer_score, contributions{}, rank), total, scoped, matched, unrankable, risk_filtered, missing_candidate_ids[], excluded[] ({id,name}), weights{}, version, request, capability.

`operations` holds the organizer file's non-score columns: po_volume_eur, order_change_rate, delivery_rating, confirmation_rate (numbers) and sourcing_risk_level, supply_chain_complexity (text). Missing values are null.

Research request: `{ "company": "Knorr-Bremse", "context": "Train brake system" }`. Anonymized dataset names and `SUPP_` IDs are rejected (422). Missing keys return 503.
