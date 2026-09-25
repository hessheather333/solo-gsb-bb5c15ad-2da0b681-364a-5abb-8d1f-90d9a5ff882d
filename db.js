'use strict';

/**
 * SQLite 数据访问层（基于 sql.js —— SQLite 官方 C 源码的 WebAssembly 构建，
 * 生成的是标准 SQLite 数据库文件；纯 JS/WASM，无需原生编译，镜像构建更可靠）。
 *
 * 提供类似 better-sqlite3 的同步式 API：exec / run / get / all / transaction，
 * 并在每次写事务提交后把数据库持久化到磁盘文件。
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function openDb(dbPath) {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f),
  });

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  // 注意：sql.js 的 export() 会把连接级 PRAGMA 复位，所以每次导出后都要重新开启外键
  const enableForeignKeys = () => db.exec('PRAGMA foreign_keys = ON;');
  enableForeignKeys();

  // 持久化：把内存中的数据库整体写回 .db 文件（写操作后调用，做简单防抖）
  let persistTimer = null;
  function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, 50);
  }
  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, dbPath); // 原子替换，避免写一半损坏
    enableForeignKeys(); // export 后重新开启外键约束
  }

  const api = {
    exec: (sql) => db.exec(sql),

    all(sql, params = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },

    get(sql, params = []) {
      return api.all(sql, params)[0];
    },

    run(sql, params = []) {
      db.run(sql, params);
      const changes = db.getRowsModified();
      const row = api.get('SELECT last_insert_rowid() AS id');
      return { changes, lastInsertRowid: row ? row.id : 0 };
    },

    /** 用法同 better-sqlite3：const tx = db.transaction(fn); tx(args) */
    transaction(fn) {
      return (...args) => {
        enableForeignKeys(); // PRAGMA 在事务内无效，须在 BEGIN 前设置
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          persist();
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
    },

    persist,
    persistNow,
    close: () => db.close(),
  };

  return api;
}

module.exports = { openDb };
