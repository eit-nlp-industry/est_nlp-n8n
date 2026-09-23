#!/usr/bin/env bash
# Build custom n8n/runners images and roll them onto the local selfhost compose.
#
# Default layout (same machine):
#   REPO_DIR   = this monorepo
#   DEPLOY_DIR = /srv/apps/n8n
#
# Usage:
#   ./scripts/deploy-local-selfhost.sh
#   ./scripts/deploy-local-selfhost.sh --dockerize-only
#   ./scripts/deploy-local-selfhost.sh --no-save
#   ./scripts/deploy-local-selfhost.sh --no-up
#   VER=custom-20260909 ./scripts/deploy-local-selfhost.sh
#
# Flags:
#   --dockerize-only  Skip pnpm compile; only run dockerize-n8n.mjs
#   --no-save         Do not write images/*.tar.gz under DEPLOY_DIR
#   --no-up           Tag (and optional save) only; do not recreate containers
#   -h, --help        Show this help
#
# Env:
#   REPO_DIR    Source repo (default: parent of scripts/)
#   DEPLOY_DIR  Compose directory (default: /srv/apps/n8n)
#   VER         Image tag suffix (default: custom-YYYYMMDD)
#   N8N_LOCAL_IMAGE / RUNNERS_LOCAL_IMAGE
#               Source tags after build (default: n8nio/n8n:local, n8nio/runners:local)

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_DIR="${DEPLOY_DIR:-/srv/apps/n8n}"
VER="${VER:-custom-$(date +%Y%m%d)}"
N8N_LOCAL_IMAGE="${N8N_LOCAL_IMAGE:-n8nio/n8n:local}"
RUNNERS_LOCAL_IMAGE="${RUNNERS_LOCAL_IMAGE:-n8nio/runners:local}"

N8N_CUSTOM_IMAGE="n8n-custom:${VER}"
RUNNERS_CUSTOM_IMAGE="n8n-runners-custom:${VER}"

DOCKERIZE_ONLY=0
DO_SAVE=1
DO_UP=1

usage() {
	sed -n '2,30p' "$0" | sed 's/^# \?//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dockerize-only) DOCKERIZE_ONLY=1 ;;
		--no-save) DO_SAVE=0 ;;
		--no-up) DO_UP=0 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "Unknown flag: $1" >&2
			usage >&2
			exit 1
			;;
	esac
	shift
done

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die 'docker not found'
command -v pnpm >/dev/null || die 'pnpm not found'
[[ -d "$REPO_DIR" ]] || die "REPO_DIR not found: $REPO_DIR"
[[ -f "$DEPLOY_DIR/docker-compose.yml" ]] || die "compose missing: $DEPLOY_DIR/docker-compose.yml"
[[ -f "$DEPLOY_DIR/.env" ]] || die ".env missing: $DEPLOY_DIR/.env"

# Upsert KEY=VALUE in an env file without printing the file.
upsert_env() {
	local file="$1" key="$2" value="$3"
	if grep -q "^${key}=" "$file"; then
		# Use | so values with / are safe.
		sed -i "s|^${key}=.*|${key}=${value}|" "$file"
	else
		printf '\n%s=%s\n' "$key" "$value" >>"$file"
	fi
}

log "repo=$REPO_DIR"
log "deploy=$DEPLOY_DIR"
log "ver=$VER"
log "images: $N8N_CUSTOM_IMAGE , $RUNNERS_CUSTOM_IMAGE"

cd "$REPO_DIR"

if [[ "$DOCKERIZE_ONLY" -eq 1 ]]; then
	log 'dockerize only (skip compile)'
	node scripts/dockerize-n8n.mjs
else
	log 'pnpm build:docker (compile + dockerize)'
	pnpm build:docker
fi

docker image inspect "$N8N_LOCAL_IMAGE" >/dev/null 2>&1 \
	|| die "missing local image: $N8N_LOCAL_IMAGE"
docker image inspect "$RUNNERS_LOCAL_IMAGE" >/dev/null 2>&1 \
	|| die "missing local image: $RUNNERS_LOCAL_IMAGE"

log "tag -> $N8N_CUSTOM_IMAGE"
docker tag "$N8N_LOCAL_IMAGE" "$N8N_CUSTOM_IMAGE"
log "tag -> $RUNNERS_CUSTOM_IMAGE"
docker tag "$RUNNERS_LOCAL_IMAGE" "$RUNNERS_CUSTOM_IMAGE"

if [[ "$DO_SAVE" -eq 1 ]]; then
	mkdir -p "$DEPLOY_DIR/images"
	ARCHIVE="$DEPLOY_DIR/images/n8n-custom-${VER}.tar.gz"
	log "save -> $ARCHIVE"
	docker save "$N8N_CUSTOM_IMAGE" "$RUNNERS_CUSTOM_IMAGE" | gzip >"$ARCHIVE"
	log "archive bytes: $(wc -c <"$ARCHIVE")"
fi

log 'update compose image pins in .env'
upsert_env "$DEPLOY_DIR/.env" N8N_CUSTOM_IMAGE "$N8N_CUSTOM_IMAGE"
upsert_env "$DEPLOY_DIR/.env" N8N_RUNNERS_CUSTOM_IMAGE "$RUNNERS_CUSTOM_IMAGE"
chmod 600 "$DEPLOY_DIR/.env" 2>/dev/null || true

# Prefer env-driven image lines so each deploy only updates .env.
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
if ! grep -q '\${N8N_CUSTOM_IMAGE' "$COMPOSE_FILE"; then
	log 'migrate compose n8n image line to ${N8N_CUSTOM_IMAGE}'
	sed -i -E 's|^([[:space:]]*image:[[:space:]]*)n8n-custom:[^[:space:]]+|\1${N8N_CUSTOM_IMAGE:-n8n-custom:custom-20260908}|' \
		"$COMPOSE_FILE"
fi
if ! grep -q '\${N8N_RUNNERS_CUSTOM_IMAGE' "$COMPOSE_FILE"; then
	log 'migrate compose runner image line to ${N8N_RUNNERS_CUSTOM_IMAGE}'
	sed -i -E 's|^([[:space:]]*image:[[:space:]]*)n8n-runners-custom:[^[:space:]]+|\1${N8N_RUNNERS_CUSTOM_IMAGE:-n8n-runners-custom:custom-20260908}|' \
		"$COMPOSE_FILE"
fi

if [[ "$DO_UP" -eq 1 ]]; then
	log 'compose up (force-recreate n8n + n8n-runner)'
	docker compose -f "$COMPOSE_FILE" --env-file "$DEPLOY_DIR/.env" \
		up -d --force-recreate --no-deps n8n n8n-runner
	log 'waiting for n8n...'
	ready=0
	for _ in $(seq 1 60); do
		if docker compose -f "$COMPOSE_FILE" --env-file "$DEPLOY_DIR/.env" \
			exec -T n8n wget -qO- http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
			log 'n8n healthz OK'
			ready=1
			break
		fi
		sleep 2
	done
	if [[ "$ready" -ne 1 ]]; then
		log 'WARN: healthz not confirmed; check: docker compose -f '"$COMPOSE_FILE"' logs n8n --tail 50'
	fi
	docker compose -f "$COMPOSE_FILE" --env-file "$DEPLOY_DIR/.env" ps n8n n8n-runner
else
	log 'skipped compose up (--no-up)'
fi

log "done. UI: http://127.0.0.1:5678  (hard-refresh browser)"
log "active images: $N8N_CUSTOM_IMAGE / $RUNNERS_CUSTOM_IMAGE"
