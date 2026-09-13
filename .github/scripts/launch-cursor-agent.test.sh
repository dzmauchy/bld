#!/usr/bin/env bash
# Integration checks for the labeled-issue Cursor launcher.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/launch-cursor-agent.sh"
WORKFLOW="${ROOT}/.github/workflows/cursor.yml"
PASS=0
FAIL=0

assert_eq() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS ${name}"
    PASS=$((PASS + 1))
  else
    echo "FAIL ${name}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if grep -Fq -- "$needle" <<<"$haystack"; then
    echo "PASS ${name}"
    PASS=$((PASS + 1))
  else
    echo "FAIL ${name}"
    echo "  missing: ${needle}"
    echo "  in: ${haystack}"
    FAIL=$((FAIL + 1))
  fi
}

bash -n "$SCRIPT"
echo "PASS bash -n launch-cursor-agent.sh"
PASS=$((PASS + 1))

if command -v actionlint >/dev/null 2>&1; then
  actionlint "$WORKFLOW" "${ROOT}/.github/workflows/cursor-launcher-test.yml"
  echo "PASS actionlint"
  PASS=$((PASS + 1))
else
  echo "SKIP actionlint (not installed)"
fi

assert_contains "workflow triggers on issue labeled" "$(cat "$WORKFLOW")" "types: [labeled]"
assert_contains "workflow filters cursor label" "$(cat "$WORKFLOW")" "github.event.label.name == 'cursor'"
assert_contains "workflow launches via script" "$(cat "$WORKFLOW")" "bash .github/scripts/launch-cursor-agent.sh"
assert_contains "workflow can use a PAT for @cursor" "$(cat "$WORKFLOW")" "secrets.CURSOR_GH_TOKEN || github.token"

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

cat > "${STUB_DIR}/gh" <<'EOF'
#!/usr/bin/env bash
: > /tmp/cursor-test-gh-args.txt
prev=""
for arg in "$@"; do
  printf '%s\n' "$arg" >> /tmp/cursor-test-gh-args.txt
  if [ "$prev" = "--body-file" ] && [ -f "$arg" ]; then
    cat "$arg" >> /tmp/cursor-test-gh-args.txt
  fi
  if [ "$prev" = "--body" ]; then
    printf '%s\n' "$arg" >> /tmp/cursor-test-gh-args.txt
  fi
  prev="$arg"
done
echo "gh invoked"
EOF

cat > "${STUB_DIR}/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > /tmp/cursor-test-curl-args.txt
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$out" ]; then
  if [ -n "${CURSOR_TEST_RESPONSE_FILE:-}" ]; then
    cat "$CURSOR_TEST_RESPONSE_FILE" > "$out"
  else
    printf '%s\n' '{"agent":{"url":"https://cursor.com/agents/bc-test"}}' > "$out"
  fi
fi
printf '%s' "${CURSOR_TEST_HTTP_CODE:-201}"
EOF

chmod +x "${STUB_DIR}/gh" "${STUB_DIR}/curl"

run_launcher() {
  env -i \
    PATH="${STUB_DIR}:/usr/bin:/bin" \
    HOME="${STUB_DIR}" \
    CURSOR_API_KEY="${CURSOR_API_KEY-}" \
    GH_TOKEN="ghs_test" \
    ISSUE_NUMBER="24" \
    ISSUE_TITLE="BLD-00003 Publish all JSON schemas" \
    ISSUE_BODY="${ISSUE_BODY-}" \
    ISSUE_URL="https://github.com/dzmauchy/bld/issues/24" \
    REPO_URL="https://github.com/dzmauchy/bld" \
    DEFAULT_BRANCH="main" \
    GITHUB_REPOSITORY="dzmauchy/bld" \
    GITHUB_SERVER_URL="https://github.com" \
    GITHUB_RUN_ID="34732569452" \
    CURSOR_TEST_RESPONSE_FILE="${CURSOR_TEST_RESPONSE_FILE-}" \
    CURSOR_TEST_HTTP_CODE="${CURSOR_TEST_HTTP_CODE-}" \
    bash "$SCRIPT"
}

