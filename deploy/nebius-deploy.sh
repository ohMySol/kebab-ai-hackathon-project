#!/usr/bin/env bash
# Gauge deployment helper for the Nebius hackathon project (CPU-only Serverless Endpoint).
# Usage: deploy/nebius-deploy.sh <step> [args]
#   preflight            CLI, profile, project, region, quotas, CPU platforms (read-only)
#   registry             create or reuse the project container registry; configure docker auth
#   build                build linux/amd64 image and push it to the registry
#   secrets              create/update the MysteryBox secret from .env (run this yourself; it reads secret values)
#   dry-run              validate the endpoint create command without creating anything
#   create               create the endpoint (one gated write; asks for confirmation)
#   status               endpoint state and URL (no token fields printed)
#   smoke                probe /healthz and the login on the public URL
#   logs                 recent endpoint logs
#   stop | start         pause / resume the endpoint
#   delete-command       print the delete command (never run automatically)
# Environment: NEBIUS_PROJECT_ID (required), NEBIUS_PROFILE (default: hackathon), GAUGE_NAME (default: gauge),
#              GAUGE_TAG (default: git short sha or 'dev'), GAUGE_PLATFORM / GAUGE_PRESET (CPU preset, see preflight).
set -euo pipefail
export AI_AGENT="${AI_AGENT:-claude-code}"
export PATH="$HOME/.nebius/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${NEBIUS_PROFILE:-hackathon}"
PROJECT="${NEBIUS_PROJECT_ID:-}"
NAME="${GAUGE_NAME:-gauge}"
REGION="${NEBIUS_REGION:-uk-south2}"
REGISTRY_HOST="cr.${REGION}.nebius.cloud"
TAG="${GAUGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)}"
PLATFORM="${GAUGE_PLATFORM:-cpu-d3}"
PRESET="${GAUGE_PRESET:-2vcpu-8gb}"
SECRET_NAME="${GAUGE_SECRET:-gauge-secrets}"
STATE_FILE="$ROOT/deploy/.state"          # non-secret ids written by the steps below (gitignored)
N() { nebius --profile "$PROFILE" "$@"; }
need_project() { [[ -n "$PROJECT" ]] || { echo "Set NEBIUS_PROJECT_ID to your assigned project-... id"; exit 2; }; }
save() { mkdir -p "$(dirname "$STATE_FILE")"; touch "$STATE_FILE"; grep -v "^$1=" "$STATE_FILE" > "$STATE_FILE.tmp" || true; echo "$1=$2" >> "$STATE_FILE.tmp"; mv "$STATE_FILE.tmp" "$STATE_FILE"; }
load() { [[ -f "$STATE_FILE" ]] && grep "^$1=" "$STATE_FILE" | tail -1 | cut -d= -f2- || true; }
registry_path() { local id; id="$(load REGISTRY_ID)"; [[ -n "$id" ]] || { echo "Run the registry step first" >&2; exit 2; }; echo "${REGISTRY_HOST}/${id#registry-}"; }
image_ref() { echo "$(registry_path)/${NAME}:${TAG}"; }

