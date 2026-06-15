#!/usr/bin/env bash
# install.sh — one-time setup for cordon on a new machine. Clones cordon,
# installs the engine's deps, and points CORDON_HOME at it via ~/.zshrc so every
# repo's `scripts/check.sh` and the reusable CI gate can find it. Idempotent and
# re-runnable; backs up ~/.zshrc before editing it.
#
#   curl -fsSL https://raw.githubusercontent.com/joeseverino/cordon/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- /custom/dir     # clone to a custom dir
#
# Targets zsh (~/.zshrc). Bash users: add the printed export to ~/.bashrc instead.
set -euo pipefail

REPO="https://github.com/joeseverino/cordon.git"
DIR="${CORDON_HOME:-${1:-$HOME/.cordon}}"
ZSHRC="${ZSHRC:-$HOME/.zshrc}"

echo "cordon → $DIR"

# 1) Clone, or fast-forward an existing checkout.
if [ -d "$DIR/.git" ]; then
  echo "  • existing checkout — updating"
  git -C "$DIR" pull --ff-only --quiet || echo "  ! couldn't fast-forward; leaving as-is"
else
  echo "  • cloning"
  git clone --quiet "$REPO" "$DIR"
fi

# 2) Install the engine's deps (it needs ajv to validate against the schema).
if command -v npm >/dev/null 2>&1; then
  echo "  • installing deps"
  ( cd "$DIR" && { npm ci --silent 2>/dev/null || npm install --silent; } )
else
  echo "  ! npm not found — install Node 20+, then: (cd \"$DIR\" && npm ci)" >&2
fi

# 3) Wire CORDON_HOME into ~/.zshrc — idempotent, with a timestamped backup.
if [ -f "$ZSHRC" ] && grep -qF "export CORDON_HOME=" "$ZSHRC"; then
  echo "  • CORDON_HOME already set in $ZSHRC — leaving it"
else
  if [ -f "$ZSHRC" ]; then
    backup="$ZSHRC.cordon-bak.$(date +%Y%m%d%H%M%S)"
    cp "$ZSHRC" "$backup"
    echo "  • backed up $ZSHRC → $backup"
  fi
  printf '\n# cordon checks engine — added by cordon/install.sh\nexport CORDON_HOME="%s"\n' "$DIR" >> "$ZSHRC"
  echo "  • added export CORDON_HOME=\"$DIR\" to $ZSHRC"
fi

echo
echo "✓ cordon is set up. Restart your shell, or:  source \"$ZSHRC\""
echo "  then in any cordon repo:  ./scripts/check.sh"
