#!/usr/bin/env bash
# Write a local .env from the team's MysteryBox secret `gauge-secrets` (Nebius project group50-project).
# Requires an authenticated Nebius CLI profile for the project (nebius profile create hackathon --parent-id <project-id>).
# Values are written straight to .env (mode 600) and never printed.
set -euo pipefail
export AI_AGENT="${AI_AGENT:-}" PATH="$HOME/.nebius/bin:$PATH"
PROFILE="${NEBIUS_PROFILE:-hackathon}"
PROJECT="${NEBIUS_PROJECT_ID:-project-e05pcx4nln00sb3fae3bgx}"
SECRET_NAME="${GAUGE_SECRET:-gauge-secrets}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sid="$(nebius --profile "$PROFILE" mysterybox secret list --parent-id "$PROJECT" --format json | jq -r --arg n "$SECRET_NAME" '.items[]? | select(.metadata.name==$n) | .metadata.id' | head -1)"
[[ -n "$sid" ]] || { echo "Secret $SECRET_NAME not found in $PROJECT (check profile and project access)"; exit 2; }
[[ -f "$ROOT/.env" ]] && cp "$ROOT/.env" "$ROOT/.env.bak" && echo "Existing .env backed up to .env.bak"
umask 077
nebius --profile "$PROFILE" mysterybox payload get --secret-id "$sid" --format json \
  | jq -r '.data[]? | select(.string_value != null) | "\(.key)=\(.string_value)"' > "$ROOT/.env.tmp"
grep -q '^NEBIUS_API_KEY=' "$ROOT/.env.tmp" || { rm -f "$ROOT/.env.tmp"; echo "Payload did not contain the expected keys"; exit 2; }
{ cat "$ROOT/.env.tmp"; printf 'APP_USERNAME=jury\nAPP_AUTH=on\nNEBIUS_MODEL=nvidia/Nemotron-3.5-Super-VL\nSUPPLIER_CSV=\n'; } > "$ROOT/.env"
rm -f "$ROOT/.env.tmp"
echo ".env written with $(grep -c . "$ROOT/.env") settings (values not shown). Start with: python run.py"
