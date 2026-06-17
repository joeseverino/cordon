#!/usr/bin/env sh
# Lint every shellcheck-supported shell script tracked in the repo at $PWD:
# *.sh / *.bash by extension, AND extensionless scripts carrying a shell shebang
# (a tool repo's bin/* executables and .githooks/* hooks are shell with no
# extension). zsh is SKIPPED — shellcheck can't parse it (SC1071: "only supports
# sh/bash/dash/ksh") — so a repo with zsh tools (bin/* with #!/bin/zsh, or a .sh
# carrying a zsh shebang) lints clean instead of failing on its own toolchain.
# cordon's catalog references this by path so the discovery lives here, readable,
# instead of as an unreadable JSON one-liner. git ls-files scopes it to tracked
# files, so node_modules and other gitignored trees never leak in.
set -eu

targets=$(mktemp)
trap 'rm -f "$targets"' EXIT

git ls-files | while IFS= read -r f; do
  [ -f "$f" ] || continue
  first=$(head -1 "$f" 2>/dev/null || true)
  case "$first" in *zsh*) continue ;; esac      # zsh: shellcheck can't parse it
  base=${f##*/}
  case "$base" in
    *.sh | *.bash) printf '%s\0' "$f" >> "$targets" ;;    # shell by extension
    *.*) : ;;                                             # other extension: not shell
    *) case "$first" in '#!'*sh*) printf '%s\0' "$f" >> "$targets" ;; esac ;;  # shebanged shell
  esac
done

if [ -s "$targets" ]; then
  xargs -0 shellcheck -x < "$targets"
else
  echo "shellcheck: no supported shell scripts to lint"
fi
