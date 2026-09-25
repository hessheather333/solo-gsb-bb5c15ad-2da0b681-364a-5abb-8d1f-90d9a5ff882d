'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { schedule } = require('./scheduler');

let db;
let createCueTx;
let updateCueTx;

function connect(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  init();
  if (process.env.SEED_SAMPLE !== 'false' && countCues() === 0) {
    seed();
  }
  createCueTx = db.transaction(createCueImpl);
  updateCueTx = db.transaction(updateCueImpl);
  return db;
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cues (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ref        TEXT,
      title      TEXT NOT NULL,
      duration   INTEGER NOT NULL,           -- 时长（秒）
      min_start  INTEGER NOT NULL DEFAULT 0, -- 最早开始（秒，相对开排零点）
      max_finish INTEGER,                    -- 最晚完成（秒），可空
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      cue_id          INTEGER NOT NULL,
      prerequisite_id INTEGER NOT NULL,
      PRIMARY KEY (cue_id, prerequisite_id),
      FOREIGN KEY (cue_id) REFERENCES cues(id) ON DELETE CASCADE,
      FOREIGN KEY (prerequisite_id) REFERENCES cues(id) ON DELETE CASCADE
    );
  `);
}

function countCues() {
  return db.prepare('SELECT COUNT(*) AS n FROM cues').get().n;
}

/** 读取全部提示点（含前置 id 列表），用于排程计算与接口返回 */
function listCues() {
  const rows = db
    .prepare(
      `SELECT c.id, c.ref, c.title, c.duration, c.min_start AS minStart,
              c.max_finish AS maxFinish, c.position,
              COALESCE(GROUP_CONCAT(d.prerequisite_id), '') AS preIds
         FROM cues c
         LEFT JOIN dependencies d ON d.cue_id = c.id
        GROUP BY c.id
        ORDER BY c.position, c.id`
    )
    .all();

  return rows.map((r) => ({
    ...r,
    prerequisites: r.preIds ? r.preIds.split(',').map(Number) : [],
  }));
}

function getCue(id) {
  const row = db
    .prepare(
      `SELECT id, ref, title, duration, min_start AS minStart, max_finish AS maxFinish
         FROM cues WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  row.prerequisites = db
    .prepare('SELECT prerequisite_id AS pid FROM dependencies WHERE cue_id = ?')
    .all(id)
    .map((r) => r.pid);
  return row;
}

/** 从数据库重建模型并执行排程 */
function computeSchedule() {
  const cues = listCues().map((c) => ({
    id: c.id,
    ref: c.ref,
    title: c.title,
    duration: c.duration,
    minStart: c.minStart,
    maxFinish: c.maxFinish,
    prerequisites: c.prerequisites,
  }));
  return schedule(cues);
}

function createCue(data) {
  return createCueTx(data);
}

function createCueImpl(data) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM cues').get().p;
  const info = db
    .prepare(
      `INSERT INTO cues (ref, title, duration, min_start, max_finish, position)
       VALUES (@ref, @title, @duration, @minStart, @maxFinish, @position)`
    )
    .run({
      ref: data.ref || null,
      title: data.title,
      duration: data.duration,
      minStart: data.minStart,
      maxFinish: data.maxFinish ?? null,
      position: maxPos + 1,
    });

  replaceDependencies(info.lastInsertRowid, data.prerequisites || []);
  return getCue(info.lastInsertRowid);
}

function updateCue(id, data) {
  return updateCueTx(id, data);
}

function updateCueImpl(id, data) {
  db.prepare(
    `UPDATE cues
        SET ref = @ref, title = @title, duration = @duration,
            min_start = @minStart, max_finish = @maxFinish,
            updated_at = datetime('now')
      WHERE id = @id`
  ).run({
    id,
    ref: data.ref || null,
    title: data.title,
    duration: data.duration,
    minStart: data.minStart,
    maxFinish: data.maxFinish ?? null,
  });
  replaceDependencies(id, data.prerequisites || []);
  return getCue(id);
}

function replaceDependencies(cueId, prerequisiteIds) {
  db.prepare('DELETE FROM dependencies WHERE cue_id = ?').run(cueId);
  const insert = db.prepare(
    'INSERT INTO dependencies (cue_id, prerequisite_id) VALUES (?, ?)'
  );
  for (const preId of Array.from(new Set(prerequisiteIds))) {
    if (preId === cueId) {
      // 自环也写入，排程器会把它作为环依赖指出
      insert.run(cueId, preId);
    } else {
      const exists = db.prepare('SELECT 1 FROM cues WHERE id = ?').get(preId);
      if (exists) insert.run(cueId, preId);
    }
  }
}

function deleteCue(id) {
  return db.prepare('DELETE FROM cues WHERE id = ?').run(id);
}

/** 首次启动写入的示例走台数据（其中“换景演练”演示超时标记） */
function seed() {
  const rows = [
    { ref: 'Q1', title: '开场灯光检查', min: 0, dur: 600, max: null, pres: [] },
    { ref: 'Q2', title: '第一场演员走位', min: 900, dur: 1200, max: null, pres: ['Q1'] },
    { ref: 'Q3', title: '换景演练', min: 0, dur: 600, max: 2400, pres: ['Q2'] },
    { ref: 'Q4', title: '暗场转场', min: 0, dur: 300, max: null, pres: ['Q3'] },
    { ref: 'Q5', title: '谢幕定位', min: 3300, dur: 480, max: null, pres: ['Q4'] },
  ];
  const insert = db.prepare(
    `INSERT INTO cues (ref, title, duration, min_start, max_finish, position)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const idByRef = new Map();
  rows.forEach((r, i) => {
    const info = insert.run(r.ref, r.title, r.dur, r.min, r.max, i + 1);
    idByRef.set(r.ref, info.lastInsertRowid);
  });
  const link = db.prepare(
    'INSERT INTO dependencies (cue_id, prerequisite_id) VALUES (?, ?)'
  );
  for (const r of rows) {
    for (const pre of r.pres) link.run(idByRef.get(r.ref), idByRef.get(pre));
  }
}

module.exports = {
  connect,
  listCues,
  getCue,
  computeSchedule,
  createCue,
  updateCue,
  deleteCue,
};
