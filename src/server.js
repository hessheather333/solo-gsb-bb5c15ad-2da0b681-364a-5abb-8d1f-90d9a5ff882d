'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { parseTime } = require('./timeutil');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

db.connect(DB_PATH);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/print', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'print.html'));
});

/* ---------- 接口 ---------- */

app.get('/api/cues', (_req, res) => {
  res.json(db.listCues());
});

app.get('/api/schedule', (_req, res) => {
  res.json(db.computeSchedule());
});

app.get('/api/cues/:id', (req, res) => {
  const cue = db.getCue(Number(req.params.id));
  if (!cue) return res.status(404).json({ error: '提示点不存在' });
  res.json(cue);
});

app.post('/api/cues', (req, res, next) => {
  try {
    const data = validateCueBody(req.body, { db, id: null });
    const cue = db.createCue(data);
    res.status(201).json(cue);
  } catch (err) {
    next(err);
  }
});

app.put('/api/cues/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!db.getCue(id)) {
      return res.status(404).json({ error: '提示点不存在' });
    }
    const data = validateCueBody(req.body, { db, id });
    res.json(db.updateCue(id, data));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/cues/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.getCue(id)) return res.status(404).json({ error: '提示点不存在' });
  db.deleteCue(id);
  res.status(204).end();
});

/* ---------- 校验 ---------- */

function validateCueBody(body, { db: database, id }) {
  if (!body || typeof body !== 'object') {
    const err = new Error('请求体必须是 JSON 对象');
    err.statusCode = 400;
    throw err;
  }

  const title = String(body.title ?? '').trim();
  if (!title) badRequest('请填写提示点名称');

  const ref = body.ref != null ? String(body.ref).trim() : '';

  const duration = parseTime(body.duration, { asMinutes: true });
  if (duration == null || duration <= 0) badRequest('请填写正确的时长（大于 0，格式如 5、5:30、1:02:30）');

  const minStart = body.minStart != null && String(body.minStart).trim() !== ''
    ? parseTime(body.minStart)
    : 0;
  if (minStart < 0) badRequest('最早开始时间不能为负');

  let maxFinish = null;
  if (body.maxFinish != null && String(body.maxFinish).trim() !== '') {
    maxFinish = parseTime(body.maxFinish);
    if (maxFinish < minStart) badRequest('最晚完成时间不能早于最早开始时间');
  }

  let prerequisites = [];
  if (body.prerequisites != null) {
    if (!Array.isArray(body.prerequisites)) badRequest('前置提示点必须是编号数组');
    prerequisites = body.prerequisites.map((p) => Number(p));
    if (prerequisites.some((p) => !Number.isInteger(p) || p <= 0)) {
      badRequest('前置提示点编号不合法');
    }
    prerequisites = Array.from(new Set(prerequisites));
    for (const preId of prerequisites) {
      if (id != null && preId === id) continue; // 自环允许保存，由排程器指出
      if (!database.getCue(preId)) badRequest(`前置提示点 #${preId} 不存在`);
    }
  }

  return { ref, title, duration, minStart, maxFinish, prerequisites };
}

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  throw err;
}

/* ---------- 错误处理 ---------- */

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`走台排程应用已启动: http://localhost:${PORT}`);
});
