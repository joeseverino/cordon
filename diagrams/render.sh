#!/usr/bin/env bash
# Re-render the committed diagram PNGs from the .mmd sources.
# Pre-rendered pixels because GitHub's live mermaid clips node text in Safari.
set -euo pipefail
cd "$(dirname "$0")"
for src in *.mmd; do
    npx -y -p @mermaid-js/mermaid-cli mmdc -i "$src" -o "${src%.mmd}.png" -w 1100 -s 2 -b white
done
