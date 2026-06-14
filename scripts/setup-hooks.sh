#!/usr/bin/env bash
# setup-hooks.sh — enable the tracked git hooks. Run once per clone: the hooks
# live in .githooks/ (so they travel with the repo), but core.hooksPath is local
# config and does not. Idempotent.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "Local hooks on (core.hooksPath=.githooks):"
echo "  pre-commit — refuses commits on main/master (bypass: ALLOW_MAIN_COMMIT=1)"
echo "  commit-msg — rejects AI attribution in the message (bypass: git commit --no-verify)"
echo "  pre-push   — runs npm test, never push red (bypass: git push --no-verify)"
