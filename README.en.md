<div align="center">

<img src="assets/logo.png" width="112" alt="Neko Memory Logo" />

# 🐾 Neko Memory

**Zero-dependency local long-term memory plugin with a 2D/3D interactive Star Map for Google Antigravity.**

[简体中文](README.md) · **English**

![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![SQLite Built-in](https://img.shields.io/badge/storage-local%20SQLite-6366f1)
![Antigravity Plugin](https://img.shields.io/badge/Antigravity-Native%20Plugin-a855f7)
![License: MIT](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## ✨ Highlights

- **🌌 Next-Gen Luminous 2D / 3D Galaxy Star Map (v1.1 Redesign)**: Built-in Antigravity Sidecar panel featuring luminous celestial bloom, golden solar hubs with orbital spiral stardust, topic clusters, floating glassmorphic pill labels, live graph search highlighting, node directory drawer, and 3 themes (*Cosmos / Liquid Glass / Warm Paper*).
- **📦 Active Export & Preview-Verified Import (New in v1.1)**: Export all memories in one click as **JSON / CSV (UTF-8 BOM) / Markdown**; import via file picker or drag-and-drop with an interactive **Preview & Duplicate Check** modal (`Skip duplicates` / `Overwrite` / `Import all`).
- **⏳ Natural Freshness Decay (Half-Life)**: Memories gently fade over time based on category-aware half-lives (`preference`: 365 days, `decision`/`pitfall`: 90 days, `project`: 60 days, `fact`: 30 days, `handoff`: 14 days) — never silently deleted, and automatically refreshed whenever recalled.
- **🔍 Zero Context Bloat**: Memories are never dumped into every prompt. Only the top 3–5 evidence-matched memories (with Chinese + English tokenization and IDF weighting) are recalled on demand.
- **🔒 100% Local & Zero Dependencies**: Powered by Node.js built-in `node:sqlite` (`~/.gemini/antigravity/neko_memory/memory.db`). No external servers, no API keys, no `npm install`.

## 🚀 Installation

### Option 1: Antigravity CLI (Recommended)
```bash
agy plugin install https://github.com/tonyfvc2/neko-memory
```

### Option 2: Windows One-Click Installer (No system Node.js required)
1. Download and extract this repository or a release zip.
2. Double-click **`install.bat`** (automatically falls back to Antigravity's built-in `agy-node.cmd` if Node.js 22.5+ is not installed globally).
3. Restart Antigravity or open a new conversation.

### Option 3: macOS / Linux
```bash
git clone https://github.com/tonyfvc2/neko-memory.git
cd neko-memory
chmod +x install.sh && ./install.sh
```

## 🛠️ MCP Tools

- `neko_memory_recall` — Evidence-weighted cross-session search with relative timestamps & freshness scores.
- `neko_memory_remember` — Save a memory with smart category half-life defaults and automatic near-duplicate merging.
- `neko_memory_forget` — Soft-archive a memory (recoverable anytime in the Star Map panel).
- `neko_memory_list` — List memories and database statistics.
- `neko_memory_import_file` — Batch import memories from local `.json`, `.csv`, `.md`, or `.txt` files with configurable duplicate handling.
- `neko_memory_export_file` — Export all local memories to a `.json`, `.csv`, or `.md` backup file.

## 🧪 Testing

```bash
npm test
```

## 📄 License

[MIT](LICENSE)
