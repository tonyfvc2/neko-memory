---
name: neko-memory
description: 管理与使用「猫猫的记忆（Neko Memory）」本地长期记忆插件：按证据检索跨会话记忆、保存重要偏好与交接摘要、导入旧 Markdown 笔记，或打开侧边栏记忆管理面板。
---

# 猫猫的记忆 · Neko Memory

本地 SQLite 长期记忆系统，带 30 天鲜活度半衰期自然淡忘机制，平时不占上下文。

## 可用工具（MCP）

- `neko_memory_recall`：按关键词或自然语言检索相关记忆（默认返回最相关的 5 条，附带相对时间与鲜活度）。
- `neko_memory_remember`：写入新记忆（自动合并高相似度重复项）。
- `neko_memory_forget`：软归档指定 ID 的记忆（可在面板中随时恢复）。
- `neko_memory_list`：查看记忆列表与统计信息。
- `neko_memory_import_file`：从本地 `.md` / `.txt` 笔记批量导入记忆。

## 侧边栏面板

当用户想查看、搜索、编辑或管理所有长期记忆时，在回复中提供一键打开链接：

[猫猫的记忆面板](sidecar://neko-memory/memory_panel/)
