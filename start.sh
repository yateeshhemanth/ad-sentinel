#!/usr/bin/env bash
# ── ADSentinel startup script ─────────────────────────────────────────
# Usage:
#   ./start.sh dev             Start dev stack  (port 8080)
#   ./start.sh prod            Start prod stack (port 80/443)
#   ./start.sh dev down        Stop and remove containers
#   ./start.sh dev reset       Full wipe: containers + volumes + rebuild
#   ./start.sh dev logs        Tail all logs
#   ./start.sh dev logs nginx  Tail specific service logs
#   ./start.sh dev build       Force rebuild images
#   ./start.sh dev ps          Show running containers

set -euo pipefail

ENV="${1:-dev}"
CMD="${2:-up}"
SVC="${3:-}"   # optional service name for logs

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "❌ Unknown environment: '$ENV'. Use 'dev' or 'prod'."
  exit 1
fi

ENV_FILE=".env.${ENV}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing: $ENV_FILE  — edit it before starting."
  exit 1
fi

COMPOSE="podman-compose -f docker-compose.base.yml -f docker-compose.${ENV}.yml"
# Fall back to docker compose if podman-compose not found
if ! command -v podman-compose &>/dev/null; then
  COMPOSE="docker compose -f docker-compose.base.yml -f docker-compose.${ENV}.yml"
fi

# Banner
echo ""
if [[ "$ENV" == "dev" ]]; then
  echo "╔═══════════════════════════════════════╗"
  echo "║  ADSentinel · DEV  · http://localhost:8080  ║"
  echo "╚═══════════════════════════════════════╝"
else
  echo "╔═══════════════════════════════════════╗"
  echo "║  ADSentinel · PROD · http://localhost  ║"
  echo "╚═══════════════════════════════════════╝"
fi
echo ""

case "$CMD" in

  up)
    if [[ "$ENV" == "prod" ]]; then
     $COMPOSE --env-file "$ENV_FILE" up -d --build
    else
     $COMPOSE --env-file "$ENV_FILE" up --build
    fi
    ;;
  down)
    echo "⏹  Stopping $ENV stack..."
    $COMPOSE --env-file "$ENV_FILE" down
    echo "✅ Done."
    ;;

  reset)
    echo "🗑  Full reset — removing containers and volumes..."
    $COMPOSE --env-file "$ENV_FILE" down -v 2>/dev/null || true
    # Also remove named volumes
    for vol in adsentinel_postgres adsentinel_redis adsentinel_reports adsentinel_logos; do
      podman volume rm "$vol" 2>/dev/null && echo "  Removed volume: $vol" || true
    done
    echo ""
    echo "🔨 Rebuilding images from scratch..."
    $COMPOSE --env-file "$ENV_FILE" build --no-cache
    echo ""
    echo "▶  Starting fresh..."
    if [[ "$ENV" == "prod" ]]; then
      $COMPOSE --env-file "$ENV_FILE" up -d
    else
      $COMPOSE --env-file "$ENV_FILE" up
    fi
    ;;

  build)
    echo "🔨 Rebuilding $ENV images..."
    $COMPOSE --env-file "$ENV_FILE" build --no-cache
    echo "✅ Build complete. Run './start.sh $ENV' to start."
    ;;

  logs)
    $COMPOSE --env-file "$ENV_FILE" logs -f $SVC
    ;;

  restart)
    $COMPOSE --env-file "$ENV_FILE" down
    if [[ "$ENV" == "prod" ]]; then
      $COMPOSE --env-file "$ENV_FILE" up -d --build
    else
      $COMPOSE --env-file "$ENV_FILE" up --build
    fi
    ;;

  ps)
    $COMPOSE --env-file "$ENV_FILE" ps
    ;;

  *)
    echo "❌ Unknown command: '$CMD'"
    echo "   Valid commands: up | down | reset | build | logs | restart | ps"
    exit 1
    ;;

esac
