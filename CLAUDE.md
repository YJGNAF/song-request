# 碳炙Brew · 驻唱点歌系统

## 项目概述
驻唱点歌网站，客人微信扫码点歌，歌手实时管理。支持双歌手独立后台。

## 技术栈
- **后端**: Node.js + Express + Socket.IO
- **数据库**: sql.js (SQLite WASM，纯 JS，无编译依赖)
- **前端**: 原生 HTML/CSS/JS，暗色暖橙主题
- **部署**: Railway ($5/月)

## 云端地址
- 客人点歌: https://tanzhi-brew-production.up.railway.app
- 管理页面: https://tanzhi-brew-production.up.railway.app/admin.html
- Railway 项目 ID: 7c9899c3-3029-48fd-aa4d-67875989b5ff
- Railway 服务 ID: a1148694-3516-415b-9415-a1003bd83b0b
- GitHub: https://github.com/YJGNAF/song-request

## 环境变量 (Railway)
| 变量 | 值 |
|------|-----|
| SINGER1_PASSWORD | 111111 |
| SINGER1_NAME | 歌手一 |
| SINGER2_PASSWORD | 222222 |
| SINGER2_NAME | 歌手二 |
| TIP_WECHAT_QR | https://tanzhi-brew-production.up.railway.app/tip_wechat_singer1.jpg |
| TIP_MESSAGE | 如果喜欢我的演唱可以打赏支持哦~ |

## 项目结构
```
├── server.js          # Express + Socket.IO 后端
├── database.js        # sql.js 数据库层
├── start.bat          # 本地启动脚本（需 cloudflared.exe）
├── songs_backup.json # 216首歌曲备份
├── qrcode.png         # 点歌二维码
├── public/
│   ├── index.html     # 客人点歌页面
│   ├── admin.html     # 歌手管理页面（双歌手共用）
│   ├── app.js         # 客人端逻辑
│   ├── style.css      # 样式
│   └── tip_wechat_singer1.jpg  # 歌手一微信收款码
```

## 双歌手系统
- 同一管理页面 admin.html，不同密码识别不同歌手
- 每个歌手只能看到/管理自己的歌曲和点歌请求
- 客人页根据在岗歌手（WebSocket 连接状态）显示对应歌曲
- 无歌手在岗时显示驻唱时间提示（周五周六 18:00~00:00）

## 部署步骤
1. `git push` 推送到 GitHub
2. `railway up --service a1148694-3516-415b-9415-a1003bd83b0b` 部署

## 本地开发
```bash
npm start       # 启动 localhost:3000
```
环境变量默认值见 server.js 中的 SINGERS 配置。
