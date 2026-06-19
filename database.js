const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'song-request.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    seedIfEmpty();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      category TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      guest_name TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','completed')),
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_song ON requests(song_id);
  `);
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM songs').get();
  if (count.cnt === 0) {
    const insert = db.prepare('INSERT INTO songs (name, artist, category) VALUES (?, ?, ?)');
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

    const insertMany = db.transaction(() => {
      for (const s of songs) {
        insert.run(...s);
      }
    });
    insertMany();
  }
}

// ===== 歌曲操作 =====

function getSongs(search = '', category = '') {
  const db = getDb();
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
  return db.prepare(sql).all(...params);
}

function getCategories() {
  const db = getDb();
  return db.prepare("SELECT DISTINCT category FROM songs WHERE category != '' ORDER BY category").all();
}

function addSong(name, artist, category = '') {
  const db = getDb();
  return db.prepare('INSERT INTO songs (name, artist, category) VALUES (?, ?, ?)').run(name, artist, category);
}

function deleteSong(id) {
  const db = getDb();
  return db.prepare('DELETE FROM songs WHERE id = ?').run(id);
}

function getSongCount() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as cnt FROM songs').get();
}

// ===== 请求操作 =====

function createRequest(songId, guestName = '') {
  const db = getDb();
  const result = db.prepare('INSERT INTO requests (song_id, guest_name) VALUES (?, ?)').run(songId, guestName);

  // 返回完整请求信息
  return db.prepare(`
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);
}

function getRequests(status = '') {
  const db = getDb();
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
  return db.prepare(sql).all(...params);
}

function getRequestById(id) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, s.name as song_name, s.artist as song_artist
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = ?
  `).get(id);
}

function updateRequestStatus(id, status) {
  const db = getDb();
  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, id);
  return getRequestById(id);
}

function pinRequest(id) {
  const db = getDb();
  // 置顶：设为当前最大 sort_order + 1
  const max = db.prepare('SELECT MAX(sort_order) as mx FROM requests').get();
  const newOrder = (max.mx || 0) + 1;
  db.prepare('UPDATE requests SET sort_order = ? WHERE id = ?').run(newOrder, id);
  return getRequestById(id);
}

function moveRequest(id, direction) {
  // direction: 'up' or 'down' — 交换相邻请求的 sort_order
  const db = getDb();
  const current = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!current) return null;

  const sql = direction === 'up'
    ? `SELECT * FROM requests WHERE sort_order > ? AND status = 'pending' ORDER BY sort_order ASC LIMIT 1`
    : `SELECT * FROM requests WHERE sort_order < ? AND status = 'pending' ORDER BY sort_order DESC LIMIT 1`;

  const neighbor = db.prepare(sql).get(current.sort_order);
  if (!neighbor) return current;

  // 交换 sort_order
  db.prepare('UPDATE requests SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, current.id);
  db.prepare('UPDATE requests SET sort_order = ? WHERE id = ?').run(current.sort_order, neighbor.id);

  return getRequestById(id);
}

function getStats() {
  const db = getDb();
  // 今日热门歌曲 Top 10（当天被点次数）
  const todayHot = db.prepare(`
    SELECT s.name, s.artist, COUNT(r.id) as count
    FROM requests r
    JOIN songs s ON r.song_id = s.id
    WHERE date(r.created_at) = date('now', 'localtime')
    GROUP BY s.id
    ORDER BY count DESC
    LIMIT 10
  `).all();

  // 各状态数量
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM requests
    WHERE date(created_at) = date('now', 'localtime')
    GROUP BY status
  `).all();

  return { todayHot, statusCounts };
}

module.exports = {
  getDb,
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
