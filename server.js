const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 配置
const PORT = process.env.PORT || 3000;

// 多歌手密码配置
const SINGERS = {
  singer1: {
    password: process.env.SINGER1_PASSWORD || 'admin123',
    name: process.env.SINGER1_NAME || '歌手一'
  },
  singer2: {
    password: process.env.SINGER2_PASSWORD || 'admin234',
    name: process.env.SINGER2_NAME || '歌手二'
  }
};

// 根据密码查找歌手
function findSingerByPassword(pwd) {
  for (const [id, cfg] of Object.entries(SINGERS)) {
    if (cfg.password === pwd) return { id, ...cfg };
  }
  return null;
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Admin 认证中间件 =====
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const singer = findSingerByPassword(token);
  if (singer) {
    req.singer = singer;
    return next();
  }
  return res.status(401).json({ error: '密码错误' });
}

// ===== REST API =====

// 获取歌曲列表（客人端看全部，管理端按需过滤）
app.get('/api/songs', (req, res) => {
  try {
    const { search, category, singer } = req.query;
    const songs = db.getSongs(search || '', category || '', singer || '');
    res.json(songs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取分类列表
app.get('/api/categories', (req, res) => {
  try {
    const categories = db.getCategories();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加歌曲（管理端，自动归属当前歌手）
app.post('/api/songs', adminAuth, (req, res) => {
  try {
    const { name, artist, category } = req.body;
    if (!name || !artist) {
      return res.status(400).json({ error: '歌曲名和歌手名不能为空' });
    }
    const result = db.addSong(name, artist, category || '', req.singer.id);
    res.json({ id: result.lastInsertRowid, name, artist, category, singer: req.singer.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除歌曲（管理端）
app.delete('/api/songs/:id', adminAuth, (req, res) => {
  try {
    db.deleteSong(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 提交点歌请求（客人端）
app.post('/api/requests', (req, res) => {
  try {
    const { song_id, guest_name } = req.body;
    if (!song_id) {
      return res.status(400).json({ error: '请选择歌曲' });
    }
    const request = db.createRequest(song_id, guest_name || '');

    // 实时通知管理端
    io.to('admin').emit('new-request', request);
    broadcastQueueToAdmins();
    broadcastQueue();

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取请求列表（管理端，只看自己歌手的）
app.get('/api/requests', adminAuth, (req, res) => {
  try {
    const { status } = req.query;
    const requests = db.getRequests(status || '', req.singer.id);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个请求状态（客人端查询）
app.get('/api/requests/:id', (req, res) => {
  try {
    const request = db.getRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: '请求不存在' });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新请求状态（管理端）
app.put('/api/requests/:id/status', adminAuth, (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'accepted', 'rejected', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效的状态' });
    }
    const updated = db.updateRequestStatus(req.params.id, status);

    // 通知对应客人
    io.emit('status-update', updated);
    io.to('admin').emit('queue-update', db.getRequests('pending'));
    broadcastQueue();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 置顶请求（管理端）
app.post('/api/requests/:id/pin', adminAuth, (req, res) => {
  try {
    const updated = db.pinRequest(req.params.id);
    io.to('admin').emit('queue-update', db.getRequests('pending'));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动请求排序（管理端）
app.post('/api/requests/:id/move', adminAuth, (req, res) => {
  try {
    const { direction } = req.body; // 'up' or 'down'
    const updated = db.moveRequest(req.params.id, direction);
    io.to('admin').emit('queue-update', db.getRequests('pending'));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取统计数据（管理端，只看自己歌手的）
app.get('/api/stats', adminAuth, (req, res) => {
  try {
    const stats = db.getStats(req.singer.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取打赏配置（客人端公开）
app.get('/api/tip-config', (req, res) => {
  try {
    const wechat = db.getConfig('tip_wechat_qr');
    const alipay = db.getConfig('tip_alipay_qr');
    const message = db.getConfig('tip_message') || '喜欢我的演唱吗？打个赏吧~';
    res.json({ wechat, alipay, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置打赏配置（管理端）
app.put('/api/tip-config', adminAuth, (req, res) => {
  try {
    const { wechat, alipay, message } = req.body;
    if (wechat !== undefined) db.setConfig('tip_wechat_qr', wechat);
    if (alipay !== undefined) db.setConfig('tip_alipay_qr', alipay);
    if (message !== undefined) db.setConfig('tip_message', message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const singer = findSingerByPassword(password);
  if (singer) {
    return res.json({ success: true, token: singer.password, singer: { id: singer.id, name: singer.name } });
  }
  return res.status(401).json({ error: '密码错误' });
});

// 验证 token
app.get('/api/admin/verify', adminAuth, (req, res) => {
  res.json({ valid: true, singer: { id: req.singer.id, name: req.singer.name } });
});

// ===== WebSocket =====
io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);

  // 加入管理端频道
  socket.on('join-admin', (password) => {
    const singer = findSingerByPassword(password);
    if (singer) {
      socket.join('admin');
      socket.singerId = singer.id;
      socket.emit('admin-joined', { success: true, singer: { id: singer.id, name: singer.name } });
      // 发送当前歌手的待处理列表
      socket.emit('queue-update', db.getRequests('pending', singer.id));
    } else {
      socket.emit('admin-joined', { success: false, error: '密码错误' });
    }
  });

  // 客人端加入，监听自己点歌的状态
  socket.on('track-request', (requestId) => {
    socket.join(`request-${requestId}`);
  });

  // 客人端请求队列更新
  socket.on('join-guest', () => {
    socket.join('guests');
    // 发送当前队列给客人
    const queue = db.getRequests();
    socket.emit('queue-update', queue);
  });

  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
  });
});

// 广播队列给所有客人
function broadcastQueue() {
  const queue = db.getRequests();
  io.to('guests').emit('queue-update', queue);
}

// 广播队列给各歌手管理端
async function broadcastQueueToAdmins() {
  try {
    const sockets = await io.in('admin').fetchSockets();
    for (const s of sockets) {
      if (s.singerId) {
        s.emit('queue-update', db.getRequests('pending', s.singerId));
      }
    }
  } catch(e) {}
}

// 启动服务
async function start() {
  await db.initDb();
  server.listen(PORT, () => {
    console.log(`🎵 点歌服务已启动: http://localhost:${PORT}`);
    console.log(`📱 客人页面: http://localhost:${PORT}`);
    console.log(`🔧 管理页面: http://localhost:${PORT}/admin.html`);
    console.log(`🔑 ${SINGERS.singer1.name} 密码: ${SINGERS.singer1.password}`);
    console.log(`🔑 ${SINGERS.singer2.name} 密码: ${SINGERS.singer2.password}`);
  });
}

start();
