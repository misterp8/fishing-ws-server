# Fishing Game WebSocket Server

這是一個簡單的 Node.js WebSocket 伺服器，用於連接 3D 釣魚遊戲的顯示端與手機控制器。

## 功能
- **顯示端註冊**：遊戲主畫面連接時註冊為 `DISPLAY`。
- **控制器註冊**：手機掃碼連接時註冊為 `CONTROLLER` 並加入佇列。
- **排隊系統**：先進先出 (FIFO)。佇列中的第一位玩家獲得控制權。
- **指令轉發**：將當前玩家的 `ACTION` (甩竿/收竿) 轉發給顯示端。
- **狀態廣播**：即時通知所有客戶端當前的排隊狀況和輪到的玩家。

## 部署到 Render.com

1. 將此資料夾中的檔案 (`package.json`, `server.js`, `README.md`) 上傳到 GitHub Repository。
2. 登入 [Render.com](https://render.com)。
3. 點擊 **New +** -> **Web Service**。
4. 連結你的 GitHub Repo。
5. 設定如下：
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
6. 部署完成後，你會獲得一個網址（例如 `https://your-app.onrender.com`）。
7. 將前端代碼中的 `WS_URL` 替換為 `wss://your-app.onrender.com`。

## 本地開發

1. 安裝依賴：
   ```bash
   npm install
   ```
2. 啟動伺服器：
   ```bash
   npm start
   ```
3. 伺服器預設運行於 `ws://localhost:8080`。
