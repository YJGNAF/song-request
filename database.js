const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'song-request.db');

let db = null;
let saveTimer = null;

// 保存到文件（防抖）
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db) {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    }
  }, 500);
}

// 初始化数据库
async function initDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // 从文件加载或新建
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initTables();
  seedIfEmpty();
  return db;
}

// ===== 辅助函数 =====

// 执行查询，返回对象数组
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 执行查询，返回单个对象
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// 执行修改语句，返回 lastID
function execute(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
  // sql.js 中，lastInsertRowid 需要这样获取
  const result = queryOne('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: result ? result.id : 0 };
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      category TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      guest_name TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','completed')),
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_song ON requests(song_id)');
  scheduleSave();
}

function seedIfEmpty() {
  const row = queryOne('SELECT COUNT(*) as cnt FROM songs');
  if (row.cnt === 0) {
    const songs = [
      ['十年', '陈奕迅', '流行'],
      ['后来', '刘若英', '流行'],
      ['告白气球', '周杰伦', '流行'],
      ['晴天', '周杰伦', '流行'],
      ['小幸运', '田馥甄', '流行'],
      ['成都', '赵雷', '民谣'],
      ['南山南', '马頔', '民谣'],
      ['理想三旬', '陈鸿宇', '民谣'],
      ['光辉岁月', 'Beyond', '摇滚'],
      ['海阔天空', 'Beyond', '摇滚'],
      ['突然好想你', '五月天', '摇滚'],
      ['温柔', '五月天', '摇滚'],
      ['月亮代表我的心', '邓丽君', '经典'],
      ['甜蜜蜜', '邓丽君', '经典'],
      ['吻别', '张学友', '经典'],
      ['她说', '林俊杰', '流行'],
      ['修炼爱情', '林俊杰', '流行'],
      ['演员', '薛之谦', '流行'],
      ['消愁', '毛不易', '流行'],
      ['起风了', '买辣椒也用券', '流行'],
    ];

    const stmt = db.prepare('INSERT INTO songs (name, artist, category) VALUES (?, ?, ?)');
    for (const s of songs) {
      stmt.bind(s);
      stmt.step();
      stmt.reset();
    }
    stmt.free();
    scheduleSave();
  }
}

// ===== 歌曲操作 =====

function getSongs(search = '', category = '') {
  let sql = 'SELECT * FROM songs WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND (name LIKE ? OR artist LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY category, name';
  return queryAll(sql, params);
}

function getCategories() {
  return queryAll("SELECT DISTINCT category FROM songs WHERE category != '' ORDER BY category");
}

function addSong(name, artist, category = '') {
  return execute('INSERT INTO songs (name, artist, category) VALUES (?, ?, ?)', [name, artist, category]);
}

function deleteSong(id) {
  return execute('DELETE FROM songs WHERE id = ?', [id]);
}

function getSongCount() {
  return queryOne('SELECT COUNT(*) as cnt FROM songs');
}

// ===== 请求操作 =====

function createRequest(songId, guestName = '') {
  const result = execute('INSERT INTO requests (song_id, guest_name) VALUES (?, ?)', [songId, guestName]);
  return queryOne(`
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = ?
  `, [result.lastInsertRowid]);
}

function getRequests(status = '') {
  let sql = `
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.sort_order DESC, r.created_at ASC';
  return queryAll(sql, params);
}

function getRequestById(id) {
  return queryOne(`
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = ?
  `, [id]);
}

function updateRequestStatus(id, status) {
  execute('UPDATE requests SET status = ? WHERE id = ?', [status, id]);
  return getRequestById(id);
}

function pinRequest(id) {
  const max = queryOne('SELECT MAX(sort_order) as mx FROM requests');
  const newOrder = (max.mx || 0) + 1;
  execute('UPDATE requests SET sort_order = ? WHERE id = ?', [newOrder, id]);
  return getRequestById(id);
}

function moveRequest(id, direction) {
  const current = queryOne('SELECT * FROM requests WHERE id = ?', [id]);
  if (!current) return null;

  const sql = direction === 'up'
    ? "SELECT * FROM requests WHERE sort_order > ? AND status = 'pending' ORDER BY sort_order ASC LIMIT 1"
    : "SELECT * FROM requests WHERE sort_order < ? AND status = 'pending' ORDER BY sort_order DESC LIMIT 1";

  const neighbor = queryOne(sql, [current.sort_order]);
  if (!neighbor) return current;

  execute('UPDATE requests SET sort_order = ? WHERE id = ?', [neighbor.sort_order, current.id]);
  execute('UPDATE requests SET sort_order = ? WHERE id = ?', [current.sort_order, neighbor.id]);

  return getRequestById(id);
}

function getStats() {
  const todayHot = queryAll(`
    SELECT s.name, s.artist, COUNT(r.id) as count
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE date(r.created_at) = date('now', 'localtime')
    GROUP BY s.id
    ORDER BY count DESC
    LIMIT 10
  `);

  const statusCounts = queryAll(`
    SELECT status, COUNT(*) as count
    FROM requests
    WHERE date(created_at) = date('now', 'localtime')
    GROUP BY status
  `);

  return { todayHot, statusCounts };
}

module.exports = {
  initDb,
  getSongs,
  getCategories,
  addSong,
  deleteSong,
  getSongCount,
  createRequest,
  getRequests,
  getRequestById,
  updateRequestStatus,
  pinRequest,
  moveRequest,
  getStats,
};
