// ===== 全局状态 =====
const socket = io();
let myRequests = JSON.parse(localStorage.getItem('myRequests') || '[]');
let currentCategory = '';
let allSongs = [];
let searchTimer = null;

// ===== DOM 元素 =====
const searchInput = document.getElementById('searchInput');
const categoryTags = document.getElementById('categoryTags');
const songList = document.getElementById('songList');
const myRequestsList = document.getElementById('myRequestsList');
const myRequestsEmpty = document.getElementById('myRequestsEmpty');
const toastContainer = document.getElementById('toastContainer');

// ===== Toast 提示 =====
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ===== 加载分类 =====
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    categoryTags.innerHTML = '<button class="category-tag active" data-category="">全部</button>';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-tag';
      btn.dataset.category = cat.category;
      btn.textContent = cat.category;
      categoryTags.appendChild(btn);
    });

    // 点击事件
    categoryTags.querySelectorAll('.category-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        categoryTags.querySelectorAll('.category-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        currentCategory = tag.dataset.category;
        loadSongs();
      });
    });
  } catch (err) {
    console.error('加载分类失败:', err);
  }
}

// ===== 加载歌曲 =====
async function loadSongs() {
  try {
    const search = searchInput.value.trim();
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (currentCategory) params.set('category', currentCategory);

    const res = await fetch(`/api/songs?${params.toString()}`);
    allSongs = await res.json();
    renderSongs();
  } catch (err) {
    console.error('加载歌曲失败:', err);
    songList.innerHTML = '<div class="empty-state"><div class="icon">😢</div><p>加载失败，请刷新重试</p></div>';
  }
}

// ===== 渲染歌曲列表 =====
function renderSongs() {
  if (allSongs.length === 0) {
    songList.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>没有找到匹配的歌曲</p></div>';
    return;
  }

  const requestedSongIds = myRequests.map(r => r.song_id);

  songList.innerHTML = allSongs.map(song => {
    const isRequested = requestedSongIds.includes(song.id);
    return `
      <div class="song-card ${isRequested ? 'requested' : ''}" data-song-id="${song.id}">
        <div class="song-cover">🎵</div>
        <div class="song-info">
          <div class="song-name">${escapeHtml(song.name)}</div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
        <button class="btn-request ${isRequested ? 'requested' : ''}"
                data-song-id="${song.id}"
                data-song-name="${escapeHtml(song.name)}"
                data-song-artist="${escapeHtml(song.artist)}"
                ${isRequested ? 'disabled' : ''}>
          ${isRequested ? '✓' : '+'}
        </button>
      </div>
    `;
  }).join('');

  // 绑定点击事件
  songList.querySelectorAll('.btn-request').forEach(btn => {
    btn.addEventListener('click', () => requestSong(btn));
  });

  // 点击歌曲卡片也可以点歌
  songList.querySelectorAll('.song-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-request')) return;
      const btn = card.querySelector('.btn-request');
      if (btn && !btn.disabled) {
        requestSong(btn);
      }
    });
  });
}

// ===== 点歌 =====
async function requestSong(btn) {
  const songId = parseInt(btn.dataset.songId);
  const songName = btn.dataset.songName;
  const songArtist = btn.dataset.songArtist;

  try {
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '点歌失败');
    }

    const request = await res.json();

    // 保存到本地
    myRequests.push({
      id: request.id,
      song_id: songId,
      song_name: songName,
      song_artist: songArtist,
      status: 'pending'
    });
    saveMyRequests();

    // 监听状态更新
    socket.emit('track-request', request.id);

    // 更新 UI
    btn.classList.add('requested');
    btn.disabled = true;
    btn.textContent = '✓';
    btn.closest('.song-card')?.classList.add('requested');

    showToast(`已点「${songName}」✨`);
    renderMyRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== 渲染我的点歌 =====
function renderMyRequests() {
  if (myRequests.length === 0) {
    myRequestsEmpty.style.display = 'block';
    myRequestsList.innerHTML = '';
    return;
  }

  myRequestsEmpty.style.display = 'none';
  myRequestsList.innerHTML = myRequests.slice().reverse().map(req => {
    const statusMap = {
      pending: { text: '待处理', cls: 'status-pending' },
      accepted: { text: '已接单 ✨', cls: 'status-accepted' },
      rejected: { text: '已拒绝', cls: 'status-rejected' },
      completed: { text: '已唱完 🎉', cls: 'status-completed' }
    };
    const st = statusMap[req.status] || statusMap.pending;
    return `
      <div class="request-item" data-request-id="${req.id}">
        <div class="req-info">
          <div class="req-song">${escapeHtml(req.song_name)}</div>
          <div class="req-artist">${escapeHtml(req.song_artist)}</div>
        </div>
        <span class="status-badge ${st.cls}">${st.text}</span>
      </div>
    `;
  }).join('');
}

function saveMyRequests() {
  localStorage.setItem('myRequests', JSON.stringify(myRequests));
}

// ===== WebSocket 事件 =====
socket.on('status-update', (updated) => {
  const idx = myRequests.findIndex(r => r.id === updated.id);
  if (idx !== -1) {
    myRequests[idx].status = updated.status;
    saveMyRequests();
    renderMyRequests();

    const statusText = {
      accepted: '歌手已接单，准备为你演唱 🎤',
      rejected: '抱歉，这首歌暂时唱不了 🙏',
      completed: '已演唱完毕，希望你喜欢 💕'
    };
    if (statusText[updated.status]) {
      showToast(statusText[updated.status]);
    }
  }
});

// ===== 搜索防抖 =====
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadSongs();
  }, 300);
});

// ===== 初始化 =====
async function init() {
  await loadCategories();
  await loadSongs();
  renderMyRequests();

  // 为已有的请求建立 WebSocket 监听
  myRequests.forEach(req => {
    socket.emit('track-request', req.id);
  });
}

init();

// ===== 工具函数 =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
