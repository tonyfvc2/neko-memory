#!/usr/bin/env bash
set -euo pipefail

DEST="${HOME}/.gemini/config/plugins/neko-memory"
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
  echo "[OK] Uninstalled neko-memory from: $DEST"
  echo "[i] Your local memory database at ~/.gemini/antigravity/neko_memory/memory.db was preserved."
else
  echo "[i] neko-memory is not installed at: $DEST"
fi
