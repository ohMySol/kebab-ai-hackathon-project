# Deployment

**Current deployment (18 Oct 2026):** endpoint `gauge-open`, id `aiendpoint-e05xkp1c1mkrv20029`, project `group50-project` (`project-e05pcx4nln00sb3fae3bgx`), registry `registry-e05acvg6r401qqek32`, secret `gauge-secrets`, image `gauge:036fbd3`, env `APP_AUTH=off` (open demo, no login: anyone with the URL can spend the API credits). URL: https://port8000-h1b0vwacrc38sp4.tunnel.applications.uk-south2.nebius.cloud. It replaced the login-protected endpoint `gauge` (`aiendpoint-e05yarz65dfd332df3`, image `gauge:3bceda5`).

Target: one **CPU-only Nebius Serverless Endpoint** in the assigned hackathon project, region `uk-south2`. Nemotron is hosted by Token Factory, so no GPU is used. The helper `deploy/nebius-deploy.sh` wraps every step; each step prints what it will do and only `create` is a billable write.

## Prerequisites (human steps)

1. Nebius CLI installed (`~/.nebius/bin/nebius`, 0.12.291 at the time of writing) and a profile authenticated in the browser with the identity that accepted the invitation:
   ```bash
   export NEBIUS_PROJECT_ID='project-...'          # from the console, Project details
   nebius profile create hackathon --parent-id "$NEBIUS_PROJECT_ID"
   ```
2. Docker Desktop running (buildx is used for `linux/amd64`; arm64 images do not start on the endpoint VMs).
3. `.env` filled in locally (Token Factory key, Tavily key, jury password).

## Steps

```bash
export NEBIUS_PROJECT_ID='project-...'
deploy/nebius-deploy.sh preflight    # project, region, CPU platforms/presets, quotas, existing endpoints, hourly cost
deploy/nebius-deploy.sh registry     # reuse or create the single project registry, configure docker credential helper
deploy/nebius-deploy.sh build        # docker buildx --platform linux/amd64 --push  cr.uk-south2.nebius.cloud/<reg>/gauge:<git sha>
deploy/nebius-deploy.sh secrets      # YOU run this: creates MysteryBox secret `gauge-secrets` from .env (keys NEBIUS_API_KEY, TAVILY_API_KEY, APP_PASSWORD)
deploy/nebius-deploy.sh dry-run      # validates the endpoint create command, prints it with secret selectors only
deploy/nebius-deploy.sh create       # asks for an explicit "yes", creates the endpoint once
deploy/nebius-deploy.sh status       # state + https URL (token fields never printed)
deploy/nebius-deploy.sh smoke        # /healthz must be 200, / must answer 401 (the app's own login)
deploy/nebius-deploy.sh logs
```

Choose the preset after `preflight` lists what the project offers, for example `GAUGE_PLATFORM=cpu-d3 GAUGE_PRESET=2vcpu-8gb` (the default) or `4vcpu-16gb`; stay within the 20 vCPU and 3 VM team limits.

## Endpoint configuration

| Setting | Value |
|---|---|
| Image | `cr.uk-south2.nebius.cloud/<registry>/gauge:<tag>` (linux/amd64) |
| Platform / preset | CPU, 2 vCPU / 8 GB by default, max 4 vCPU / 16 GB |
| Disk | 32 GiB |
| Port | `8000/http` → managed `https://` URL |
| Platform auth | `--auth none`. The app enforces HTTP Basic login on every page and API route; a normal browser cannot add a platform bearer header, so platform token auth would lock the jury out. `/healthz` is the only public route. |
| Env | `NEBIUS_MODEL`, `APP_USERNAME=jury`, optionally `APP_AUTH=off` to remove the login (then anyone with the URL can spend the API credits), `SUPPLIER_CSV=/app/data/supplier_risk_dataset.csv`, `REPORTS_DIR=/app/data/reports`, `PORT=8000` |
| Secret env | `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `APP_PASSWORD` from MysteryBox secret `gauge-secrets` |
| Replicas | one container, one worker (dataset and research jobs are in process memory; reports also on the container disk) |

## After deployment

Verify on the public URL, in this order: `/healthz` 200, browser login prompt, dataset chip shows 10,000 suppliers, change the priority and see the ranking change, **Test connections** shows both providers connected, ask Gauge one question and watch the tool trace, run one company research and open a source link. Only then report success.

## Costs and cleanup

An endpoint bills from create to delete, including idle time. Published CPU prices start around $0.06/hour (2 vCPU / 8 GB) to $0.13/hour (4 vCPU / 16 GB); `preflight` prints the calculator figure for the chosen preset. Nemotron 3.5 Super VL costs $0.30 per million input tokens and $0.90 per million output tokens; a chat turn is a few thousand tokens, a research run roughly 20–40k tokens plus 6–8 Tavily credits.

- Pause: `deploy/nebius-deploy.sh stop`, resume with `start` (the container disk, including saved reports, is removed on stop).
- Remove: `deploy/nebius-deploy.sh delete-command` prints the delete command; run it yourself when the event is over.
- Changing the image means creating a new endpoint (there is no in-place update); build with a new tag, create under a new `GAUGE_NAME`, then delete the old one.

Sources: https://nebius.com/prices, https://tokenfactory.nebius.com/api/public/models_info, https://docs.tavily.com/documentation/api-credits, participant guide sections 5 and 11.