rm -f /tmp/cursor-test-gh-args.txt /tmp/cursor-test-curl-args.txt /tmp/cursor-agent-payload.json
set +e
unset CURSOR_API_KEY
ISSUE_BODY=$'All schemas:\n\n- core/assets/schemas/blocks.schema.json\nUse `defaults` and $HOME and "quotes".'
OUT="$(ISSUE_BODY="$ISSUE_BODY" run_launcher 2>&1)"
STATUS=$?
set -e
assert_eq "missing secret exit 0" "$STATUS" "0"
assert_contains "missing secret warning annotation" "$OUT" "Repository secret CURSOR_API_KEY is not set"
GH_ARGS="$(cat /tmp/cursor-test-gh-args.txt)"
assert_contains "gh uses --repo" "$GH_ARGS" "--repo"
assert_contains "gh targets this repository" "$GH_ARGS" "dzmauchy/bld"
assert_contains "gh comments on the issue" "$GH_ARGS" "24"
assert_contains "missing-secret comment mentions @cursor" "$GH_ARGS" "@cursor"
assert_contains "missing-secret comment uses fresh main" "$GH_ARGS" "Use the fresh main branch"
assert_contains "missing-secret comment keeps backticks" "$GH_ARGS" '`defaults`'
assert_contains "missing-secret comment keeps dollar vars" "$GH_ARGS" '$HOME'
assert_contains "missing-secret comment keeps quotes" "$GH_ARGS" 'quotes'
assert_eq "missing secret does not call Cursor API" "$(test -f /tmp/cursor-test-curl-args.txt && echo yes || echo no)" "no"

write_response() {
  local file="${STUB_DIR}/response.json"
  printf '%s\n' "$1" > "$file"
  export CURSOR_TEST_RESPONSE_FILE="$file"
}

ISSUE_BODY=$'All schemas:\n\n- core/assets/schemas/blocks.schema.json\nUse `defaults` and $HOME and "quotes".'
export CURSOR_API_KEY="test-key"
export CURSOR_TEST_HTTP_CODE="201"
write_response '{"agent":{"id":"bc-00000000-0000-0000-0000-000000000001","url":"https://cursor.com/agents/bc-00000000-0000-0000-0000-000000000001"}}'
rm -f /tmp/cursor-test-gh-args.txt /tmp/cursor-test-curl-args.txt /tmp/cursor-agent-payload.json
set +e
OUT="$(ISSUE_BODY="$ISSUE_BODY" run_launcher 2>&1)"
STATUS=$?
set -e
assert_eq "v1 success exit 0" "$STATUS" "0"
assert_contains "v1 success comment" "$(cat /tmp/cursor-test-gh-args.txt)" "https://cursor.com/agents/bc-00000000-0000-0000-0000-000000000001"
CURL_ARGS="$(cat /tmp/cursor-test-curl-args.txt)"
assert_contains "curl uses basic auth" "$CURL_ARGS" "-u"
assert_contains "curl posts v1 agents" "$CURL_ARGS" "https://api.cursor.com/v1/agents"
assert_contains "curl sends payload file" "$CURL_ARGS" "--data"
PAYLOAD="$(cat /tmp/cursor-agent-payload.json)"
assert_contains "payload keeps backticks" "$PAYLOAD" '`defaults`'
assert_contains "payload keeps dollar vars" "$PAYLOAD" '$HOME'
assert_contains "payload keeps quotes" "$PAYLOAD" 'quotes'
assert_contains "payload starts from default branch" "$PAYLOAD" '"startingRef": "main"'
assert_contains "payload auto-creates a PR" "$PAYLOAD" '"autoCreatePR": true'
assert_contains "payload uses fresh main" "$PAYLOAD" "Use the fresh main branch"

write_response '{"id":"bc_abc123","target":{"url":"https://cursor.com/agents?id=bc_abc123"}}'
rm -f /tmp/cursor-test-gh-args.txt
set +e
OUT="$(run_launcher 2>&1)"
STATUS=$?
set -e
assert_eq "v0 success exit 0" "$STATUS" "0"
assert_contains "v0 success comment uses target.url" "$(cat /tmp/cursor-test-gh-args.txt)" "https://cursor.com/agents?id=bc_abc123"

write_response '{"id":"bc-only-id"}'
rm -f /tmp/cursor-test-gh-args.txt
set +e
OUT="$(run_launcher 2>&1)"
STATUS=$?
set -e
assert_eq "id-only success exit 0" "$STATUS" "0"
assert_contains "id-only synthesizes agent URL" "$(cat /tmp/cursor-test-gh-args.txt)" "https://cursor.com/agents/bc-only-id"

export CURSOR_TEST_HTTP_CODE="401"
write_response '{"error":"unauthorized"}'
rm -f /tmp/cursor-test-gh-args.txt
set +e
OUT="$(run_launcher 2>&1)"
STATUS=$?
set -e
assert_eq "http 401 exit 1" "$STATUS" "1"
assert_contains "http 401 comments with status" "$(cat /tmp/cursor-test-gh-args.txt)" "HTTP 401"
assert_contains "http 401 error annotation" "$OUT" "Cursor API returned HTTP 401"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
