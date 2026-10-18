# Implementation status (18 October 2026)

## Verified locally

- **Backend tests**: 16 unittest cases pass (`.venv/bin/python -m unittest discover -s tests`). They cover login and the secret boundary, placeholder keys treated as unconfigured, ranking under all three profiles, exclusion and recalculation, TRI threshold and candidate scope, comparison bounds, CSV upload with missing / invalid values (never zero), rejected uploads leaving the dataset intact, the full 10,000-row organizer file with operational columns, provider-missing responses (503), connection-test failure reporting without leaking keys, anonymized-name rejection for research, an agent tool call that updates the shortlist and merges exclusions, an agent inspect + rejected research turn, provider errors returning 502 with no fabricated answer, the research flow with follow-up, persistence and reload, and a research provider error surfaced to the job.
- **Browser (Playwright, headless Chromium, 1440×900 and 390×844)**: page renders 20 rows from the organizer CSV, profile switch, exclusion of the leader with an excluded chip, comparison of two suppliers (26 rows: buyer score, TRI, 18 scores, 6 facts), supplier detail dialog (19 metrics, 6 facts), research submit without keys shows the provider message, chat without keys shows the guidance toast, Test connections updates both chips, risk slider changes the funnel (150 pass at TRI ≤ 20), candidate scope reports unknown IDs, brief download produces a Markdown file. No horizontal page overflow at either width; the shortlist table scrolls inside its card on phones.
- **Docker**: `gauge:local` (arm64) and `gauge:amd64` (`docker buildx --platform linux/amd64`) build; the container starts, `/healthz` returns 200, `/api/status` reports 10,000 rows, and `.env` is excluded from the image.
- **Model ID**: `nvidia/Nemotron-3.5-Super-VL` is present in the public Token Factory catalog with function calling (checked 18 Oct 2026).
- **Nebius CLI** 0.12.291 installed; the `nebius-cloud` skills plugin is installed for the Claude Code session.

- **Tavily live**: the connection test performed a real basic search with the configured key (18 Oct 2026, 16:09). On the corporate laptop this needed the operating-system trust store (`truststore`), now wired in at startup.

- **Token Factory live** (18 Oct 2026, 16:20): the connection test got an answer from `nvidia/Nemotron-3.5-Super-VL`. Two agent turns ran real tool calls: "switch to financial resilience and explain #1 vs #2" produced `rank_suppliers` → `inspect_suppliers` with a correct tie-break explanation in 8–10 s; "SUPP_00003 cannot deliver" produced an exclusion merge, recalculation and a hidden-risk explanation of the new leader in 7 s.
- **Research live**: Knorr-Bremse completed in 17 s: Nemotron planned 3 searches, Tavily returned 12 sources, Nemotron decided no follow-up was needed, and wrote a cited brief with all citations valid. An earlier failure (empty JSON) was traced to reasoning tokens consuming `max_tokens`; JSON steps now run with thinking disabled and empty answers are retried.
- **Nebius Cloud**: profile `hackathon` authenticated; project `group50-project` (`project-e05pcx4nln00sb3fae3bgx`) readable; CPU platform `cpu-d3` with presets from 2 vCPU / 8 GB ($0.066/h) upward; quotas 20 non-GPU vCPU, 1 registry, 1 public IP; registry `registry-e05acvg6r401qqek32` created; MysteryBox secret `gauge-secrets` created from `.env`.

## Deployed and verified on the public URL (18 Oct 2026, 16:45–16:52)

- Endpoint `gauge-v2` (`aiendpoint-e05bd4vv156q3khy3m`) in `group50-project`, `cpu-d3` / `2vcpu-8gb`, image `gauge:036fbd3` with main `f620c5d` overlaid at start by `deploy/start-from-github.py` (see docs/deployment.md), platform auth off, `APP_AUTH=off` (no app login). URL: https://port8000-zkrzh7367ezc7ay.tunnel.applications.uk-south2.nebius.cloud
- Verified 18 Oct 2026: `/healthz` 200; `/` 200 without login and serves the research screen; `/api/research` accepts a free-text question; `/api/status` 10,000 rows, auth false; connection test Nemotron and Tavily ok.
- Replaced `gauge-open` (`aiendpoint-e05xkp1c1mkrv20029`, previous UI) and, before it, the login-protected `gauge` (`aiendpoint-e05yarz65dfd332df3`, image `gauge:3bceda5`).
- `/api/status` reports 10,000 rows; connection test: Nemotron answered, Tavily returned a result.
- Live chat through the public URL: "switch to financial resilience and explain #1 vs #2" ran `rank_suppliers` → `inspect_suppliers` in 6 s; "inspect SUPP_00003" ran `inspect_suppliers` in 4 s; the browser suggestion button produced a 553-character answer with a visible tool trace.
- Live research through the public URL: Knorr-Bremse completed in 21 s with 3 planned searches, a follow-up search chosen by Nemotron after it spotted a U.S. DOJ antitrust filing in the excerpts, 16 sources, and a cited brief with no citation warnings. Three completed reports are listed in the research dialog on the deployment.
- Playwright on the public URL at 1440×900 and 390×844: 20 rows, profile switch, exclusion, comparison (26 rows), detail (19 metrics, 6 facts), slider, candidate scope, brief download, no page overflow, no console errors.

## Operations

- Status / logs / stop / start: `NEBIUS_PROJECT_ID=project-e05pcx4nln00sb3fae3bgx deploy/nebius-deploy.sh status|logs|stop|start`
- Delete when the event is over: `deploy/nebius-deploy.sh delete-command` prints the command. The endpoint bills about $0.066 per hour until deleted.
- Image `gauge:036fbd3` (adds the `APP_AUTH=off` switch) is the deployed base image; the research screen from main `f620c5d` is overlaid at start.

## Known limitations

- The organizer CSV has no component-capability columns. Shortlists are risk screens; candidate scoping by supplier ID is the only component filter and the UI says so.
- Under the default screen, the top suppliers have identical 0.0 buyer scores under several profiles because the file contains suppliers with 0 in all three weighted columns; tightening the TRI slider or scoping candidates makes the profile differences visible.
- Dataset, chat state and the connection-test result are in process memory; research reports are written to `data/reports` (container disk on the endpoint, removed on stop). Run one replica.
- Chat has no persisted conversation history; each question includes the current selection.
- Citation checking only validates that cited IDs exist, not that each claim is supported.
