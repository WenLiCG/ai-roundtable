#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/WenLiCG/ai-roundtable.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/ai-roundtable}"
APP_PORT="${APP_PORT:-3000}"
APP_BIND_ADDRESS="${APP_BIND_ADDRESS:-0.0.0.0}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_BIND_ADDRESS="${POSTGRES_BIND_ADDRESS:-127.0.0.1}"
NEXT_PUBLIC_APP_NAME="${NEXT_PUBLIC_APP_NAME:-AI Roundtable}"
INSTALL_DOCKER="${INSTALL_DOCKER:-auto}"
TAKE_OVER_PORT="${TAKE_OVER_PORT:-0}"
RESET_DATA="${RESET_DATA:-0}"
ACTION="${1:-install}"

log() {
  printf '\n\033[1;32m==> %s\033[0m\n' "$*"
}

warn() {
  printf '\n\033[1;33mWARN: %s\033[0m\n' "$*" >&2
}

fail() {
  printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    fail "This installer needs root permissions. Run it as root or install sudo."
  fi
}

install_package_if_missing() {
  local package="$1"
  local command_name="${2:-$1}"

  if command_exists "$command_name"; then
    return
  fi

  if command_exists apt-get; then
    run_as_root apt-get update
    run_as_root apt-get install -y "$package"
  elif command_exists dnf; then
    run_as_root dnf install -y "$package"
  elif command_exists yum; then
    run_as_root yum install -y "$package"
  else
    fail "Cannot install missing package '$package'. Please install it manually."
  fi
}

ensure_docker() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    return
  fi

  if [ "$INSTALL_DOCKER" = "0" ] || [ "$INSTALL_DOCKER" = "false" ]; then
    fail "Docker with Compose plugin is required."
  fi

  log "Installing Docker Engine"
  install_package_if_missing curl curl
  curl -fsSL https://get.docker.com | run_as_root sh

  if ! command_exists docker || ! docker compose version >/dev/null 2>&1; then
    fail "Docker installation finished, but Docker Compose plugin is still unavailable."
  fi
}

ensure_docker_access() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  if [ "$(id -u)" -eq 0 ]; then
    fail "Docker daemon is not responding. Check: systemctl status docker"
  fi

  fail "Current user cannot access Docker. Try: sudo usermod -aG docker \$USER, then re-login."
}

random_hex() {
  openssl rand -hex "$1"
}

write_env_if_missing() {
  if [ -f "$APP_DIR/.env" ]; then
    warn "Existing $APP_DIR/.env preserved."
    return
  fi

  log "Creating production .env"
  local db_password
  local app_key
  db_password="$(random_hex 24)"
  app_key="$(random_hex 32)"

  cat >"$APP_DIR/.env" <<EOF
POSTGRES_PASSWORD=$db_password
APP_ENCRYPTION_KEY=$app_key
APP_PORT=$APP_PORT
APP_BIND_ADDRESS=$APP_BIND_ADDRESS
POSTGRES_PORT=$POSTGRES_PORT
POSTGRES_BIND_ADDRESS=$POSTGRES_BIND_ADDRESS
NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
EOF
  chmod 600 "$APP_DIR/.env"
}

compose_down() {
  if [ -f "$APP_DIR/docker-compose.yml" ]; then
    cd "$APP_DIR"
    if [ "$RESET_DATA" = "1" ] || [ "$RESET_DATA" = "true" ]; then
      warn "RESET_DATA enabled. Docker volumes will be removed."
      docker compose down -v --remove-orphans || true
    else
      docker compose down --remove-orphans || true
    fi
  fi
}

delete_installation() {
  log "Deleting AI Roundtable installation"

  if [ -f "$APP_DIR/docker-compose.yml" ]; then
    cd "$APP_DIR"
    if [ "$RESET_DATA" = "1" ] || [ "$RESET_DATA" = "true" ] || [ "${DELETE_DATA:-0}" = "1" ] || [ "${DELETE_DATA:-0}" = "true" ]; then
      warn "Data deletion enabled. Docker volumes will be removed."
      docker compose down -v --remove-orphans || true
    else
      docker compose down --remove-orphans || true
      warn "PostgreSQL Docker volume data was preserved. Reinstalling later can reuse it."
      warn "Run DELETE_DATA=1 $0 delete to remove database volume data too."
    fi
  else
    warn "No docker-compose.yml found in $APP_DIR. Skipping container shutdown."
  fi

  if [ -d "$APP_DIR" ]; then
    log "Removing $APP_DIR"
    run_as_root rm -rf "$APP_DIR"
  fi

  log "AI Roundtable has been removed."
}

