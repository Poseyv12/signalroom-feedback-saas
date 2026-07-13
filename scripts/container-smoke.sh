#!/usr/bin/env bash
set -euo pipefail

image="signalroom-feedback-saas:smoke"
container="signalroom-smoke-${GITHUB_RUN_ID:-$$}"
volume="${container}-data"
port="4175"
cookie_jar="$(mktemp)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$cookie_jar"
}
trap cleanup EXIT

docker build --tag "$image" .
docker volume create "$volume" >/dev/null
docker run --detach \
  --name "$container" \
  --publish "$port:4174" \
  --env "APP_ORIGIN=http://127.0.0.1:$port" \
  --volume "$volume:/data" \
  "$image" >/dev/null

for _ in $(seq 1 40); do
  if curl --fail --silent "http://127.0.0.1:$port/api/health" >/dev/null; then break; fi
  sleep 0.5
done
curl --fail --silent "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'

test "$(docker inspect --format '{{.Config.User}}' "$container")" = "signalroom"

curl --fail --silent --cookie-jar "$cookie_jar" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{"email":"container@example.com","name":"Container User","password":"correct horse battery staple"}' \
  "http://127.0.0.1:$port/api/auth/register" >/dev/null

curl --fail --silent --cookie "$cookie_jar" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{"name":"Container Labs"}' \
  "http://127.0.0.1:$port/api/organizations" >/dev/null

docker restart "$container" >/dev/null
for _ in $(seq 1 40); do
  if curl --fail --silent "http://127.0.0.1:$port/api/health" >/dev/null; then break; fi
  sleep 0.5
done
curl --fail --silent --cookie "$cookie_jar" "http://127.0.0.1:$port/api/me" | grep -q 'container@example.com'

printf 'Container build, non-root runtime, health check, and restart persistence: passed\n'
