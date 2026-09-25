'use strict';

/**
 * 走台排程核心逻辑（纯函数，不依赖 Express / SQLite，便于单元测试）。
 *
 * 输入提示点（cue）：
 *   { id, name, duration, earliestStart, latestFinish, predecessors: [id, ...] }
 *   - duration / earliestStart / latestFinish 均为「当天零点起的分钟数」，latestFinish 可为 null
 *   - predecessors 为必须先完成的提示点 id 列表
 *
 * 排程规则（关键路径法 CPM 的正向推算）：
 *   ES(cue) = max(cue.earliestStart, 所有前置提示点的 EF)
 *   EF(cue) = ES(cue) + cue.duration
 *
 * 输出：
 *   { cues: [...附带 start/finish/status], cycles: [[id,...]], hasCycle }
 *   status: 'ok' 正常 | 'late' 超过最晚完成 | 'cycle' 处于环依赖中 | 'blocked' 因环依赖无法排程
 */

/** Tarjan 强连通分量算法，用于精确定位环依赖涉及的提示点 */
function stronglyConnectedComponents(nodes, adj) {
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  function visit(v) {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of nodes) {
    if (!index.has(v)) visit(v);
  }
  return sccs;
}

/** 在一个强连通分量内找出一条实际的环路径（起点即终点），用于展示 */
function findCyclePath(scc, adj) {
  const inScc = new Set(scc);
  const startNode = scc[0];
  if (scc.length === 1) return [startNode, startNode]; // 自环

  const parent = new Map();
  const visited = new Set([startNode]);
  const stack = [startNode];
  while (stack.length) {
    const node = stack.pop();
    for (const next of adj.get(node) || []) {
      if (!inScc.has(next)) continue;
      if (next === startNode) {
        // 从相遇点沿 parent 链回溯到起点，再补上起点构成完整环
        const path = [];
        let cur = node;
        while (cur !== startNode) {
          path.unshift(cur);
          cur = parent.get(cur);
        }
        path.unshift(startNode);
        path.push(startNode);
        return path;
      }
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, node);
        stack.push(next);
      }
    }
  }
  return [...scc, scc[0]];
}

function computeSchedule(cues) {
  const byId = new Map();
  for (const c of cues) byId.set(c.id, c);

  // 依赖边：前置提示点 -> 后继提示点
  const dependents = new Map();
  const indegree = new Map();
  for (const c of cues) {
    dependents.set(c.id, []);
    indegree.set(c.id, 0);
  }
  for (const c of cues) {
    for (const p of c.predecessors || []) {
      if (!byId.has(p)) continue; // 忽略悬空引用（防御性）
      dependents.get(p).push(c.id);
      indegree.set(c.id, indegree.get(c.id) + 1);
    }
  }

  // 环检测：大小 > 1 的强连通分量，或带自环的单节点
  const sccs = stronglyConnectedComponents([...byId.keys()], dependents);
  const cycles = [];
  const inCycle = new Set();
  for (const scc of sccs) {
    const selfLoop =
      scc.length === 1 && (byId.get(scc[0]).predecessors || []).includes(scc[0]);
    if (scc.length > 1 || selfLoop) {
      cycles.push(findCyclePath(scc, dependents));
      for (const id of scc) inCycle.add(id);
    }
  }

  // Kahn 拓扑排序 + 正向推算最早开始/完成时间
  const queue = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort((a, b) => a - b); // 稳定顺序，结果可预期

  const start = new Map();
  const finish = new Map();
  const processed = new Set();
  while (queue.length) {
    const id = queue.shift();
    const c = byId.get(id);
    let s = c.earliestStart == null ? 0 : c.earliestStart;
    for (const p of c.predecessors || []) {
      if (finish.has(p)) s = Math.max(s, finish.get(p));
    }
    start.set(id, s);
    finish.set(id, s + (c.duration || 0));
    processed.add(id);
    for (const d of dependents.get(id)) {
      indegree.set(d, indegree.get(d) - 1);
      if (indegree.get(d) === 0) queue.push(d);
    }
  }

  const items = cues.map((c) => {
    const scheduled = processed.has(c.id);
    const s = scheduled ? start.get(c.id) : null;
    const f = scheduled ? finish.get(c.id) : null;
    const late = scheduled && c.latestFinish != null && f > c.latestFinish;
    let status = 'ok';
    if (inCycle.has(c.id)) status = 'cycle';
    else if (!scheduled) status = 'blocked';
    else if (late) status = 'late';
    return {
      id: c.id,
      name: c.name,
      duration: c.duration,
      earliestStart: c.earliestStart,
      latestFinish: c.latestFinish == null ? null : c.latestFinish,
      predecessors: c.predecessors || [],
      start: s,
      finish: f,
      late,
      status,
    };
  });

  return { cues: items, cycles, hasCycle: cycles.length > 0 };
}

module.exports = { computeSchedule };