stop_port_owner_if_requested() {
  if [ "$TAKE_OVER_PORT" != "1" ] && [ "$TAKE_OVER_PORT" != "true" ]; then
    return
  fi

  local container_ids
  container_ids="$(docker ps -q --filter "publish=$APP_PORT" || true)"

  if [ -n "$container_ids" ]; then
    warn "Stopping Docker containers that publish port $APP_PORT because TAKE_OVER_PORT is enabled."
    docker rm -f $container_ids
  fi
}

check_port_available() {
  if ! command_exists ss; then
    return
  fi

  if ss -ltn "( sport = :$APP_PORT )" | grep -q ":$APP_PORT"; then
    fail "Port $APP_PORT is still occupied. Set APP_PORT=8088 to use another port, or TAKE_OVER_PORT=1 to stop Docker containers using it."
  fi
}

clone_or_update_repo() {
  install_package_if_missing git git
  install_package_if_missing openssl openssl

  if [ -d "$APP_DIR/.git" ]; then
    log "Updating repository in $APP_DIR"
    cd "$APP_DIR"
    git fetch --all --prune
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    log "Cloning repository to $APP_DIR"
    run_as_root mkdir -p "$(dirname "$APP_DIR")"
    if [ "$(id -u)" -eq 0 ]; then
      rm -rf "$APP_DIR"
      git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    else
      run_as_root rm -rf "$APP_DIR"
      run_as_root git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
      run_as_root chown -R "$(id -u):$(id -g)" "$APP_DIR"
    fi
    cd "$APP_DIR"
  fi
}

wait_for_app() {
  local url="http://127.0.0.1:$APP_PORT"

  log "Waiting for app at $url"
  for _ in $(seq 1 80); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return
    fi
    sleep 3
  done

  docker compose ps || true
  docker compose logs --tail=160 app || true
  fail "The app did not respond in time."
}

print_summary() {
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"

  log "AI Roundtable is ready"
  printf 'Local URL:  http://127.0.0.1:%s\n' "$APP_PORT"
  if [ -n "$server_ip" ]; then
    printf 'Server URL: http://%s:%s\n' "$server_ip" "$APP_PORT"
  fi
  printf 'Default password: admin\n'
  printf '\nUseful commands:\n'
  printf '  cd %s && docker compose ps\n' "$APP_DIR"
  printf '  cd %s && docker compose logs -f app\n' "$APP_DIR"
  printf '  cd %s && docker compose up -d --build\n' "$APP_DIR"
}

install_or_update() {
  log "AI Roundtable installer"
  install_package_if_missing curl curl
  ensure_docker
  ensure_docker_access
  clone_or_update_repo
  write_env_if_missing
  compose_down
  stop_port_owner_if_requested
  check_port_available

  log "Building and starting containers"
  cd "$APP_DIR"
  docker compose up -d --build
  wait_for_app
  docker compose ps
  print_summary
}

show_usage() {
  cat <<EOF
Usage:
  $0 install   Install or reinstall AI Roundtable. This is the default.
  $0 update    Pull the latest code and rebuild containers.
  $0 delete    Stop containers and remove $APP_DIR.

Environment options:
  APP_DIR=/opt/ai-roundtable
  APP_PORT=3000
  TAKE_OVER_PORT=1
  RESET_DATA=1
  DELETE_DATA=1
EOF
}

main() {
  case "$ACTION" in
    install)
      install_or_update
      ;;
    update)
      install_or_update
      ;;
    delete | uninstall | remove)
      install_package_if_missing curl curl
      ensure_docker
      ensure_docker_access
      delete_installation
      ;;
    help | --help | -h)
      show_usage
      ;;
    *)
      show_usage
      fail "Unknown command: $ACTION"
      ;;
  esac
}

main "$@"
