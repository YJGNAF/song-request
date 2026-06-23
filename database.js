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

function migrateDB() {
  // 给旧表添加 singer 列（如果不存在）
  try { db.run("ALTER TABLE songs ADD COLUMN singer TEXT DEFAULT 'singer1'"); } catch(e) {}
  try { db.run("ALTER TABLE requests ADD COLUMN singer TEXT DEFAULT 'singer1'"); } catch(e) {}
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      category TEXT DEFAULT '',
      singer TEXT DEFAULT 'singer1',
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
      singer TEXT DEFAULT 'singer1',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_song ON requests(song_id)');
  migrateDB();
  scheduleSave();
}

function seedIfEmpty() {
  const row = queryOne('SELECT COUNT(*) as cnt FROM songs');
  if (row.cnt === 0) {
    // 优先从备份文件加载完整歌曲列表
    const backupPath = path.join(__dirname, 'songs_backup.json');
    let songs = [];

    try {
      if (fs.existsSync(backupPath)) {
        songs = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      }
    } catch (e) {
      console.log('读取歌曲备份失败，使用默认歌曲');
    }

    // 如果备份文件不存在或为空，使用默认歌曲
    if (!songs || songs.length === 0) {
      songs = [
        { name: '十年', artist: '陈奕迅', category: '流行' },
        { name: '后来', artist: '刘若英', category: '流行' },
        { name: '告白气球', artist: '周杰伦', category: '流行' },
        { name: '晴天', artist: '周杰伦', category: '流行' },
        { name: '小幸运', artist: '田馥甄', category: '流行' },
        { name: '成都', artist: '赵雷', category: '民谣' },
        { name: '南山南', artist: '马頔', category: '民谣' },
        { name: '理想三旬', artist: '陈鸿宇', category: '民谣' },
        { name: '光辉岁月', artist: 'Beyond', category: '摇滚' },
        { name: '海阔天空', artist: 'Beyond', category: '摇滚' },
        { name: '突然好想你', artist: '五月天', category: '摇滚' },
        { name: '温柔', artist: '五月天', category: '摇滚' },
        { name: '月亮代表我的心', artist: '邓丽君', category: '经典' },
        { name: '甜蜜蜜', artist: '邓丽君', category: '经典' },
        { name: '吻别', artist: '张学友', category: '经典' },
        { name: '她说', artist: '林俊杰', category: '流行' },
        { name: '修炼爱情', artist: '林俊杰', category: '流行' },
        { name: '演员', artist: '薛之谦', category: '流行' },
        { name: '消愁', artist: '毛不易', category: '流行' },
        { name: '起风了', artist: '买辣椒也用券', category: '流行' },
      ];
    }

    const stmt = db.prepare('INSERT INTO songs (name, artist, category) VALUES (?, ?, ?)');
    for (const s of songs) {
      stmt.bind([s.name, s.artist, s.category]);
      stmt.step();
      stmt.reset();
    }
    stmt.free();
    scheduleSave();
  }
}

// ===== 歌曲操作 =====

function getSongs(search = '', category = '', singer = '') {
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
  if (singer) {
    sql += ' AND singer = ?';
    params.push(singer);
  }
  sql += ' ORDER BY category, name';
  return queryAll(sql, params);
}

function getCategories() {
  return queryAll("SELECT DISTINCT category FROM songs WHERE category != '' ORDER BY category");
}

function addSong(name, artist, category = '', singer = 'singer1') {
  return execute('INSERT INTO songs (name, artist, category, singer) VALUES (?, ?, ?, ?)', [name, artist, category, singer]);
}

function deleteSong(id) {
  return execute('DELETE FROM songs WHERE id = ?', [id]);
}

function getSongCount() {
  return queryOne('SELECT COUNT(*) as cnt FROM songs');
}

// ===== 请求操作 =====

function createRequest(songId, guestName = '') {
  // 获取歌曲的 singer
  const song = queryOne('SELECT singer FROM songs WHERE id = ?', [songId]);
  const singer = song ? song.singer : 'singer1';

  const result = execute('INSERT INTO requests (song_id, guest_name, singer) VALUES (?, ?, ?)', [songId, guestName, singer]);
  return queryOne(`
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = ?
  `, [result.lastInsertRowid]);
}

function getRequests(status = '', singer = '') {
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
  if (singer) {
    sql += ' AND r.singer = ?';
    params.push(singer);
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

function getStats(singer = '') {
  let singerWhere = '';
  const params = [];
  if (singer) {
    singerWhere = ' AND r.singer = ?';
    params.push(singer);
  }

  const todayHot = queryAll(`
    SELECT s.name, s.artist, COUNT(r.id) as count
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE date(r.created_at) = date('now', 'localtime')${singerWhere}
    GROUP BY s.id
    ORDER BY count DESC
    LIMIT 10
  `, params);

  const statusCounts = queryAll(`
    SELECT status, COUNT(*) as count
    FROM requests
    WHERE date(created_at) = date('now', 'localtime')${singerWhere}
    GROUP BY status
  `, params);

  return { todayHot, statusCounts };
}

// ===== 打赏配置 =====

function initConfigTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )
  `);
}

function getConfig(key) {
  initConfigTable();
  const row = queryOne('SELECT value FROM config WHERE key = ?', [key]);
  return row ? row.value : '';
}

function setConfig(key, value) {
  initConfigTable();
  // upsert
  const existing = queryOne('SELECT value FROM config WHERE key = ?', [key]);
  if (existing) {
    execute('UPDATE config SET value = ? WHERE key = ?', [value, key]);
  } else {
    execute('INSERT INTO config (key, value) VALUES (?, ?)', [key, value]);
  }
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
  getConfig,
  setConfig,
};
