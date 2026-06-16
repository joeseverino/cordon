#!/usr/bin/env sh
# Lint every shell script tracked in the repo at $PWD — both *.sh/*.bash AND
# extensionless scripts carrying a shell shebang, because a tool repo's bin/*
# executables and .githooks/* hooks are shell with no extension. cordon's check
# catalog references this by path so the discovery lives here, readable, instead
# of as an unreadable JSON one-liner. git ls-files scopes it to tracked files, so
# node_modules and other gitignored trees never leak in.
set -eu

git ls-files | while IFS= read -r f; do
  base=${f##*/}
  case "$base" in
    *.sh | *.bash) printf '%s\0' "$f" ;;        # by extension
    *.*) : ;;                                    # any other extension: not shell
    *)                                           # no extension: only if shell-shebanged
      [ "$(head -c2 "$f" 2>/dev/null)" = '#!' ] &&
        head -1 "$f" | grep -Eq '(ba)?sh' &&
        printf '%s\0' "$f" ;;
  esac
done | xargs -0 shellcheck -x