case "${1:-}" in
  preflight)
    need_project
    nebius version
    N profile list
    N iam v2 project get --id "$PROJECT" --format json | jq '{id: .metadata.id, name: .metadata.name, region: .status.region}'
    echo "--- CPU platforms and presets available in this project ---"
    N compute platform list --parent-id "$PROJECT" --format json \
      | jq -r '.items[]? | select(.metadata.name | startswith("cpu")) | .metadata.name as $p | .spec.presets[]? | "\($p)\t\(.name)\t\(.resources.vcpu_count) vCPU\t\(.resources.memory_gibibytes) GiB"' | column -t
    echo "--- quota allowances (CPU / VM / disk related) ---"
    N quotas quota-allowance list --parent-id "$PROJECT" --all --format json \
      | jq -r '.items[]? | select(.metadata.name | test("cpu|vm|disk|ssd|registry|public"; "i")) | "\(.metadata.name)\tlimit=\(.spec.limit // .status.limit // "?")\tusage=\(.status.usage // "?")"' | column -t || true
    echo "--- existing endpoints ---"
    N ai endpoint list --parent-id "$PROJECT" --format json | jq '.items[]? | {id: .metadata.id, name: .metadata.name, state: .status.state, urls: .status.public_endpoints}'
    echo "--- cost estimate for ${PLATFORM}/${PRESET} ---"
    N billing v1alpha1 calculator estimate --resource-spec-compute-instance-spec-parent-id "$PROJECT" \
      --resource-spec-compute-instance-spec-resources-platform "$PLATFORM" --resource-spec-compute-instance-spec-resources-preset "$PRESET" --format json \
      | jq '{hourly: .hourly_cost.general.total.cost, monthly: .monthly_cost.general.total.cost}' || echo "(calculator unavailable; see https://nebius.com/prices)"
    ;;
  registry)
    need_project
    existing="$(N registry list --parent-id "$PROJECT" --format json | jq -r '.items[]? | .metadata.id' | head -1)"
    if [[ -n "$existing" ]]; then echo "Reusing registry $existing"; else
      echo "Creating registry ${NAME}-registry in $PROJECT (team limit: one registry)"
      existing="$(N registry create --parent-id "$PROJECT" --name "${NAME}-registry" --format json | jq -r '.resource_id // .metadata.id')"
    fi
    save REGISTRY_ID "$existing"
    N registry configure-helper
    echo "Image path: $(registry_path)/${NAME}:<tag>"
    ;;
  build)
    need_project
    ref="$(image_ref)"
    echo "Building and pushing $ref (linux/amd64)"
    docker buildx build --platform linux/amd64 -t "$ref" --push "$ROOT"
    save IMAGE "$ref"
    ;;
  secrets)
    need_project
    [[ -f "$ROOT/.env" ]] || { echo "No .env found"; exit 2; }
    set -a; source "$ROOT/.env"; set +a
    for v in NEBIUS_API_KEY TAVILY_API_KEY APP_PASSWORD; do
      val="${!v:-}"; [[ -n "$val" && "$val" != __* ]] || { echo "$v is still a placeholder in .env"; exit 2; }
    done
    payload="$(jq -n --arg a "$NEBIUS_API_KEY" --arg b "$TAVILY_API_KEY" --arg c "$APP_PASSWORD" \
      '[{key:"NEBIUS_API_KEY",string_value:$a},{key:"TAVILY_API_KEY",string_value:$b},{key:"APP_PASSWORD",string_value:$c}]')"
    sid="$(N mysterybox secret list --parent-id "$PROJECT" --format json | jq -r --arg n "$SECRET_NAME" '.items[]? | select(.metadata.name==$n) | .metadata.id' | head -1)"
    if [[ -n "$sid" ]]; then
      echo "Updating secret $SECRET_NAME ($sid) with a new version"
      N mysterybox secret-version create --secret-id "$sid" --payload "$payload" --set-primary --format json | jq '{id: .resource_id}'
    else
      echo "Creating secret $SECRET_NAME"
      N mysterybox secret create --parent-id "$PROJECT" --name "$SECRET_NAME" --description "Gauge app secrets" --secret-version-payload "$payload" >/dev/null
    fi
    echo "Secret ready. Values were not printed."
    ;;
  dry-run|create)
    need_project
    ref="$(load IMAGE)"; [[ -n "$ref" ]] || ref="$(image_ref)"
    subnet="$(N vpc subnet list --parent-id "$PROJECT" --format json | jq -r '.items[0].metadata.id')"
    cmd=(nebius --profile "$PROFILE" ai endpoint create --parent-id "$PROJECT" --name "$NAME"
         --image "$ref" --platform "$PLATFORM" --preset "$PRESET" --disk-size 32Gi
         --container-port 8000/http --auth none
         --env NEBIUS_MODEL="${NEBIUS_MODEL:-nvidia/Nemotron-3.5-Super-VL}" --env APP_USERNAME="${APP_USERNAME:-jury}"
         --env SUPPLIER_CSV=/app/data/supplier_risk_dataset.csv --env REPORTS_DIR=/app/data/reports --env PORT=8000
         --env-secret NEBIUS_API_KEY="$SECRET_NAME" --env-secret TAVILY_API_KEY="$SECRET_NAME" --env-secret APP_PASSWORD="$SECRET_NAME"
         --subnet-id "$subnet")
    echo "Command:"; printf '  %q' "${cmd[@]}"; echo
    if [[ "$1" == "dry-run" ]]; then "${cmd[@]}" --dry-run && echo "Dry-run OK"; exit 0; fi
    existing="$(N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json 2>/dev/null | jq -r '.metadata.id // empty')"
    [[ -z "$existing" ]] || { echo "Endpoint $NAME already exists ($existing). Use status/stop/start or delete-command."; exit 2; }
    read -r -p "Create this endpoint now? It bills hourly until deleted. [yes/no] " ok
    [[ "$ok" == "yes" ]] || { echo "Cancelled"; exit 1; }
    "${cmd[@]}" --async > deploy/.create.out 2>&1 || { cat deploy/.create.out; exit 1; }
    cat deploy/.create.out
    echo "Created. Poll with: deploy/nebius-deploy.sh status"
    ;;
  status)
    need_project
    N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json | jq '{id: .metadata.id, state: .status.state, urls: .status.public_endpoints, platform: .spec.resources.platform, preset: .spec.resources.preset}'
    ;;
  smoke)
    need_project
    url="$(N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json | jq -r '.status.public_endpoints[0]')"
    echo "URL: $url"
    curl -sS -m 20 -o /dev/null -w "healthz: %{http_code}\n" "$url/healthz"
    curl -sS -m 20 -o /dev/null -w "login challenge (expect 401): %{http_code}\n" "$url/"
    ;;
  logs)
    need_project
    id="$(N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json | jq -r '.metadata.id')"
    N ai endpoint logs --id "$id" 2>&1 | tail -80
    ;;
  stop|start)
    need_project
    id="$(N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json | jq -r '.metadata.id')"
    N ai endpoint "$1" --id "$id" --format json | jq '{id: .resource_id}'
    ;;
  delete-command)
    need_project
    id="$(N ai endpoint get-by-name --name "$NAME" --parent-id "$PROJECT" --format json | jq -r '.metadata.id')"
    echo "nebius --profile $PROFILE ai endpoint delete --id $id   # removes the managed URL and stops billing"
    ;;
  *) sed -n '2,20p' "$0"; exit 1;;
esac
