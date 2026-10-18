# Gauge

A supplier decision room for the Siemens supplier-risk challenge (GTC Berlin 2026 hackathon). A buyer describes a train-component purchase, screens the organizer risk dataset, compares a shortlist, asks Nemotron to explain the tradeoffs, recalculates when a supplier becomes unavailable, researches a real company on the web and exports a sourcing brief.

One Python/FastAPI process serves the API and a small HTML/CSS/JavaScript frontend adapted from the supplied Gauge design. No frontend build step, no model deployment: Nemotron runs on Nebius Token Factory and web search on Tavily.

## Run locally

Python 3.12 or newer.

```bash
python3.12 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env                  # the hidden .env.example is identical
```

Edit `.env`: set `APP_PASSWORD` (jury login, username `jury`; or `APP_AUTH=off` to run without any login), `NEBIUS_API_KEY` (Token Factory API key, not the Cloud login or a promo code) and `TAVILY_API_KEY`. Blank values and `__SET_ME__` placeholders count as unconfigured. Never commit `.env`.

```bash
python run.py                        # http://localhost:8000
```

The app loads `data/supplier_risk_dataset.csv` (the organizer file, 10,000 suppliers) automatically. Set `SUPPLIER_CSV=sample` to start with the three-row sample instead, or point it at another file. Ranking, comparison, exclusion and the brief work without provider keys; chat and research say so plainly when a key is missing. Click **Test connections** in the app to send one small live request to each provider: a configured key is not a working connection until that passes.

Restart the process after editing `.env`.

## Team setup (second developer)

`.env` is never committed. The shared source of truth for the three secrets is the Nebius MysteryBox secret `gauge-secrets` in `group50-project`; every project editor can read it.

```bash
git clone git@github.com:ohMySol/kebab-ai-hackathon-project.git && cd kebab-ai-hackathon-project
python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
curl -sSL https://artifacts.nebius.cloud/cli/install.sh | bash          # Nebius CLI, once
~/.nebius/bin/nebius profile create hackathon --parent-id project-e05pcx4nln00sb3fae3bgx   # browser login
deploy/pull-env.sh                                                        # writes .env from gauge-secrets
python run.py                                                             # http://localhost:8000, login jury
```

Without CLI access, open the console: group50-project → SecretStash → `gauge-secrets` → current version, and copy the three values into a `.env` made from `env.example`. If a key is rotated, update the secret (`deploy/nebius-deploy.sh secrets` reads the new `.env`) and redeploy; both teammates then rerun `pull-env.sh`.

## The buyer journey

The start screen is a research chat. Ask in plain words, e.g. "We plan to buy <part> from a company called X. Is it a good option right now? What are the best alternatives?" Gauge shows its research plan step by step (a red flag and its "digging deeper" follow-up are highlighted), then a Go / Hold / Avoid verdict with a cited brief, numbered sources and the top 10 dataset alternatives (low quality and safety risk, delivery above 90 %) with + Compare. **Data chat** mode answers questions about the dataset itself. The purchase brief, filters and shortlist below live in the collapsible Supplier explorer.

1. **Purchase brief**: component text, priority profile (quality first, balanced, financial resilience), a maximum source Total Risk Index and an optional candidate scope (your approved supplier IDs).
2. **Shortlist**: Python filters and ranks the whole pool and shows the top 20 with buyer score, source TRI, the three weighted scores and delivery facts. The funnel shows pool → screened → shortlisted counts.
3. **Compare**: add up to 20 suppliers and inspect all 18 original risk scores plus purchase-order volume, delivery rating, confirmation rate, order change rate, sourcing risk level and supply-chain complexity.
4. **Explain**: Ask Gauge (Nemotron via Token Factory) chooses among three tools. `rank_suppliers` and `inspect_suppliers` run in Python and update the visible shortlist and comparison. `research_company` starts live web research.
5. **Unavailable supplier**: mark any row (or the leader) unavailable. The full candidate pool is recalculated, excluded suppliers are listed and can be restored one by one.
6. **Company research**: for an explicitly named real company, Nemotron plans three searches, Tavily retrieves them, Nemotron decides whether one follow-up search is needed, then writes a cited brief. Every step shown corresponds to a real request; provider errors are displayed, never replaced by a canned result. Completed reports persist in `data/reports` and are listed in the research dialog after a restart.
7. **Export**: the sourcing brief (Markdown) contains the selection, funnel, scoring method, shortlist, evidence for the leaders, Nemotron explanations, the separate web research with sources, and the outstanding checks.

