#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.gemini/config/plugins/neko-memory"

mkdir -p "$DEST"
for f in plugin.json mcp_config.json README.md LICENSE; do
  [ -f "$REPO_ROOT/$f" ] && cp -f "$REPO_ROOT/$f" "$DEST/$f"
done
for d in assets lib mcp rules sidecars skills; do
  if [ -d "$REPO_ROOT/$d" ]; then
    rm -rf "$DEST/$d"
    cp -R "$REPO_ROOT/$d" "$DEST/$d"
  fi
done

echo "[OK] Installed neko-memory to: $DEST"
echo "[i] Restart Antigravity or start a new conversation to activate Neko Memory."
