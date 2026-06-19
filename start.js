const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;

console.log('🎵 驻唱点歌系统启动中...\n');

// 启动服务器
require('./server.js');

// 使用项目目录下的 cloudflared
const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
const tunnel = spawn(cloudflaredPath, [
  'tunnel', '--no-autoupdate',
  '--url', `http://localhost:${PORT}`
]);

let tunnelUrl = '';
let shown = false;

tunnel.stderr.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text); // 显示 cloudflared 日志

  if (!shown) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      tunnelUrl = match[0];
      shown = true;
      setTimeout(printInfo, 1000); // 等隧道完全就绪
    }
  }
});

function printInfo() {
  console.log('\n========================================');
  console.log('  ✅ 服务启动成功！');
  console.log(`  📱 客人点歌: ${tunnelUrl}/`);
  console.log(`  🔧 管理页面: ${tunnelUrl}/admin.html`);
  console.log(`  🔑 管理密码: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
  console.log('  📸 打开管理页面 → 截图右上角二维码 → 打印');
  console.log('  ⚠️  保持此窗口运行，不要关闭！');
  console.log('========================================\n');
}

process.on('SIGINT', () => {
  console.log('\n🛑 正在停止...');
  tunnel.kill();
  process.exit(0);
});
