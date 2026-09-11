#!/usr/bin/env bash
set -euo pipefail

comment() {
  local body_file status
  body_file="$(mktemp)"
  printf '%s\n' "$1" > "$body_file"
  set +e
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file "$body_file"
  status=$?
  set -e
  rm -f "$body_file"
  if [ "$status" -ne 0 ]; then
    echo "::warning::Failed to comment on issue #${ISSUE_NUMBER}"
    return 1
  fi
}

prompt_text() {
  jq -n -r \
    --arg title "${ISSUE_TITLE}" \
    --arg number "${ISSUE_NUMBER}" \
    --arg body "${ISSUE_BODY:-}" \
    --arg issueUrl "${ISSUE_URL}" \
    --arg ref "${DEFAULT_BRANCH}" \
    '
      "Use the fresh main branch.\n" +
      "Fetch origin/\($ref) and start from that tip before making changes.\n\n" +
      "Resolve GitHub Issue #\($number): \($title)\n\n" +
      "Issue URL: \($issueUrl)\n\n" +
      "Description:\n\($body)\n\n" +
      "Create a new branch from the default branch, implement the requested changes, run existing tests, and submit a pull request that closes this issue.\n" +
      "Follow the repository AGENTS.md conventions."
    '
}

launch_via_github_app() {
  local prompt
  prompt="$(prompt_text)"
  if ! comment "$(printf '@cursor %s' "$prompt")"; then
    echo "::error::Failed to post @cursor on issue #${ISSUE_NUMBER}"
    exit 1
  fi
  echo "::notice::Posted @cursor on issue #${ISSUE_NUMBER} so the Cursor GitHub App can start a Cloud Agent."
}

if [ -z "${CURSOR_API_KEY:-}" ]; then
  echo "::warning::Repository secret CURSOR_API_KEY is not set. Falling back to an @cursor issue comment."
  launch_via_github_app
  exit 0
fi

jq -n \
  --arg text "$(prompt_text)" \
  --arg title "${ISSUE_TITLE}" \
  --arg number "${ISSUE_NUMBER}" \
  --arg repo "${REPO_URL}" \
  --arg ref "${DEFAULT_BRANCH}" \
  '{
    prompt: { text: $text },
    name: (("Issue #\($number): \($title)")[0:100]),
    repos: [{ url: $repo, startingRef: $ref }],
    autoCreatePR: true
  }' > /tmp/cursor-agent-payload.json

HTTP_CODE="$(curl -sS -o /tmp/cursor-agent-response.json -w "%{http_code}" \
  -u "${CURSOR_API_KEY}:" \
  -H "Content-Type: application/json" \
  -X POST "https://api.cursor.com/v1/agents" \
  --data @/tmp/cursor-agent-payload.json)"

cat /tmp/cursor-agent-response.json
echo
echo "Cursor API HTTP status: ${HTTP_CODE}"

if [ "${HTTP_CODE}" -lt 200 ] || [ "${HTTP_CODE}" -ge 300 ]; then
  comment "Failed to start a Cursor agent (HTTP ${HTTP_CODE}). Check the [workflow run](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}) and that \`CURSOR_API_KEY\` is valid." || true
  echo "::error::Cursor API returned HTTP ${HTTP_CODE}"
  exit 1
fi

AGENT_URL="$(jq -r '.agent.url // .target.url // empty' /tmp/cursor-agent-response.json 2>/dev/null || true)"
if [ -z "${AGENT_URL}" ]; then
  AGENT_ID="$(jq -r '.agent.id // .id // empty' /tmp/cursor-agent-response.json 2>/dev/null || true)"
  if [ -n "${AGENT_ID}" ] && [ "${AGENT_ID}" != "null" ]; then
    AGENT_URL="https://cursor.com/agents/${AGENT_ID}"
  fi
fi

if [ -z "${AGENT_URL}" ]; then
  comment "Cursor API accepted the request but did not return an agent URL. Check the [workflow run](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})." || true
  echo "::error::Cursor API response did not include an agent URL"
  exit 1
fi

comment "Started a Cursor cloud agent for this issue: ${AGENT_URL}" || true
