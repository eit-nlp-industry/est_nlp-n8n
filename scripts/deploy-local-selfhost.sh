#!/usr/bin/env bash
# Build n8n from this checkout and deploy it to a local Compose stack.
#
# Usage:
#   ./scripts/deploy-local-selfhost.sh
#   ./scripts/deploy-local-selfhost.sh --no-build
#   ./scripts/deploy-local-selfhost.sh --no-up
#   ./scripts/deploy-local-selfhost.sh --save
#
# Environment:
#   REPO_DIR   Source repository. The default is the parent of this script.
#   DEPLOY_DIR Compose directory. The default is /srv/apps/n8n.
#   VER        Image tag suffix. The default includes the current date and time.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_DIR="${DEPLOY_DIR:-/srv/apps/n8n}"
VER="${VER:-custom-$(date +%Y%m%d-%H%M%S)}"
IMAGE_BASE_NAME="${IMAGE_BASE_NAME:-n8n-custom}"
IMAGE="${IMAGE_BASE_NAME}:${VER}"
BUILD_LOG="${BUILD_LOG:-$REPO_DIR/build.log}"
DOCKER_BUILD_LOG="${DOCKER_BUILD_LOG:-$REPO_DIR/.tmp/docker-build.log}"

DO_BUILD=1
DO_UP=1
DO_SAVE=0
DEPLOY_STARTED=0
PREVIOUS_IMAGE=''

usage() {
	sed -n '2,14p' "$0" | sed 's/^# \?//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--no-build) DO_BUILD=0 ;;
		--no-up) DO_UP=0 ;;
		--save) DO_SAVE=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			printf '[deploy] ERROR: Unknown option: %s\n' "$1" >&2
			usage >&2
			exit 1
			;;
	esac
	shift
done

log() {
	printf '[deploy] %s\n' "$*"
}

die() {
	printf '[deploy] ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"
}

compose() {
	docker compose -f "$DEPLOY_DIR/docker-compose.yml" --env-file "$DEPLOY_DIR/.env" "$@"
}

read_env() {
	local key="$1"
	awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$DEPLOY_DIR/.env"
}

upsert_env() {
	local key="$1"
	local value="$2"
	local temporary
	temporary="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
	awk -F= -v key="$key" -v value="$value" '
		BEGIN { found = 0 }
		$1 == key { print key "=" value; found = 1; next }
		{ print }
		END { if (!found) print key "=" value }
	' "$DEPLOY_DIR/.env" >"$temporary"
	chmod 600 "$temporary"
	mv "$temporary" "$DEPLOY_DIR/.env"
}

wait_for_health() {
	local attempt
	for attempt in $(seq 1 60); do
		if compose exec -T n8n wget -qO- http://127.0.0.1:5678/healthz 2>/dev/null |
			grep -q 'ok'; then
			return 0
		fi
		sleep 2
	done
	return 1
}

rollback() {
	local exit_code=$?
	if [[ "$DEPLOY_STARTED" -eq 1 && -n "$PREVIOUS_IMAGE" ]]; then
		log "Deployment failed. Restore $PREVIOUS_IMAGE."
		upsert_env N8N_CUSTOM_IMAGE "$PREVIOUS_IMAGE"
		compose up -d --force-recreate --no-deps n8n >/dev/null || true
	fi
	exit "$exit_code"
}

trap rollback ERR

require_command docker
require_command pnpm
require_command flock
[[ -d "$REPO_DIR" ]] || die "Repository not found: $REPO_DIR"
[[ -f "$REPO_DIR/docker/docker-bake.hcl" ]] || die 'Docker Bake file not found'
[[ -f "$DEPLOY_DIR/docker-compose.yml" ]] || die 'Compose file not found'
[[ -f "$DEPLOY_DIR/.env" ]] || die 'Compose environment file not found'

exec 9>"$DEPLOY_DIR/.deploy.lock"
flock -n 9 || die 'Another deployment is running'

cd "$REPO_DIR"
log "Image: $IMAGE"

# Private @eit/json-render-* packages resolve to https:// in the lockfile.
# Rewrite to SSH for this process so `pnpm deploy` can fetch without a token.
export GIT_CONFIG_COUNT="${GIT_CONFIG_COUNT:-1}"
export GIT_CONFIG_KEY_0="${GIT_CONFIG_KEY_0:-url.ssh://git@github.com/.insteadOf}"
export GIT_CONFIG_VALUE_0="${GIT_CONFIG_VALUE_0:-https://github.com/}"

if [[ "$DO_BUILD" -eq 1 ]]; then
	mkdir -p "$(dirname "$BUILD_LOG")" "$(dirname "$DOCKER_BUILD_LOG")"
	log "Build the production files. See $BUILD_LOG."
	pnpm build:n8n >"$BUILD_LOG" 2>&1

	log "Build the Docker image. See $DOCKER_BUILD_LOG."
	build_driver="$(docker buildx inspect | awk '/^Driver:/ { print $2; exit }')"
	bake_flags=()
	if [[ "$build_driver" != 'docker' ]]; then
		bake_flags+=(--load --provenance=false)
	fi
	IMAGE_BASE_NAME="$IMAGE_BASE_NAME" IMAGE_TAG="$VER" \
		docker buildx bake -f docker/docker-bake.hcl n8n "${bake_flags[@]}" \
		>"$DOCKER_BUILD_LOG" 2>&1
fi

docker image inspect "$IMAGE" >/dev/null 2>&1 || die "Image not found: $IMAGE"

if [[ "$DO_SAVE" -eq 1 ]]; then
	mkdir -p "$DEPLOY_DIR/images"
	archive="$DEPLOY_DIR/images/${IMAGE_BASE_NAME}-${VER}.tar.gz"
	log "Save $archive."
	docker save "$IMAGE" | gzip >"$archive"
fi

if [[ "$DO_UP" -eq 0 ]]; then
	log 'Skip deployment.'
	exit 0
fi

compose config -q
PREVIOUS_IMAGE="$(read_env N8N_CUSTOM_IMAGE)"
[[ -n "$PREVIOUS_IMAGE" ]] || die 'N8N_CUSTOM_IMAGE is not set'

log "Deploy $IMAGE."
DEPLOY_STARTED=1
upsert_env N8N_CUSTOM_IMAGE "$IMAGE"
compose up -d --force-recreate --no-deps n8n

if ! wait_for_health; then
	compose logs --tail 80 n8n >&2
	false
fi

DEPLOY_STARTED=0
trap - ERR
compose ps n8n
log 'Deployment completed. The health check passed.'
