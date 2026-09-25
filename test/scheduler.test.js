'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSchedule } = require('../scheduler');

const cue = (id, overrides = {}) => ({
  id,
  name: `Cue ${id}`,
  duration: 10,
  earliestStart: 0,
  latestFinish: null,
  predecessors: [],
  ...overrides,
});

test('无依赖时使用各自的最早开始时间', () => {
  const { cues, hasCycle } = computeSchedule([
    cue(1, { earliestStart: 60, duration: 15 }),
    cue(2, { earliestStart: 0, duration: 30 }),
  ]);
  assert.equal(hasCycle, false);
  assert.deepEqual(
    cues.map((c) => [c.id, c.start, c.finish]),
    [
      [1, 60, 75],
      [2, 0, 30],
    ]
  );
});

test('依赖链：开始时间取 max(最早开始, 所有前置完成时间)', () => {
  const { cues } = computeSchedule([
    cue(1, { earliestStart: 60, duration: 10 }), // 60-70
    cue(2, { earliestStart: 0, duration: 100 }), // 0-100
    cue(3, { earliestStart: 80, duration: 5, predecessors: [1, 2] }), // max(80,70,100)=100
  ]);
  const c3 = cues.find((c) => c.id === 3);
  assert.equal(c3.start, 100);
  assert.equal(c3.finish, 105);
});

test('修改任一前置后，后继时间随之重新计算', () => {
  const base = [
    cue(1, { earliestStart: 0, duration: 10 }),
    cue(2, { earliestStart: 0, duration: 5, predecessors: [1] }),
  ];
  const before = computeSchedule(base).cues.find((c) => c.id === 2);
  assert.equal(before.start, 10);

  const after = computeSchedule([
    { ...base[0], duration: 40 },
    base[1],
  ]).cues.find((c) => c.id === 2);
  assert.equal(after.start, 40);
  assert.equal(after.finish, 45);
});

test('检出简单环依赖并指出涉及的提示点', () => {
  const { hasCycle, cycles, cues } = computeSchedule([
    cue(1, { predecessors: [3] }),
    cue(2, { predecessors: [1] }),
    cue(3, { predecessors: [2] }),
    cue(4), // 环外正常项
  ]);
  assert.equal(hasCycle, true);
  assert.equal(cycles.length, 1);
  const inPath = new Set(cycles[0]);
  assert.ok(inPath.has(1) && inPath.has(2) && inPath.has(3));
  assert.ok(!inPath.has(4));
  for (const id of [1, 2, 3]) {
    assert.equal(cues.find((c) => c.id === id).status, 'cycle');
  }
  assert.equal(cues.find((c) => c.id === 4).status, 'ok');
});

test('环的下游提示点标记为 blocked，环外分支不受影响', () => {
  const { cues } = computeSchedule([
    cue(1, { predecessors: [2] }),
    cue(2, { predecessors: [1] }),
    cue(3, { predecessors: [2] }), // 环的下游
    cue(4, { earliestStart: 30, duration: 10 }),
    cue(5, { predecessors: [4] }), // 正常链
  ]);
  assert.equal(cues.find((c) => c.id === 3).status, 'blocked');
  assert.equal(cues.find((c) => c.id === 3).start, null);
  assert.equal(cues.find((c) => c.id === 5).start, 40);
});

test('自环也被检出', () => {
  const { hasCycle, cues } = computeSchedule([cue(1, { predecessors: [1] })]);
  assert.equal(hasCycle, true);
  assert.equal(cues[0].status, 'cycle');
});

test('环路径首尾相接且相邻节点存在真实依赖边', () => {
  const { cycles } = computeSchedule([
    cue(1, { predecessors: [3] }),
    cue(2, { predecessors: [1] }),
    cue(3, { predecessors: [2] }),
  ]);
  assert.equal(cycles.length, 1);
  const path = cycles[0];
  assert.equal(path[0], path[path.length - 1]); // 首尾相同
  assert.equal(new Set(path.slice(0, -1)).size, 3); // 恰好覆盖 3 个提示点
  // 路径中 next 必须是 cur 的后继（即 next 的前置包含 cur）
  const preds = { 1: [3], 2: [1], 3: [2] };
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.ok(preds[path[i + 1]].includes(path[i]), `${path[i]} -> ${path[i + 1]} 应为真实依赖边`);
  }
});

test('超过最晚完成时间的提示点被标记为 late', () => {
  const { cues } = computeSchedule([
    cue(1, { earliestStart: 0, duration: 60 }),
    cue(2, { earliestStart: 0, duration: 30, latestFinish: 100, predecessors: [1] }), // 完成于 60，未超
    cue(3, { earliestStart: 0, duration: 50, latestFinish: 90, predecessors: [1] }), // 完成于 110，超 20
  ]);
  const c2 = cues.find((c) => c.id === 2);
  const c3 = cues.find((c) => c.id === 3);
  assert.equal(c2.status, 'ok');
  assert.equal(c2.late, false);
  assert.equal(c3.status, 'late');
  assert.equal(c3.late, true);
  assert.equal(c3.finish - c3.latestFinish, 20);
});

test('忽略悬空的前置引用（防御性）', () => {
  const { cues, hasCycle } = computeSchedule([
    cue(1, { earliestStart: 10, duration: 5, predecessors: [999] }),
  ]);
  assert.equal(hasCycle, false);
  assert.equal(cues[0].start, 10);
});
