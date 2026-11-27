import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'neko_memory');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'memory.db');

export const DEFAULT_HALF_LIFE_BY_CATEGORY = {
  preference: 365,
  decision: 90,
  pitfall: 90,
  project: 60,
  fact: 30,
  handoff: 14
};

export const VALID_CATEGORIES = new Set(Object.keys(DEFAULT_HALF_LIFE_BY_CATEGORY));

export function normalizeCategory(cat) {
  const c = String(cat || '').trim().toLowerCase();
  return VALID_CATEGORIES.has(c) ? c : 'fact';
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function parseCsv(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

export function resolveHalfLife(category, explicitHalfLife) {
  if (explicitHalfLife !== undefined && explicitHalfLife !== null && explicitHalfLife !== '') {
    const n = Number(explicitHalfLife);
    if (!Number.isNaN(n) && n >= 1) return Math.max(1, Math.min(3650, n));
  }
  return DEFAULT_HALF_LIFE_BY_CATEGORY[category] || 30;
}

const ZH_STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也',
  '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  '把', '被', '让', '给', '对', '从', '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '怎么',
  '什么', '可以', '帮我', '一下', '这个', '那个', '然后', '或者', '但是', '如果', '因为', '所以'
]);

const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at',
  'for', 'with', 'by', 'from', 'as', 'it', 'this', 'that', 'and', 'or', 'but', 'if', 'not',
  'can', 'will', 'do', 'does', 'did', 'have', 'has', 'had', 'my', 'your', 'me', 'you'
]);

export function tokenize(text) {
  if (!text) return [];
  const raw = String(text).toLowerCase();
  const tokens = new Set();

  // English / numbers / identifiers
  const enMatches = raw.match(/[a-z0-9][a-z0-9_.-]{1,}/g) || [];
  for (const w of enMatches) {
    if (!EN_STOPWORDS.has(w) && w.length >= 2) tokens.add(w);
  }

  // Chinese sequences -> unigrams (if rare/useful) + bigrams + trigrams
  const zhRuns = raw.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of zhRuns) {
    if (run.length === 1) {
      if (!ZH_STOPWORDS.has(run)) tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length; i++) {
      if (i + 2 <= run.length) {
        const bi = run.slice(i, i + 2);
        if (!ZH_STOPWORDS.has(bi)) tokens.add(bi);
      }
      if (i + 3 <= run.length) {
        const tri = run.slice(i, i + 3);
        tokens.add(tri);
      }
    }
    if (run.length <= 6 && !ZH_STOPWORDS.has(run)) {
      tokens.add(run);
    }
  }
  return Array.from(tokens);
}

export function computeFreshness(lastTouchedMs, halfLifeDays = 30, nowMs = Date.now()) {
  const days = Math.max(0, (nowMs - Number(lastTouchedMs || nowMs)) / 86400000);
  const hl = Math.max(1, Number(halfLifeDays) || 30);
  return Math.pow(0.5, days / hl);
}

export function formatRelativeTime(tsMs, nowMs = Date.now()) {
  const d = new Date(Number(tsMs));
  const now = new Date(nowMs);
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const mmdd = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isSameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (isSameDay) return `今天 ${hhmm}`;
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays === 1) return `昨天 ${hhmm}`;
  if (diffDays < 30) return `${diffDays} 天前 (${mmdd})`;
  if (d.getFullYear() === now.getFullYear()) return mmdd;
  if (d.getFullYear() === now.getFullYear() - 1) return `去年 ${mmdd}`;
  return `${d.getFullYear()}-${mmdd}`;
}

