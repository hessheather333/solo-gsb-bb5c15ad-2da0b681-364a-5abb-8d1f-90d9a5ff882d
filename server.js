'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { computeSchedule } = require('./scheduler');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'scheduler.db');

async function main() {
  // ---------- 数据库初始化（启动时自动建表） ----------
  const db = await openDb(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cues (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL,
      duration       INTEGER NOT NULL CHECK (duration >= 0),
      earliest_start INTEGER NOT NULL DEFAULT 0,
      latest_finish  INTEGER
    );
    CREATE TABLE IF NOT EXISTS cue_dependencies (
      cue_id         INTEGER NOT NULL REFERENCES cues(id) ON DELETE CASCADE,
      predecessor_id INTEGER NOT NULL REFERENCES cues(id) ON DELETE CASCADE,
      PRIMARY KEY (cue_id, predecessor_id)
    );
  `);
  db.persistNow(); // 确保数据库文件落盘

  // ---------- 数据访问 ----------
  function loadCues() {
    const rows = db.all(
      'SELECT id, name, duration, earliest_start, latest_finish FROM cues ORDER BY id'
    );
    const deps = db.all(
      'SELECT cue_id, predecessor_id FROM cue_dependencies ORDER BY predecessor_id'
    );
    const byId = new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          duration: r.duration,
          earliestStart: r.earliest_start,
          latestFinish: r.latest_finish,
          predecessors: [],
        },
      ])
    );
    for (const d of deps) {
      const cue = byId.get(d.cue_id);
      if (cue) cue.predecessors.push(d.predecessor_id);
    }
    return [...byId.values()];
  }

  const cueExists = (id) => !!db.get('SELECT 1 AS x FROM cues WHERE id = ?', [id]);

  const createCue = db.transaction((v) => {
    const info = db.run(
      'INSERT INTO cues (name, duration, earliest_start, latest_finish) VALUES (?, ?, ?, ?)',
      [v.name, v.duration, v.earliestStart, v.latestFinish]
    );
    const id = Number(info.lastInsertRowid);
    for (const p of v.predecessors) {
      db.run('INSERT INTO cue_dependencies (cue_id, predecessor_id) VALUES (?, ?)', [id, p]);
    }
    return id;
  });

  const updateCue = db.transaction((id, v) => {
    db.run(
      'UPDATE cues SET name = ?, duration = ?, earliest_start = ?, latest_finish = ? WHERE id = ?',
      [v.name, v.duration, v.earliestStart, v.latestFinish, id]
    );
    db.run('DELETE FROM cue_dependencies WHERE cue_id = ?', [id]);
    for (const p of v.predecessors) {
      db.run('INSERT INTO cue_dependencies (cue_id, predecessor_id) VALUES (?, ?)', [id, p]);
    }
  });

  const deleteCue = db.transaction((id) => {
    // 依赖关系由外键 ON DELETE CASCADE 级联清理
    return db.run('DELETE FROM cues WHERE id = ?', [id]).changes;
  });

  // ---------- 校验 ----------
  const MAX_MINUTES = 2879; // 支持跨零点（次日 23:59）
  const isMinute = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_MINUTES;

  /** 返回 { error } 或 { value } */
  function validateCue(body, ownId) {
    if (!body || typeof body !== 'object') return { error: '请求体格式不正确' };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: '名称不能为空' };
    if (name.length > 100) return { error: '名称不能超过 100 个字符' };

    const duration = Number(body.duration);
    if (!Number.isInteger(duration) || duration < 0 || duration > 1440) {
      return { error: '时长必须是 0–1440 之间的整数（分钟）' };
    }

    const earliestStart = Number(body.earliestStart);
    if (!isMinute(earliestStart)) return { error: '最早开始时间格式不正确' };

    let latestFinish = body.latestFinish;
    if (latestFinish === '' || latestFinish === undefined || latestFinish === null) {
      latestFinish = null;
    } else {
      latestFinish = Number(latestFinish);
      if (!isMinute(latestFinish)) return { error: '最晚完成时间格式不正确' };
    }

    let predecessors = body.predecessors;
    if (predecessors === undefined || predecessors === null) predecessors = [];
    if (!Array.isArray(predecessors)) return { error: '前置提示点必须是数组' };
    predecessors = [...new Set(predecessors.map(Number))];
    for (const p of predecessors) {
      if (!Number.isInteger(p)) return { error: '前置提示点 id 不正确' };
      if (ownId != null && p === ownId) return { error: '提示点不能以自己为前置' };
      if (!cueExists(p)) return { error: `前置提示点 #${p} 不存在` };
    }

    return { value: { name, duration, earliestStart, latestFinish, predecessors } };
  }

  // ---------- HTTP 服务 ----------
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // 全量状态：提示点 + 计算后的排程结果（任何修改后前端重新拉取即完成重新排程）
  app.get('/api/state', (req, res) => {
    res.json(computeSchedule(loadCues()));
  });

  app.post('/api/cues', (req, res) => {
    const { error, value } = validateCue(req.body, null);
    if (error) return res.status(400).json({ error });
    const id = createCue(value);
    res.status(201).json({ id });
  });

  app.put('/api/cues/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !cueExists(id)) {
      return res.status(404).json({ error: '提示点不存在' });
    }
    const { error, value } = validateCue(req.body, id);
    if (error) return res.status(400).json({ error });
    updateCue(id, value);
    res.json({ ok: true });
  });

  app.delete('/api/cues/:id', (req, res) => {
    const id = Number(req.params.id);
    if (deleteCue(id) === 0) return res.status(404).json({ error: '提示点不存在' });
    res.json({ ok: true });
  });

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  app.listen(PORT, () => {
    console.log(`小剧场走台排程已启动: http://localhost:${PORT}`);
    console.log(`数据库文件: ${DB_PATH}`);
  });

  // 退出前落盘
  const shutdown = () => {
    try {
      db.persistNow();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
