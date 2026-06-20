@echo off
chcp 65001 >nul
title 碳炙Brew · 点歌系统
cd /d %~dp0

echo.
echo    ╔════════════════════════════╗
echo    ║   碳炙Brew · 点歌系统     ║
echo    ╚════════════════════════════╝
echo.
echo    [1/2] 启动本地服务...
start /b /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul

echo    [2/2] 创建公网隧道...
echo.
echo    ╔═══════════════════════════════════════╗
echo    ║  正在生成二维码地址，请稍等...       ║
echo    ╚═══════════════════════════════════════╝
echo.
echo    等待隧道连接...

cloudflared.exe tunnel --url http://localhost:3000