## Data rules

- Required columns: `supplierID`, `Supplier Name`, `Total_Risk_Index`, `Quality_Risk_Score`, `Operational_Resilience_Score`, `Financial_Health_Score`. Every other `*_Score` column is shown in details and comparison; `*_Level` columns are kept as supplied.
- Every `_Score` is a risk score: 0 lowest risk, 100 highest, including Financial_Health_Score and Operational_Resilience_Score. Lower is better everywhere.
- Missing, non-numeric or out-of-range scores stay unknown. Rows missing a required score are reported as unrankable, never ranked as zero risk. Rows without a valid TRI cannot pass a TRI screen.
- Buyer score is app-defined and separate from the supplied Total Risk Index, whose weighting is not published:

| Priority | Quality | Operations | Financial risk |
|---|---:|---:|---:|
| Quality first | 50% | 30% | 20% |
| Balanced | 1/3 | 1/3 | 1/3 |
| Financial resilience | 20% | 20% | 60% |

- The organizer CSV has no component-capability, location, certification, price or lead-time columns, so Gauge never claims them. Buyers can scope the pool with known candidate IDs; the UI labels the gap on every shortlist.
- Supplier names are anonymized and are never mapped to real companies. Real-company web research is a separate evidence trail and does not change any score.

## Test

```bash
.venv/bin/python -m unittest discover -s tests -v    # 16 backend tests, provider calls mocked
node --check web/assets/app.js
```

Browser checks (Playwright, Chromium, 1440 px and 390 px) covered ranking, profile switch, exclusion, comparison, details, research gating, chat gating, slider, candidate scope and the brief download. See IMPLEMENTATION_STATUS.md for what was verified.

## Docker

```bash
docker build -t gauge .
docker run --rm -p 127.0.0.1:8000:8000 --env-file .env gauge
```

The image bundles the organizer CSV, runs as a non-root user, exposes port 8000 and has a `/healthz` health check. `.env` is excluded by `.dockerignore`.

## Deploy on Nebius

Live demo (hackathon project, open, no login): https://port8000-h1b0vwacrc38sp4.tunnel.applications.uk-south2.nebius.cloud

See [docs/deployment.md](docs/deployment.md) and `deploy/nebius-deploy.sh`. Target: one CPU-only Serverless Endpoint in the assigned hackathon project (`uk-south2`), image in the project registry, secrets from MysteryBox, platform bearer auth **off** so the jury's browser reaches the app's own login.

## Two-minute demo script

1. Open the URL, sign in as `jury`. Point at the header: 10,000 suppliers loaded, Nemotron and Tavily connected.
2. Type the component ("Train brake system"), keep *Quality first*, press **Build shortlist**. Read the funnel and the one-line capability caveat.
3. Add #1 and #2 to Compare, open the comparison: 18 original scores plus delivery facts side by side. Press **Explain this tradeoff with Nemotron**.
4. Switch to *Financial resilience*: the table and recommendation recalculate instantly.
5. Press **What if this supplier is unavailable?** The leader drops out, the full pool is re-ranked, the excluded chip appears.
6. Ask Gauge "Why does #1 rank above #2?" and show the tool trace (rank → inspect) under the answer.
7. Open Company research, show the completed Knorr-Bremse report with its steps, follow-up decision and clickable sources (run it before the recording, it takes about a minute).
8. Press **Export sourcing brief**.

## Accounts

- **Nebius AI Cloud**: accept the invitation, use the assigned `groupNN-project` in `uk-south2`. No personal tenant or billing.
- **Nebius Token Factory**: separate account; redeem the code, create an API key. Model `nvidia/Nemotron-3.5-Super-VL` (verified in the public catalog on 18 Oct 2026: function calling, $0.30 / $0.90 per million input / output tokens).
- **Tavily**: separate account and API key.

Official guide: https://github.com/dariolaportanebius/nebius-starter-skill/blob/hackathon-participant-guide/README.md
