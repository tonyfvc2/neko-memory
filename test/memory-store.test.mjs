import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NekoMemoryStore, computeFreshness, tokenize, resolveHalfLife } from '../lib/memory-store.mjs';

function makeTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-memory-test-'));
  const dbPath = path.join(dir, 'memory.db');
  return { store: new NekoMemoryStore(dbPath), dir };
}

test('category default half-lives', () => {
  assert.equal(resolveHalfLife('preference'), 365);
  assert.equal(resolveHalfLife('decision'), 90);
  assert.equal(resolveHalfLife('pitfall'), 90);
  assert.equal(resolveHalfLife('project'), 60);
  assert.equal(resolveHalfLife('fact'), 30);
  assert.equal(resolveHalfLife('handoff'), 14);
  assert.equal(resolveHalfLife('preference', 180), 180);
});

test('freshness decay math', () => {
  const now = 1_700_000_000_000;
  assert.equal(computeFreshness(now, 30, now), 1);
  assert.ok(Math.abs(computeFreshness(now - 30 * 86400000, 30, now) - 0.5) < 1e-6);
  assert.ok(Math.abs(computeFreshness(now - 365 * 86400000, 365, now) - 0.5) < 1e-6);
});

test('Chinese and English tokenization', () => {
  const toks = tokenize('Antigravity 长期记忆星图配置');
  assert.ok(toks.includes('antigravity'));
  assert.ok(toks.includes('长期'));
  assert.ok(toks.includes('记忆'));
  assert.ok(toks.includes('星图'));
});

test('remember, deduplicate, recall, archive, and star map graph', () => {
  const { store, dir } = makeTempStore();
  try {
    const r1 = store.remember({ content: '用户喜欢用中文交流并称呼助手为猫猫', category: 'preference', tags: '偏好,称呼' });
    assert.equal(r1.action, 'created');
    assert.equal(r1.memory.half_life_days, 365);
    assert.equal(r1.memory.importance, 5);

    // Exact duplicate updates instead of creating a second row
    const r1Dup = store.remember({ content: '用户喜欢用中文交流并称呼助手为猫猫', category: 'preference', tags: '偏好,称呼' });
    assert.equal(r1Dup.action, 'updated');
    assert.equal(r1Dup.memory.id, r1.memory.id);

    const r2 = store.remember({ content: '前端项目使用 Vite 和 TypeScript，代码放在 src 目录', category: 'project', tags: '前端,配置' });
    const r3 = store.remember({ content: '踩坑记录：Windows 下前端构建需要配置 UTF-8 编码', category: 'pitfall', tags: '前端,Windows' });
    assert.equal(r2.memory.half_life_days, 60);
    assert.equal(r3.memory.half_life_days, 90);

    // Recall by Chinese query
    const hits = store.recall({ query: '用户喜欢什么称呼？' });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].id, r1.memory.id);

    // Star map graph links r2 and r3 via shared tag "前端"
    const graph = store.getGraph();
    assert.equal(graph.nodes.length, 3);
    assert.ok(graph.edges.some((e) => (e.source === r2.memory.id && e.target === r3.memory.id) || (e.source === r3.memory.id && e.target === r2.memory.id)));
    assert.ok(Array.isArray(graph.topics) && graph.topics.some((t) => t.label === '前端'));
    assert.equal(graph.nodes.find((n) => n.id === r1.memory.id).is_hub, true);

    // Archive hides from active recall
    store.archive(r1.memory.id, true);
    const hitsAfter = store.recall({ query: '用户喜欢什么称呼？' });
    assert.ok(!hitsAfter.some((h) => h.id === r1.memory.id));
  } finally {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('export and import round-trip for JSON, CSV, and Markdown with duplicate strategies', () => {
  const src = makeTempStore();
  const dst = makeTempStore();
  try {
    src.store.remember({
      content: '用户喜欢把项目放在 F:\\Gemini工作区，含逗号,与"引号"测试',
      category: 'preference',
      tags: '偏好,路径',
      workspace: 'neko-memory'
    });
    const m2 = src.store.remember({
      content: '星图升级 v1.1 支持导出 JSON 和 CSV 备份',
      category: 'project',
      tags: '星图,导入导出',
      workspace: 'neko-memory'
    });
    src.store.archive(m2.memory.id, true);

    // 1. JSON export includes archived by default
    const jsonExp = src.store.exportMemories({ format: 'json', include_archived: true });
    assert.equal(jsonExp.count, 2);
    assert.equal(jsonExp.format, 'json');

    // Preview on empty destination
    const pre1 = dst.store.previewImport({ content: jsonExp.content, filename: jsonExp.filename, duplicate_strategy: 'skip' });
    assert.equal(pre1.total, 2);
    assert.equal(pre1.new_count, 2);
    assert.equal(pre1.duplicate_count, 0);
    assert.equal(pre1.planned.create, 2);

    // Commit JSON import
    const imp1 = dst.store.importMemories({ content: jsonExp.content, filename: jsonExp.filename, duplicate_strategy: 'skip' });
    assert.equal(imp1.created, 2);
    assert.equal(imp1.skipped, 0);

    // Re-import same JSON with 'skip' -> 0 created, 2 skipped
    const impSkip = dst.store.importMemories({ content: jsonExp.content, filename: jsonExp.filename, duplicate_strategy: 'skip' });
    assert.equal(impSkip.created, 0);
    assert.equal(impSkip.skipped, 2);

    // Re-import with 'overwrite' -> 2 updated
    const impOver = dst.store.importMemories({ content: jsonExp.content, filename: jsonExp.filename, duplicate_strategy: 'overwrite' });
    assert.equal(impOver.created, 0);
    assert.equal(impOver.updated, 2);

    // 2. CSV export & parse with quotes/commas and UTF-8 BOM
    const csvExp = src.store.exportMemories({ format: 'csv', include_archived: true });
    assert.ok(csvExp.content.startsWith('\uFEFF'));
    const csvPre = dst.store.previewImport({ content: csvExp.content, filename: csvExp.filename, duplicate_strategy: 'allow_all' });
    assert.equal(csvPre.format, 'csv');
    assert.equal(csvPre.total, 2);
    assert.equal(csvPre.items[0].content, '用户喜欢把项目放在 F:\\Gemini工作区，含逗号,与"引号"测试');
    assert.equal(csvPre.planned.create, 2);

    // 3. Markdown export & parse
    const mdExp = src.store.exportMemories({ format: 'markdown', include_archived: true });
    const mdPre = dst.store.previewImport({ content: mdExp.content, filename: mdExp.filename, duplicate_strategy: 'skip' });
    assert.equal(mdPre.format, 'markdown');
    assert.equal(mdPre.total, 2);
    assert.equal(mdPre.duplicate_count, 2);
  } finally {
    src.store.db.close();
    dst.store.db.close();
    fs.rmSync(src.dir, { recursive: true, force: true });
    fs.rmSync(dst.dir, { recursive: true, force: true });
  }
});
