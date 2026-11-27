import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { NekoMemoryStore } from '../../lib/memory-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(__dirname, 'index.html');
const store = new NekoMemoryStore();

function readHtml() {
  return fs.readFileSync(HTML_FILE, 'utf8');
}

function handleStats() {
  return store.getStats();
}

function handleList(data = {}) {
  const items = store.list({
    include_archived: data.include_archived === '1' || data.include_archived === true,
    status: data.status || '',
    category: data.category || '',
    workspace: data.workspace || '',
    search: data.search || '',
    sort: data.sort || 'newest',
    limit: Number(data.limit) || 200
  });
  return { ok: true, items };
}

function handleAdd(data = {}) {
  const res = store.remember({
    content: data.content,
    category: data.category || 'fact',
    tags: data.tags || '',
    workspace: data.workspace || '',
    importance: data.importance,
    half_life_days: data.half_life_days
  });
  return { ok: true, ...res };
}

function handleGraph(data = {}) {
  return {
    ok: true,
    ...store.getGraph({
      include_archived: data.include_archived === '1' || data.include_archived === true,
      category: data.category || ''
    })
  };
}

function handleArchive(data = {}) {
  const m = store.archive(data.id, data.archived !== false);
  return { ok: Boolean(m), memory: m };
}

function handleUpdate(data = {}) {
  const m = store.update(data.id, data);
  return { ok: Boolean(m), memory: m };
}

function handleDelete(data = {}) {
  return { ok: store.deleteHard(data.id) };
}

function handleRecall(data = {}) {
  const items = store.recall({
    query: data.query || '',
    workspace: data.workspace || '',
    category: data.category || '',
    limit: Number(data.limit) || 8,
    record_recall: false
  });
  return { ok: true, items };
}

function handleLogs(data = {}) {
  return { ok: true, items: store.getRecallLogs(Number(data.limit) || 40) };
}

function handleExport(data = {}) {
  const res = store.exportMemories({
    format: data.format || 'json',
    include_archived: data.include_archived !== '0' && data.include_archived !== false
  });
  return { ok: true, ...res };
}

function handleImportPreview(data = {}) {
  return store.previewImport({
    content: data.content || '',
    format: data.format || '',
    filename: data.filename || '',
    duplicate_strategy: data.duplicate_strategy || 'skip',
    defaultCategory: data.defaultCategory || 'fact',
    defaultWorkspace: data.defaultWorkspace || ''
  });
}

function handleImportCommit(data = {}) {
  return store.importMemories({
    content: data.content || '',
    format: data.format || '',
    filename: data.filename || '',
    duplicate_strategy: data.duplicate_strategy || 'skip',
    defaultCategory: data.defaultCategory || 'fact',
    defaultWorkspace: data.defaultWorkspace || ''
  });
}

let SidecarApp = null;
try {
  const sdk = await import('sidecar_sdk');
  SidecarApp = sdk.SidecarApp;
} catch {
  // Standalone fallback
}

const isSidecarEnv = Boolean(
  process.env.ANTIGRAVITY_LS_ADDRESS &&
  process.env.ANTIGRAVITY_CSRF_TOKEN &&
  process.env.ANTIGRAVITY_SIDECAR_WEB_PORT &&
  SidecarApp
);

if (isSidecarEnv) {
  const app = new SidecarApp();
  app.page('/', () => readHtml());
  app.api('/api/stats', handleStats, 'GET');
  app.api('/api/memories', handleList, 'GET');
  app.api('/api/memories', handleAdd, 'POST');
  app.api('/api/archive', handleArchive, 'POST');
  app.api('/api/update', handleUpdate, 'POST');
  app.api('/api/delete', handleDelete, 'POST');
  app.api('/api/recall', handleRecall, 'POST');
  app.api('/api/logs', handleLogs, 'GET');
  app.api('/api/graph', handleGraph, 'GET');
  app.api('/api/export', handleExport, 'GET');
  app.api('/api/export', handleExport, 'POST');
  app.api('/api/import/preview', handleImportPreview, 'POST');
  app.api('/api/import/commit', handleImportCommit, 'POST');
  await app.run();
  console.log('[neko-memory sidecar] registered and running');
} else {
  const port = Number(process.env.PORT) || 8789;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const sendJson = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readHtml());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(200, handleStats());
    if (req.method === 'GET' && url.pathname === '/api/memories') return sendJson(200, handleList(Object.fromEntries(url.searchParams)));
    if (req.method === 'GET' && url.pathname === '/api/logs') return sendJson(200, handleLogs(Object.fromEntries(url.searchParams)));
    if (req.method === 'GET' && url.pathname === '/api/graph') return sendJson(200, handleGraph(Object.fromEntries(url.searchParams)));
    if (req.method === 'GET' && url.pathname === '/api/export') return sendJson(200, handleExport(Object.fromEntries(url.searchParams)));
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 15 * 1024 * 1024) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (url.pathname === '/api/memories') return sendJson(200, handleAdd(data));
          if (url.pathname === '/api/archive') return sendJson(200, handleArchive(data));
          if (url.pathname === '/api/update') return sendJson(200, handleUpdate(data));
          if (url.pathname === '/api/delete') return sendJson(200, handleDelete(data));
          if (url.pathname === '/api/recall') return sendJson(200, handleRecall(data));
          if (url.pathname === '/api/export') return sendJson(200, handleExport(data));
          if (url.pathname === '/api/import/preview') return sendJson(200, handleImportPreview(data));
          if (url.pathname === '/api/import/commit') return sendJson(200, handleImportCommit(data));
          sendJson(404, { error: 'Not found' });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }
    sendJson(404, { error: 'Not found' });
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[neko-memory sidecar] standalone listening at http://127.0.0.1:${port}`);
  });
}
