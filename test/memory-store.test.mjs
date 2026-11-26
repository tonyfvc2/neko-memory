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

    // Archive hides from active recall
    store.archive(r1.memory.id, true);
    const hitsAfter = store.recall({ query: '用户喜欢什么称呼？' });
    assert.ok(!hitsAfter.some((h) => h.id === r1.memory.id));
  } finally {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
