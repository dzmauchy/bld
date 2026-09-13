#!/usr/bin/env bash
set -euo pipefail

comment() {
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$1" \
    || echo "::warning::Failed to comment on issue #${ISSUE_NUMBER}"
}

if [ -z "${CURSOR_API_KEY:-}" ]; then
  comment "$(cat <<'EOF'
Cannot start a Cursor agent: repository secret `CURSOR_API_KEY` is not configured.

Create an API key at https://cursor.com/dashboard/api and add it as a GitHub Actions repository secret named `CURSOR_API_KEY`.

Until that secret is set, comment `@cursor` on this issue to start a Cloud Agent via the Cursor GitHub App.
EOF
)"
  echo "::error::Repository secret CURSOR_API_KEY is not set."
  exit 1
fi

jq -n \
  --arg title "${ISSUE_TITLE}" \
  --arg number "${ISSUE_NUMBER}" \
  --arg body "${ISSUE_BODY:-}" \
  --arg issueUrl "${ISSUE_URL}" \
  --arg repo "${REPO_URL}" \
  --arg ref "${DEFAULT_BRANCH}" \
  '{
    prompt: {
      text: (
        "Resolve GitHub Issue #\($number): \($title)\n\n" +
        "Issue URL: \($issueUrl)\n\n" +
        "Description:\n\($body)\n\n" +
        "Create a new branch from the default branch, implement the requested changes, run existing tests, and submit a pull request that closes this issue.\n" +
        "Follow the repository AGENTS.md conventions."
      )
    },
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
  comment "Failed to start a Cursor agent (HTTP ${HTTP_CODE}). Check the [workflow run](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}) and that \`CURSOR_API_KEY\` is valid."
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
  comment "Cursor API accepted the request but did not return an agent URL. Check the [workflow run](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})."
  echo "::error::Cursor API response did not include an agent URL"
  exit 1
fi

comment "Started a Cursor cloud agent for this issue: ${AGENT_URL}"
