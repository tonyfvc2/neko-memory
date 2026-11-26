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

  list({ include_archived = false, category = '', search = '', limit = 100 } = {}) {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params = [];
    if (!include_archived) {
      sql += ' AND archived = 0';
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (content LIKE ? OR tags LIKE ? OR workspace LIKE ?)';
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }
    sql += ' ORDER BY archived ASC, last_recalled_at DESC, id DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const rows = this.db.prepare(sql).all(...params);
    const now = Date.now();
    return rows.map((r) => this.enrichRow(r, now));
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

    return { nodes, edges, stats: this.getStats() };
  }

  importMarkdown(filePath, { category = 'fact', workspace = '', importance = 3 } = {}) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const items = [];
    let currentHeading = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#{1,4}\s+/.test(trimmed)) {
        currentHeading = trimmed.replace(/^#{1,4}\s+/, '').trim();
        continue;
      }
      const bullet = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      if (bullet.length >= 8 && !bullet.startsWith('```') && !bullet.startsWith('|---')) {
        const text = currentHeading ? `[${currentHeading}] ${bullet}` : bullet;
        items.push(text.slice(0, 500));
      }
    }
    const results = [];
    for (const text of items.slice(0, 50)) {
      results.push(this.remember({ content: text, category, workspace, importance, tags: path.basename(filePath) }));
    }
    return { imported: results.length, file: filePath };
  }
}
