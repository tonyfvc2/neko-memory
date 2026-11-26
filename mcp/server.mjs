import readline from 'node:readline';
import { NekoMemoryStore } from '../lib/memory-store.mjs';

const store = new NekoMemoryStore();

const TOOLS = [
  {
    name: 'neko_memory_recall',
    description: 'Search long-term memory by natural language query (Chinese & English). Uses evidence-weighted matching with 30-day half-life freshness decay. Returns only the top relevant memories with relative timestamps so context stays lean.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall (keywords, topic, user preference, project name, or error).' },
        workspace: { type: 'string', description: 'Optional workspace/project name to prioritize.' },
        category: { type: 'string', enum: ['preference', 'project', 'fact', 'decision', 'pitfall', 'handoff'], description: 'Optional category filter.' },
        limit: { type: 'number', description: 'Max number of memories to return (default 5, max 10).' }
      },
      required: ['query']
    }
  },
  {
    name: 'neko_memory_remember',
    description: 'Save a lasting memory (user preference, project architecture, important decision, solved pitfall, or session handoff) into local SQLite long-term memory. Automatically merges near-duplicates.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Concise, clear statement of what to remember.' },
        category: { type: 'string', enum: ['preference', 'project', 'fact', 'decision', 'pitfall', 'handoff'], description: 'Memory category (default: fact).' },
        tags: { type: 'string', description: 'Optional comma-separated tags.' },
        workspace: { type: 'string', description: 'Optional project/workspace name.' },
        importance: { type: 'number', description: 'Importance 1-5 (default 3; 5 = core preference/rule).' },
        half_life_days: { type: 'number', description: 'Freshness half-life in days (defaults by category: preference=365, decision/pitfall=90, project=60, fact=30, handoff=14).' }
      },
      required: ['content']
    }
  },
  {
    name: 'neko_memory_forget',
    description: 'Soft-archive a memory by ID so it is no longer recalled (remains recoverable in the Neko Memory sidecar UI).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Memory ID to archive.' }
      },
      required: ['id']
    }
  },
  {
    name: 'neko_memory_list',
    description: 'List recent long-term memories and database statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter.' },
        search: { type: 'string', description: 'Optional substring filter.' },
        include_archived: { type: 'boolean', description: 'Whether to include archived memories (default false).' },
        limit: { type: 'number', description: 'Max items to return (default 20).' }
      }
    }
  },
  {
    name: 'neko_memory_import_file',
    description: 'Import bullet points / notes from a local Markdown or text file into long-term memory.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to a local .md or .txt file.' },
        category: { type: 'string', description: 'Category for imported memories (default: fact).' },
        workspace: { type: 'string', description: 'Optional workspace tag.' }
      },
      required: ['file_path']
    }
  }
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleCallTool(name, args = {}) {
  if (name === 'neko_memory_recall') {
    const results = store.recall({
      query: args.query,
      workspace: args.workspace || '',
      category: args.category || '',
      limit: Math.min(10, Number(args.limit) || 5)
    });
    if (results.length === 0) {
      return { content: [{ type: 'text', text: '没有检索到相关的长期记忆。' }] };
    }
    const lines = results.map((m) =>
      `[#${m.id} | ${m.category} | ${m.time_label} | 鲜活度 ${m.freshness_pct}% | 重要度 ${m.importance}/5] ${m.content}${m.tags ? ` (标签: ${m.tags})` : ''}`
    );
    return { content: [{ type: 'text', text: `召回 ${results.length} 条相关记忆：\n` + lines.join('\n') }] };
  }

  if (name === 'neko_memory_remember') {
    const res = store.remember({
      content: args.content,
      category: args.category || 'fact',
      tags: args.tags || '',
      workspace: args.workspace || '',
      importance: args.importance,
      half_life_days: args.half_life_days
    });
    const m = res.memory;
    return {
      content: [{
        type: 'text',
        text: `已${res.action === 'created' ? '记住' : '更新合并'}记忆 #${m.id} [${m.category} | 半衰期 ${m.half_life_days} 天]：${m.content}`
      }]
    };
  }

  if (name === 'neko_memory_forget') {
    const m = store.archive(args.id, true);
    return {
      content: [{
        type: 'text',
        text: m ? `已将记忆 #${m.id} 归档遗忘（可在侧边栏面板中随时找回）。` : `未找到记忆 #${args.id}。`
      }]
    };
  }

  if (name === 'neko_memory_list') {
    const stats = store.getStats();
    const items = store.list({
      category: args.category || '',
      search: args.search || '',
      include_archived: Boolean(args.include_archived),
      limit: Number(args.limit) || 20
    });
    const header = `猫猫的记忆库统计：活跃 ${stats.active_count} 条 | 归档 ${stats.archived_count} 条 | 累计召回 ${stats.total_recalls} 次`;
    const body = items.length === 0
      ? '（暂无记忆）'
      : items.map((m) => `[#${m.id}${m.archived ? ' 已归档' : ''} | ${m.category} | ${m.time_label} | 鲜活度 ${m.freshness_pct}%] ${m.content}`).join('\n');
    return { content: [{ type: 'text', text: `${header}\n\n${body}` }] };
  }

  if (name === 'neko_memory_import_file') {
    const res = store.importMarkdown(args.file_path, {
      category: args.category || 'fact',
      workspace: args.workspace || ''
    });
    return { content: [{ type: 'text', text: `已从 ${res.file} 导入 ${res.imported} 条记忆。` }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (method === 'notifications/initialized' || id === undefined) return;

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'neko-memory', version: '1.0.0' }
        }
      });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const result = handleCallTool(params?.name, params?.arguments || {});
      send({ jsonrpc: '2.0', id, result });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `错误: ${err.message}` }], isError: true }
    });
  }
});