export class NekoMemoryStore {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'fact',
        tags TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        importance INTEGER NOT NULL DEFAULT 3,
        emotion TEXT NOT NULL DEFAULT 'neutral',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_recalled_at INTEGER NOT NULL,
        recall_count INTEGER NOT NULL DEFAULT 0,
        half_life_days REAL NOT NULL DEFAULT 30,
        archived INTEGER NOT NULL DEFAULT 0,
        tokens_index TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS recall_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        query TEXT NOT NULL,
        score REAL NOT NULL,
        recalled_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_recall_logs_time ON recall_logs(recalled_at DESC);
    `);
  }

  enrichRow(row, nowMs = Date.now()) {
    const freshness = computeFreshness(row.last_recalled_at || row.updated_at || row.created_at, row.half_life_days, nowMs);
    return {
      ...row,
      freshness: Number(freshness.toFixed(3)),
      freshness_pct: Math.round(freshness * 100),
      time_label: formatRelativeTime(row.created_at, nowMs),
      last_recalled_label: formatRelativeTime(row.last_recalled_at || row.created_at, nowMs)
    };
  }

  remember({ content, category = 'fact', tags = '', workspace = '', importance = undefined, emotion = 'neutral', half_life_days = undefined }) {
    const clean = String(content || '').trim();
    if (!clean) throw new Error('Memory content cannot be empty');

    const now = Date.now();
    const imp = Math.max(1, Math.min(5, Math.round(Number(importance) || (category === 'preference' ? 5 : 3))));
    const hl = resolveHalfLife(category, half_life_days);
    const tagStr = Array.isArray(tags) ? tags.join(',') : String(tags || '').trim();
    const tokList = tokenize(`${clean} ${tagStr} ${category} ${workspace}`);
    const tokIndex = tokList.join(' ');

    // Near-duplicate check against active memories
    const active = this.db.prepare('SELECT * FROM memories WHERE archived = 0').all();
    const newTokSet = new Set(tokList);
    for (const m of active) {
      if (m.content.trim() === clean) {
        this.db.prepare(`
          UPDATE memories
          SET category = ?, tags = ?, workspace = ?, importance = ?, emotion = ?,
              updated_at = ?, last_recalled_at = ?, half_life_days = ?, tokens_index = ?
          WHERE id = ?
        `).run(category, tagStr || m.tags, workspace || m.workspace, Math.max(imp, m.importance), emotion, now, now, hl, tokIndex, m.id);
        return { action: 'updated', memory: this.getById(m.id) };
      }
      if (newTokSet.size >= 4 && m.tokens_index) {
        const oldToks = m.tokens_index.split(' ').filter(Boolean);
        let overlap = 0;
        for (const t of oldToks) if (newTokSet.has(t)) overlap++;
        const jaccard = overlap / (newTokSet.size + oldToks.length - overlap || 1);
        if (jaccard >= 0.82) {
          this.db.prepare(`
            UPDATE memories
            SET content = ?, category = ?, tags = ?, workspace = ?, importance = ?, emotion = ?,
                updated_at = ?, last_recalled_at = ?, half_life_days = ?, tokens_index = ?
            WHERE id = ?
          `).run(clean, category, tagStr || m.tags, workspace || m.workspace, Math.max(imp, m.importance), emotion, now, now, hl, tokIndex, m.id);
          return { action: 'merged', memory: this.getById(m.id) };
        }
      }
    }

    const res = this.db.prepare(`
      INSERT INTO memories (content, category, tags, workspace, importance, emotion, created_at, updated_at, last_recalled_at, recall_count, half_life_days, archived, tokens_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)
    `).run(clean, category, tagStr, workspace, imp, emotion, now, now, now, hl, tokIndex);

    return { action: 'created', memory: this.getById(Number(res.lastInsertRowid)) };
  }

  getById(id) {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(Number(id));
    return row ? this.enrichRow(row) : null;
  }

  update(id, fields) {
    const existing = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(Number(id));
    if (!existing) return null;
    const now = Date.now();
    const content = fields.content !== undefined ? String(fields.content).trim() : existing.content;
    const category = fields.category !== undefined ? String(fields.category) : existing.category;
    const tags = fields.tags !== undefined ? String(fields.tags) : existing.tags;
    const workspace = fields.workspace !== undefined ? String(fields.workspace) : existing.workspace;
    const importance = fields.importance !== undefined ? Math.max(1, Math.min(5, Number(fields.importance))) : existing.importance;
    const half_life_days = fields.half_life_days !== undefined ? Math.max(1, Number(fields.half_life_days)) : existing.half_life_days;
    const archived = fields.archived !== undefined ? (fields.archived ? 1 : 0) : existing.archived;
    const tokIndex = tokenize(`${content} ${tags} ${category} ${workspace}`).join(' ');

    this.db.prepare(`
      UPDATE memories
      SET content = ?, category = ?, tags = ?, workspace = ?, importance = ?, half_life_days = ?,
          archived = ?, updated_at = ?, tokens_index = ?
      WHERE id = ?
    `).run(content, category, tags, workspace, importance, half_life_days, archived, now, tokIndex, Number(id));
    return this.getById(id);
  }

  archive(id, archived = true) {
    this.db.prepare('UPDATE memories SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, Date.now(), Number(id));
    return this.getById(id);
  }

  deleteHard(id) {
    this.db.prepare('DELETE FROM recall_logs WHERE memory_id = ?').run(Number(id));
    const res = this.db.prepare('DELETE FROM memories WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  recall({ query, workspace = '', category = '', limit = 5, min_score = 0.08, record_recall = true }) {
    const q = String(query || '').trim();
    if (!q) return [];
    const qTokens = tokenize(q);
    if (qTokens.length === 0) return [];

    let sql = 'SELECT * FROM memories WHERE archived = 0';
    const params = [];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    const candidates = this.db.prepare(sql).all(...params);
    if (candidates.length === 0) return [];

    // Compute IDF across active memories so rare/specific terms carry higher evidence weight
    const df = new Map();
    const docTokensList = candidates.map((m) => {
      const set = new Set((m.tokens_index || '').split(' ').filter(Boolean));
      for (const t of set) df.set(t, (df.get(t) || 0) + 1);
      return set;
    });
    const N = candidates.length;
    const now = Date.now();
    const qLower = q.toLowerCase();

    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const m = candidates[i];
      const dSet = docTokensList[i];
      let matchedWeight = 0;
      let totalWeight = 0;
      const matchedTerms = [];

      for (const qt of qTokens) {
        const idf = Math.log(1 + N / (1 + (df.get(qt) || 0))) + 0.5;
        totalWeight += idf;
        if (dSet.has(qt)) {
          matchedWeight += idf;
          matchedTerms.push(qt);
        }
      }

      // Direct substring boost for exact short phrases
      let exactBoost = 0;
      if (qLower.length >= 2 && m.content.toLowerCase().includes(qLower)) {
        exactBoost = 0.35;
      }

      const evidence = (totalWeight > 0 ? matchedWeight / totalWeight : 0) + exactBoost;
      if (evidence <= 0) continue;

      const freshness = computeFreshness(m.last_recalled_at || m.updated_at || m.created_at, m.half_life_days, now);
      const impNorm = (Number(m.importance) || 3) / 5;
      const wsBoost = workspace && m.workspace && m.workspace.toLowerCase() === workspace.toLowerCase() ? 1.15 : 1.0;

      // Evidence-first ranking modulated by freshness (half-life decay) & importance
      const score = evidence * (0.45 + 0.35 * freshness + 0.20 * impNorm) * wsBoost;
      if (score >= min_score) {
        scored.push({
          ...this.enrichRow(m, now),
          score: Number(score.toFixed(4)),
          evidence: Number(evidence.toFixed(3)),
          matched_terms: matchedTerms.slice(0, 6)
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));

    if (record_recall && top.length > 0) {
      const upd = this.db.prepare('UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?');
      const ins = this.db.prepare('INSERT INTO recall_logs (memory_id, query, score, recalled_at) VALUES (?, ?, ?, ?)');
      for (const item of top) {
        upd.run(now, item.id);
        ins.run(item.id, q.slice(0, 200), item.score, now);
      }
    }

    return top;
  }

  list({ include_archived = false, status = '', category = '', workspace = '', search = '', sort = 'recent', limit = 100 } = {}) {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params = [];
    if (status === 'archived') {
      sql += ' AND archived = 1';
    } else if (status === 'active' || (!status && !include_archived)) {
      sql += ' AND archived = 0';
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (workspace) {
      sql += ' AND workspace LIKE ?';
      params.push(`%${workspace}%`);
    }
    if (search) {
      const cleanSearch = String(search).trim();
      const idMatch = cleanSearch.match(/^#?(\d+)$/);
      const pat = `%${cleanSearch}%`;
      if (idMatch) {
        sql += ' AND (id = ? OR content LIKE ? OR tags LIKE ? OR workspace LIKE ?)';
        params.push(Number(idMatch[1]), pat, pat, pat);
      } else {
        sql += ' AND (content LIKE ? OR tags LIKE ? OR workspace LIKE ?)';
        params.push(pat, pat, pat);
      }
    }

    const orderMap = {
      newest: 'ORDER BY created_at DESC, id DESC',
      oldest: 'ORDER BY created_at ASC, id ASC',
      importance: 'ORDER BY importance DESC, last_recalled_at DESC, id DESC',
      recalls: 'ORDER BY recall_count DESC, last_recalled_at DESC, id DESC',
      recent: 'ORDER BY archived ASC, last_recalled_at DESC, id DESC'
    };
    sql += ` ${orderMap[sort] || orderMap.recent} LIMIT ?`;
    params.push(Math.max(1, Math.min(1000, Number(limit) || 100)));
    const rows = this.db.prepare(sql).all(...params);
    const now = Date.now();
    const enriched = rows.map((r) => this.enrichRow(r, now));
    if (sort === 'freshness') {
      enriched.sort((a, b) => b.freshness - a.freshness || b.importance - a.importance);
    }
    return enriched;
  }

  getRecallLogs(limit = 30) {
    const rows = this.db.prepare(`
      SELECT l.id, l.memory_id, l.query, l.score, l.recalled_at, m.content, m.category
      FROM recall_logs l
      LEFT JOIN memories m ON m.id = l.memory_id
      ORDER BY l.recalled_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, Number(limit) || 30)));
    const now = Date.now();
    return rows.map((r) => ({ ...r, time_label: formatRelativeTime(r.recalled_at, now) }));
  }

  getStats() {
    const active = this.db.prepare('SELECT COUNT(*) as c FROM memories WHERE archived = 0').get().c;
    const archived = this.db.prepare('SELECT COUNT(*) as c FROM memories WHERE archived = 1').get().c;
    const totalRecalls = this.db.prepare('SELECT COALESCE(SUM(recall_count), 0) as c FROM memories').get().c;
    const byCategory = this.db.prepare('SELECT category, COUNT(*) as count FROM memories WHERE archived = 0 GROUP BY category').all();
    return {
      db_path: this.dbPath,
      active_count: active,
      archived_count: archived,
      total_recalls: totalRecalls,
      by_category: byCategory
    };
  }

  getGraph({ include_archived = false, category = '' } = {}) {
    const items = this.list({ include_archived, category, limit: 250 });
    const nodes = items.map((m) => {
      const short = m.content.replace(/\s+/g, ' ').trim();
      return {
        id: m.id,
        label: short.length > 18 ? short.slice(0, 18) + '…' : short,
        content: m.content,
        category: m.category,
        tags: m.tags,
        workspace: m.workspace,
        importance: m.importance,
        freshness: m.freshness,
        freshness_pct: m.freshness_pct,
        recall_count: m.recall_count,
        half_life_days: m.half_life_days,
        time_label: m.time_label,
        last_recalled_label: m.last_recalled_label,
        archived: Boolean(m.archived)
      };
    });

    const tokenSets = items.map((m) => new Set((m.tokens_index || '').split(' ').filter((t) => t.length >= 2)));
    const tagSets = items.map((m) => new Set((m.tags || '').split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));

    const edges = [];
    const connectedIds = new Set();

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        let weight = 0;
        const reasons = [];

        // Shared tags
        const sharedTags = [];
        for (const t of tagSets[i]) if (tagSets[j].has(t)) sharedTags.push(t);
        if (sharedTags.length > 0) {
          weight += Math.min(0.9, sharedTags.length * 0.45);
          reasons.push(`标签: ${sharedTags.slice(0, 3).join('/')}`);
        }

        // Shared workspace
        if (a.workspace && b.workspace && a.workspace.toLowerCase() === b.workspace.toLowerCase()) {
          weight += 0.35;
          reasons.push(`工作区: ${a.workspace}`);
        }

        // Shared lexical tokens
        const sharedToks = [];
        for (const t of tokenSets[i]) {
          if (tokenSets[j].has(t)) sharedToks.push(t);
        }
        const unionSize = tokenSets[i].size + tokenSets[j].size - sharedToks.length;
        const jaccard = unionSize > 0 ? sharedToks.length / unionSize : 0;
        if (sharedToks.length >= 2 && jaccard >= 0.08) {
          weight += Math.min(0.85, jaccard * 2.2);
          reasons.push(`关联词: ${sharedToks.slice(0, 3).join('·')}`);
        }

        if (weight >= 0.22) {
          edges.push({
            source: a.id,
            target: b.id,
            weight: Number(Math.min(1, weight).toFixed(3)),
            reason: reasons.join(' | ')
          });
          connectedIds.add(a.id);
          connectedIds.add(b.id);
        }
      }
    }

    // Gentle constellation link for same-category nodes that have no strong edge yet
    const byCat = new Map();
    for (const m of items) {
      if (!byCat.has(m.category)) byCat.set(m.category, []);
      byCat.get(m.category).push(m.id);
    }
    for (const [cat, ids] of byCat.entries()) {
      if (ids.length < 2) continue;
      for (let k = 0; k < ids.length - 1; k++) {
        const u = ids[k];
        const v = ids[k + 1];
        if (!connectedIds.has(u) || !connectedIds.has(v)) {
          edges.push({ source: u, target: v, weight: 0.18, reason: `同星座: ${cat}` });
          connectedIds.add(u);
          connectedIds.add(v);
        }
      }
    }

    // Compute degree & hub status + top keywords for rich galaxy rendering
    const degreeMap = new Map();
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    }

    // Build semantic topic hubs from tags & workspaces
    const topicMap = new Map();
    items.forEach((m, idx) => {
      const tags = Array.from(tagSets[idx]);
      for (const t of tags) {
        if (!topicMap.has(t)) topicMap.set(t, new Set());
        topicMap.get(t).add(m.id);
      }
      if (m.workspace) {
        const wsKey = m.workspace.trim();
        if (wsKey) {
          if (!topicMap.has(wsKey)) topicMap.set(wsKey, new Set());
          topicMap.get(wsKey).add(m.id);
        }
      }
    });

    const topics = [];
    const topic_edges = [];
    for (const [label, memIds] of topicMap.entries()) {
      if (memIds.size >= 2 || items.length <= 15) {
        const tid = `topic:${label}`;
        topics.push({
          id: tid,
          label,
          kind: 'topic',
          count: memIds.size
        });
        for (const mid of memIds) {
          topic_edges.push({ source: tid, target: mid, weight: 0.32, reason: `主题: ${label}` });
        }
      }
    }
    topics.sort((a, b) => b.count - a.count);
    const topTopics = topics.slice(0, 28);
    const topTopicIds = new Set(topTopics.map((t) => t.id));
    const filteredTopicEdges = topic_edges.filter((e) => topTopicIds.has(e.source));

    const maxDeg = Math.max(1, ...Array.from(degreeMap.values()));
    nodes.forEach((n, idx) => {
      const deg = degreeMap.get(n.id) || 0;
      n.degree = deg;
      n.is_hub = n.category === 'preference' || n.importance >= 5 || (deg >= Math.max(3, Math.ceil(maxDeg * 0.7)));
      n.keywords = Array.from(tokenSets[idx]).slice(0, 6);
    });

    return { nodes, edges, topics: topTopics, topic_edges: filteredTopicEdges, stats: this.getStats() };
  }

  exportMemories({ format = 'json', include_archived = true } = {}) {
    const fmt = String(format || 'json').trim().toLowerCase();
    const sql = include_archived
      ? 'SELECT * FROM memories ORDER BY id ASC'
      : 'SELECT * FROM memories WHERE archived = 0 ORDER BY id ASC';
    const rows = this.db.prepare(sql).all();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (fmt === 'csv') {
      const headers = [
        'id', 'content', 'category', 'tags', 'workspace',
        'importance', 'emotion', 'half_life_days', 'archived',
        'recall_count', 'created_at', 'updated_at', 'last_recalled_at'
      ];
      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push([
          r.id,
          r.content,
          r.category,
          r.tags,
          r.workspace,
          r.importance,
          r.emotion,
          r.half_life_days,
          r.archived ? 'true' : 'false',
          r.recall_count,
          r.created_at,
          r.updated_at,
          r.last_recalled_at
        ].map(csvEscape).join(','));
      }
      return {
        format: 'csv',
        filename: `neko-memory-export-${stamp}.csv`,
        mime: 'text/csv; charset=utf-8',
        count: rows.length,
        content: '\uFEFF' + lines.join('\r\n') + '\r\n'
      };
    }

    if (fmt === 'md' || fmt === 'markdown') {
      const catNames = {
        preference: '偏好 (preference)',
        project: '项目 (project)',
        decision: '决策 (decision)',
        pitfall: '踩坑 (pitfall)',
        fact: '事实 (fact)',
        handoff: '交接 (handoff)'
      };
      const grouped = new Map();
      for (const r of rows) {
        const c = normalizeCategory(r.category);
        if (!grouped.has(c)) grouped.set(c, []);
        grouped.get(c).push(r);
      }
      const lines = [
        '# 猫猫的记忆 · Neko Memory 导出备份',
        '',
        `- 导出时间：${new Date().toISOString()}`,
        `- 记忆总数：${rows.length}`,
        ''
      ];
      for (const [cat, list] of grouped.entries()) {
        lines.push(`## ${catNames[cat] || cat}`);
        lines.push('');
        for (const r of list) {
          const meta = [];
          if (r.tags) meta.push(`标签: ${r.tags}`);
          if (r.workspace) meta.push(`工作区: ${r.workspace}`);
          meta.push(`重要度: ${r.importance}/5`);
          meta.push(`半衰期: ${r.half_life_days}天`);
          if (r.archived) meta.push('已归档');
          lines.push(`- ${r.content.replace(/\r?\n/g, ' ')}  <!-- ${meta.join(' | ')} -->`);
        }
        lines.push('');
      }
      return {
        format: 'markdown',
        filename: `neko-memory-export-${stamp}.md`,
        mime: 'text/markdown; charset=utf-8',
        count: rows.length,
        content: lines.join('\n')
      };
    }

    // Default: JSON
    const payload = {
      schema: 'neko-memory-export',
      version: '1.1.0',
      exported_at: new Date().toISOString(),
      count: rows.length,
      memories: rows.map((r) => ({
        id: r.id,
        content: r.content,
        category: r.category,
        tags: r.tags,
        workspace: r.workspace,
        importance: r.importance,
        emotion: r.emotion,
        half_life_days: r.half_life_days,
        archived: Boolean(r.archived),
        recall_count: r.recall_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_recalled_at: r.last_recalled_at
      }))
    };
    return {
      format: 'json',
      filename: `neko-memory-export-${stamp}.json`,
      mime: 'application/json; charset=utf-8',
      count: rows.length,
      content: JSON.stringify(payload, null, 2)
    };
  }

  detectImportFormat(content, filename = '', explicitFormat = '') {
    const exp = String(explicitFormat || '').trim().toLowerCase();
    if (exp === 'json' || exp === 'csv' || exp === 'md' || exp === 'markdown' || exp === 'txt') {
      return exp === 'md' || exp === 'txt' ? 'markdown' : exp;
    }
    const ext = path.extname(String(filename || '')).toLowerCase();
    if (ext === '.json') return 'json';
    if (ext === '.csv') return 'csv';
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') return 'markdown';
    const trimmed = String(content || '').replace(/^\uFEFF/, '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    const firstLine = trimmed.split(/\r?\n/)[0] || '';
    if (firstLine.includes(',') && /(content|内容|category|类型)/i.test(firstLine)) return 'csv';
    return 'markdown';
  }

  parseImportPayload({ content, format = '', filename = '', defaultCategory = 'fact', defaultWorkspace = '' }) {
    const raw = String(content || '').replace(/^\uFEFF/, '');
    if (!raw.trim()) throw new Error('导入文件内容为空');
    const detected = this.detectImportFormat(raw, filename, format);
    const items = [];
    const warnings = [];
    let invalidCount = 0;

    const pushNormalized = (obj, rowIndex) => {
      const text = String(obj.content ?? obj.text ?? obj.summary ?? obj.memory ?? obj['内容'] ?? '').trim();
      if (!text) {
        invalidCount++;
        return;
      }
      const cat = normalizeCategory(obj.category ?? obj.type ?? obj['分类'] ?? obj['类型'] ?? defaultCategory);
      const rawTags = obj.tags ?? obj['标签'] ?? '';
      const tags = Array.isArray(rawTags) ? rawTags.map((s) => String(s).trim()).filter(Boolean).join(',') : String(rawTags).trim();
      const workspace = String(obj.workspace ?? obj['工作区'] ?? defaultWorkspace ?? '').trim();
      const impRaw = obj.importance ?? obj['重要度'];
      const importance = impRaw !== undefined && impRaw !== '' && !Number.isNaN(Number(impRaw))
        ? Math.max(1, Math.min(5, Math.round(Number(impRaw))))
        : (cat === 'preference' ? 5 : 3);
      const hlRaw = obj.half_life_days ?? obj.halfLifeDays ?? obj['半衰期'];
      const half_life_days = resolveHalfLife(cat, hlRaw);
      const archivedRaw = obj.archived ?? obj['已归档'];
      const archived = archivedRaw === true || archivedRaw === 1 || String(archivedRaw).toLowerCase() === 'true' || String(archivedRaw) === '1';
      const emotion = String(obj.emotion || 'neutral').trim() || 'neutral';
      const created_at = Number(obj.created_at) > 0 ? Number(obj.created_at) : undefined;
      const updated_at = Number(obj.updated_at) > 0 ? Number(obj.updated_at) : undefined;
      const last_recalled_at = Number(obj.last_recalled_at) > 0 ? Number(obj.last_recalled_at) : undefined;
      const recall_count = Number(obj.recall_count) >= 0 ? Math.floor(Number(obj.recall_count)) : 0;

      items.push({
        row_index: rowIndex,
        content: text,
        category: cat,
        tags,
        workspace,
        importance,
        emotion,
        half_life_days,
        archived,
        recall_count,
        created_at,
        updated_at,
        last_recalled_at
      });
    };

    if (detected === 'json') {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(`JSON 解析失败: ${e.message}`);
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.memories) ? parsed.memories : (Array.isArray(parsed?.items) ? parsed.items : null));
      if (!arr) throw new Error('JSON 格式不支持：需要记忆数组或包含 memories 字段的对象');
      arr.forEach((entry, idx) => {
        if (typeof entry === 'string') {
          pushNormalized({ content: entry }, idx + 1);
        } else if (entry && typeof entry === 'object') {
          pushNormalized(entry, idx + 1);
        } else {
          invalidCount++;
        }
      });
    } else if (detected === 'csv') {
      const rows = parseCsv(raw);
      if (rows.length < 2) throw new Error('CSV 文件至少需要表头行和一行数据');
      const headers = rows[0].map((h) => String(h).trim().toLowerCase());
      const hasContentCol = headers.some((h) => ['content', 'text', 'summary', 'memory', '内容'].includes(h));
      if (!hasContentCol) {
        warnings.push('未检测到标准 content 列名，已默认使用第一列作为记忆内容');
      }
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const obj = {};
        headers.forEach((h, colIdx) => {
          obj[h] = r[colIdx] !== undefined ? r[colIdx] : '';
        });
        if (!hasContentCol) obj.content = r[0] || '';
        pushNormalized(obj, i);
      }
    } else {
      // Markdown / Plain text
      const lines = raw.split(/\r?\n/);
      let currentHeading = '';
      let currentCat = normalizeCategory(defaultCategory);
      const baseTag = filename ? path.basename(filename) : '';
      let idx = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^#{1,4}\s+/.test(trimmed)) {
          currentHeading = trimmed.replace(/^#{1,4}\s+/, '').trim();
          const catMatch = currentHeading.match(/\((preference|project|decision|pitfall|fact|handoff)\)/i);
          if (catMatch) currentCat = normalizeCategory(catMatch[1]);
          continue;
        }
        // Skip header metadata bullets from our own markdown export
        if (/^-\s*(导出时间|记忆总数)：/.test(trimmed)) continue;
        const bullet = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
        if (bullet.length < 4 || bullet.startsWith('```') || bullet.startsWith('|---')) continue;

        let cleanText = bullet;
        let tags = baseTag;
        let workspace = defaultWorkspace;
        let importance;
        let half_life_days;
        let archived = false;

        // Parse optional trailing metadata comment produced by Neko Memory Markdown export
        const commentMatch = bullet.match(/\s*<!--\s*(.+?)\s*-->$/);
        if (commentMatch) {
          cleanText = bullet.slice(0, commentMatch.index).trim();
          const parts = commentMatch[1].split('|').map((s) => s.trim());
          for (const p of parts) {
            if (p.startsWith('标签:')) tags = p.slice(3).trim();
            else if (p.startsWith('工作区:')) workspace = p.slice(4).trim();
            else if (p.startsWith('重要度:')) importance = Number(p.slice(4).split('/')[0]);
            else if (p.startsWith('半衰期:')) half_life_days = Number(p.slice(4).replace(/天.*/, ''));
            else if (p === '已归档') archived = true;
          }
        } else if (currentHeading && !/\((preference|project|decision|pitfall|fact|handoff)\)/i.test(currentHeading)) {
          cleanText = `[${currentHeading}] ${cleanText}`;
        }

        idx++;
        pushNormalized({
          content: cleanText.slice(0, 1200),
          category: currentCat,
          tags,
          workspace,
          importance,
          half_life_days,
          archived
        }, idx);
      }
    }

    return { format: detected, items, invalid_count: invalidCount, warnings };
  }

  _findDuplicateCandidate(item, existingRecords) {
    const clean = item.content.trim();
    const tokSet = new Set(tokenize(`${clean} ${item.tags} ${item.category} ${item.workspace}`));
    for (const m of existingRecords) {
      if (m.content.trim() === clean) {
        return { match_type: 'exact', memory: m };
      }
      if (tokSet.size >= 4 && m._tokArr.length >= 4) {
        let overlap = 0;
        for (const t of m._tokArr) if (tokSet.has(t)) overlap++;
        const jaccard = overlap / (tokSet.size + m._tokArr.length - overlap || 1);
        if (jaccard >= 0.85) {
          return { match_type: 'similar', memory: m };
        }
      }
    }
    return null;
  }

  previewImport({ content, format = '', filename = '', duplicate_strategy = 'skip', defaultCategory = 'fact', defaultWorkspace = '' }) {
    const strategy = ['skip', 'overwrite', 'allow_all'].includes(duplicate_strategy) ? duplicate_strategy : 'skip';
    const parsed = this.parseImportPayload({ content, format, filename, defaultCategory, defaultWorkspace });
    const existingRows = this.db.prepare('SELECT id, content, category, tags, workspace, tokens_index, archived FROM memories').all();
    const existingRecords = existingRows.map((r) => ({
      ...r,
      _tokArr: (r.tokens_index || '').split(' ').filter(Boolean)
    }));

    const seenInBatch = new Set();
    let newCount = 0;
    let duplicateCount = 0;
    let createPlanned = 0;
    let overwritePlanned = 0;
    let skipPlanned = 0;

    const previewItems = parsed.items.map((item) => {
      const key = item.content.trim();
      const dupDb = this._findDuplicateCandidate(item, existingRecords);
      const dupInBatch = !dupDb && seenInBatch.has(key);
      seenInBatch.add(key);

      const isDuplicate = Boolean(dupDb || dupInBatch);
      if (isDuplicate) duplicateCount++;
      else newCount++;

      let planned_action = 'create';
      if (isDuplicate) {
        if (strategy === 'skip') planned_action = 'skip';
        else if (strategy === 'overwrite') planned_action = dupDb ? 'overwrite' : 'skip';
        else planned_action = 'create';
      }

      if (planned_action === 'create') createPlanned++;
      else if (planned_action === 'overwrite') overwritePlanned++;
      else skipPlanned++;

      return {
        row_index: item.row_index,
        content: item.content,
        category: item.category,
        tags: item.tags,
        workspace: item.workspace,
        importance: item.importance,
        half_life_days: item.half_life_days,
        archived: item.archived,
        is_duplicate: isDuplicate,
        match_type: dupDb ? dupDb.match_type : (dupInBatch ? 'batch_duplicate' : null),
        matched_id: dupDb ? dupDb.memory.id : null,
        planned_action
      };
    });

    return {
      ok: true,
      format: parsed.format,
      filename: filename || '',
      duplicate_strategy: strategy,
      total: parsed.items.length,
      invalid_count: parsed.invalid_count,
      new_count: newCount,
      duplicate_count: duplicateCount,
      planned: {
        create: createPlanned,
        overwrite: overwritePlanned,
        skip: skipPlanned
      },
      warnings: parsed.warnings,
      items: previewItems
    };
  }

  importMemories({ content, format = '', filename = '', duplicate_strategy = 'skip', defaultCategory = 'fact', defaultWorkspace = '' }) {
    const strategy = ['skip', 'overwrite', 'allow_all'].includes(duplicate_strategy) ? duplicate_strategy : 'skip';
    const parsed = this.parseImportPayload({ content, format, filename, defaultCategory, defaultWorkspace });
    const existingRows = this.db.prepare('SELECT id, content, category, tags, workspace, tokens_index, archived FROM memories').all();
    const existingRecords = existingRows.map((r) => ({
      ...r,
      _tokArr: (r.tokens_index || '').split(' ').filter(Boolean)
    }));

    const now = Date.now();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const insertStmt = this.db.prepare(`
      INSERT INTO memories (content, category, tags, workspace, importance, emotion, created_at, updated_at, last_recalled_at, recall_count, half_life_days, archived, tokens_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = this.db.prepare(`
      UPDATE memories
      SET content = ?, category = ?, tags = ?, workspace = ?, importance = ?, emotion = ?,
          updated_at = ?, last_recalled_at = ?, half_life_days = ?, archived = ?, tokens_index = ?
      WHERE id = ?
    `);

    const seenInBatch = new Set();
    this.db.exec('BEGIN');
    try {
      for (const item of parsed.items) {
        const key = item.content.trim();
        const tokList = tokenize(`${item.content} ${item.tags} ${item.category} ${item.workspace}`);
        const tokIndex = tokList.join(' ');
        const dupDb = strategy === 'allow_all' ? null : this._findDuplicateCandidate(item, existingRecords);
        const dupInBatch = strategy !== 'allow_all' && !dupDb && seenInBatch.has(key);
        seenInBatch.add(key);

        if (dupDb || dupInBatch) {
          if (strategy === 'skip' || dupInBatch) {
            skipped++;
            continue;
          }
          if (strategy === 'overwrite' && dupDb) {
            updateStmt.run(
              item.content,
              item.category,
              item.tags,
              item.workspace,
              item.importance,
              item.emotion,
              now,
              item.last_recalled_at || now,
              item.half_life_days,
              item.archived ? 1 : 0,
              tokIndex,
              dupDb.memory.id
            );
            dupDb.memory.content = item.content;
            dupDb.memory._tokArr = tokList;
            updated++;
            continue;
          }
        }

        const cAt = item.created_at || now;
        const uAt = item.updated_at || cAt;
        const rAt = item.last_recalled_at || uAt;
        const res = insertStmt.run(
          item.content,
          item.category,
          item.tags,
          item.workspace,
          item.importance,
          item.emotion,
          cAt,
          uAt,
          rAt,
          item.recall_count || 0,
          item.half_life_days,
          item.archived ? 1 : 0,
          tokIndex
        );
        existingRecords.push({
          id: Number(res.lastInsertRowid),
          content: item.content,
          category: item.category,
          tags: item.tags,
          workspace: item.workspace,
          _tokArr: tokList
        });
        created++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return {
      ok: true,
      format: parsed.format,
      duplicate_strategy: strategy,
      total: parsed.items.length,
      created,
      updated,
      skipped,
      invalid_count: parsed.invalid_count,
      warnings: parsed.warnings
    };
  }

  importMarkdown(filePath, { category = 'fact', workspace = '', importance = 3, duplicate_strategy = 'skip' } = {}) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const res = this.importMemories({
      content: raw,
      filename: path.basename(filePath),
      duplicate_strategy,
      defaultCategory: category,
      defaultWorkspace: workspace
    });
    return {
      imported: res.created + res.updated,
      created: res.created,
      updated: res.updated,
      skipped: res.skipped,
      format: res.format,
      file: filePath
    };
  }
}
