#!/usr/bin/env bash
# Lab 06 - Automated CLI Audit (run inside GitHub Codespaces only)
# Usage: bash audit.sh https://<your-service>.onrender.com
set -uo pipefail

APP_URL="${1:?Usage: bash audit.sh https://<your-service>.onrender.com}"
APP_URL="${APP_URL%/}"
WF="../.github/workflows/deploy.yml"
PASS=0
FAIL=0

check() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[PASS] ${description}"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] ${description}"
    FAIL=$((FAIL + 1))
  fi
}

# NOTE: counts only the job keys under "jobs:" (see note below)
jobs_total()   { sed -n '/^jobs:/,$p' "${WF}" | grep -cE '^  [a-z_-]+:$'; }
timeouts_total() { grep -c 'timeout-minutes:' "${WF}"; }
all_jobs_have_timeout() { [ "$(jobs_total)" -gt 0 ] && [ "$(jobs_total)" -eq "$(timeouts_total)" ]; }

no_hardcoded_secrets() {
  ! grep -RIEq 'api\.render\.com/deploy/srv-|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' \
    --exclude-dir=.git --exclude-dir=node_modules --exclude=audit.sh .
}

latest_run_green() {
  [ "$(gh run list --workflow deploy.yml --branch main --limit 1 \
        --json conclusion --jq '.[0].conclusion')" = "success" ]
}

has_blocked_run() {
  [ "$(gh run list --workflow deploy.yml --limit 30 \
        --json conclusion --jq '[.[] | select(.conclusion=="failure")] | length')" -ge 1 ]
}

live_commit_matches_head() {
  git fetch origin main --quiet
  local live
  live="$(curl --silent --max-time 20 "${APP_URL}/api/status" | jq -r '.commit')"
  [ "${live}" = "$(git rev-parse origin/main)" ]
}

echo "=== LAB 06 AUTOMATED AUDIT : $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
check "Branch is main"                              test "$(git rev-parse --abbrev-ref HEAD)" = "main"
check "Workflow file exists (${WF})"                test -f "${WF}"
check "Every job declares timeout-minutes"          all_jobs_have_timeout
check "Pipeline uses needs: gating"                 grep -q 'needs:' "${WF}"
check "No hard-coded secrets in repository"         no_hardcoded_secrets
check "Secrets are referenced via secrets context"  grep -q 'secrets.RENDER_DEPLOY_HOOK_URL' "${WF}"
check "Git history contains >= 4 commits"           test "$(git rev-list --count HEAD)" -ge 4
check "History contains a revert (no force-push)"   bash -c "git log --oneline --grep='^Revert' | grep -q ."
check "Latest run on main is green (exit 0)"        latest_run_green
check "At least one blocked run (chaos evidence)"   has_blocked_run
check "Live /healthz returns HTTP 200"              curl --fail --silent --max-time 30 "${APP_URL}/healthz"
check "Live commit equals origin/main HEAD"         live_commit_matches_head

echo
echo "--- git log (last 8) ---";   git log --oneline -n 8
echo "--- gh run list (last 6) ---"; gh run list --workflow deploy.yml --limit 6
echo "--- live /api/status ---";   curl --silent --max-time 20 "${APP_URL}/api/status"; echo
echo
echo "RESULT: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
