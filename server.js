/**
 * 釣魚遊戲 WebSocket 伺服器
 * 用於管理學生連線和控制權分配
 */

const WebSocket = require('ws');
const http = require('http');
const readline = require('readline');

// 建立 HTTP 伺服器
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(' Fishing Game WebSocket Server\n');
});

// 建立 WebSocket 伺服器
const wss = new WebSocket.Server({ server });

// 連線池
const connections = new Map(); // ws -> { id, name, type, isTeacher }
const students = new Map();    // id -> { ws, name, hasPlayed, playCount }
const teachers = new Map();    // id -> ws

let currentPlayer = null;      // 目前有控制權的學生
let playerQueue = [];          // 等待中的學生ID列表
let gameState = {
    phase: 'idle',             // idle, casting, waiting, biting, reeling, reward
    playerId: null,
    startTime: null,
    biteTime: null
};

// 生成唯一ID
function generateId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// 取得所有學生列表
function getStudentList() {
    const list = [];
    students.forEach((data, id) => {
        list.push({
            id: id,
            name: data.name,
            hasPlayed: data.hasPlayed,
            playCount: data.playCount,
            isCurrentPlayer: currentPlayer === id
        });
    });
    return list;
}

// 廣播訊息給所有連線
function broadcast(message) {
    const msgStr = JSON.stringify(message);
    connections.forEach((data, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msgStr);
        }
    });
}

// 廣播給特定類型的客戶端
function broadcastTo(type, message) {
    const msgStr = JSON.stringify(message);
    connections.forEach((data, ws) => {
        if (ws.readyState === WebSocket.OPEN && data.type === type) {
            ws.send(msgStr);
        }
    });
}

// 發送訊息給特定客戶端
function sendTo(id, message) {
    const student = students.get(id);
    if (student && student.ws.readyState === WebSocket.OPEN) {
        student.ws.send(JSON.stringify(message));
    }
}

// 發送給老師端
function sendToTeacher(message) {
    teachers.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    });
}

// 更新學生列表給老師
function updateTeacherStudentList() {
    sendToTeacher({
        type: 'student_list',
        students: getStudentList()
    });
}

// 處理新連線
wss.on('connection', (ws) => {
    const id = generateId();
    const connectionInfo = { id, type: null, name: '' };
    connections.set(ws, connectionInfo);

    console.log(`\n[${new Date().toLocaleTimeString()}] 新連線: ${id}`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, id, message);
        } catch (err) {
            console.error('訊息解析錯誤:', err);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws, id);
    });

    ws.on('error', (err) => {
        console.error(`連線 ${id} 錯誤:`, err.message);
    });

    // 發送連線確認
    ws.send(JSON.stringify({
        type: 'connected',
        id: id,
        timestamp: Date.now()
    }));
});

// 處理訊息
function handleMessage(ws, id, message) {
    console.log(`[${id}] 收到訊息:`, message.type);

    switch (message.type) {
        case 'register':
            handleRegistration(ws, id, message);
            break;

        case 'control_action':
            handleControlAction(ws, id, message);
            break;

        case 'game_state':
            handleGameState(ws, id, message);
            break;

        case 'request_control':
            handleRequestControl(ws, id);
            break;

        case 'release_control':
            handleReleaseControl(ws, id);
            break;

        case 'teacher_command':
            handleTeacherCommand(ws, id, message);
            break;
    }
}

// 處理註冊
function handleRegistration(ws, id, message) {
    const { role, name } = message;
    const connectionInfo = connections.get(ws);
    
    if (role === 'teacher') {
        connectionInfo.type = 'teacher';
        connectionInfo.name = name || '老師';
        teachers.set(id, ws);
        console.log(`老師 "${connectionInfo.name}" 已連線`);
        
        // 發送當前狀態
        ws.send(JSON.stringify({
            type: 'teacher_registered',
            currentPlayer: currentPlayer,
            students: getStudentList(),
            gameState: gameState
        }));
    } else if (role === 'student') {
        connectionInfo.type = 'student';
        connectionInfo.name = name || `學生_${id}`;
        
        students.set(id, {
            ws: ws,
            name: connectionInfo.name,
            hasPlayed: false,
            playCount: 0
        });
        
        console.log(`學生 "${connectionInfo.name}" (${id}) 已連線`);
        
        // 通知學生等待
        ws.send(JSON.stringify({
            type: 'student_registered',
            waitingForControl: currentPlayer !== null
        }));
        
        // 通知老師有新學生
        updateTeacherStudentList();
    }
}

// 處理控制動作
function handleControlAction(ws, id, message) {
    // 只有當前玩家可以控制
    if (currentPlayer !== id) return;
    
    const { action, data } = message;
    
    // 廣播控制動作給所有客戶端
    broadcast({
        type: 'game_action',
        playerId: id,
        action: action,
        data: data,
        timestamp: Date.now()
    });
}

// 處理遊戲狀態更新
function handleGameState(ws, id, message) {
    if (currentPlayer !== id) return;
    
    const { state } = message;
    gameState = { ...gameState, ...state };
    
    // 廣播遊戲狀態
    broadcast({
        type: 'game_state_update',
        playerId: id,
        state: gameState,
        timestamp: Date.now()
    });
    
    // 檢查遊戲是否結束
    if (state.phase === 'reward') {
        // 更新學生遊戲記錄
        const student = students.get(id);
        if (student) {
            student.hasPlayed = true;
            student.playCount++;
        }
        
        // 控制權回歸
        currentPlayer = null;
        updateTeacherStudentList();
        
        console.log(`玩家 ${student.name} 完成遊戲`);
    }
}

// 處理控制請求
function handleRequestControl(ws, id) {
    if (currentPlayer !== null) {
        // 已經有玩家在玩，加入隊列
        if (!playerQueue.includes(id)) {
            playerQueue.push(id);
            ws.send(JSON.stringify({
                type: 'control_queued',
                position: playerQueue.indexOf(id) + 1
            }));
        }
        return;
    }
    
    // 給予控制權
    currentPlayer = id;
    const student = students.get(id);
    
    if (student) {
        ws.send(JSON.stringify({
            type: 'control_granted',
            gameReady: true
        }));
        
        // 廣播新玩家開始
        broadcast({
            type: 'player_started',
            playerId: id,
            playerName: student.name,
            timestamp: Date.now()
        });
        
        console.log(`控制權給予 ${student.name}`);
        updateTeacherStudentList();
    }
}

// 處理釋放控制權
function handleReleaseControl(ws, id) {
    if (currentPlayer === id) {
        const student = students.get(id);
        if (student) {
            student.hasPlayed = true;
            student.playCount++;
        }
        
        currentPlayer = null;
        gameState.phase = 'idle';
        
        // 檢查隊列
        if (playerQueue.length > 0) {
            const nextId = playerQueue.shift();
            const nextStudent = students.get(nextId);
            if (nextStudent && nextStudent.ws.readyState === WebSocket.OPEN) {
                nextStudent.ws.send(JSON.stringify({
                    type: 'control_granted',
                    gameReady: true
                }));
                currentPlayer = nextId;
                console.log(`控制權轉給 ${nextStudent.name}`);
            }
        }
        
        broadcast({
            type: 'player_stopped',
            playerId: id,
            timestamp: Date.now()
        });
        
        updateTeacherStudentList();
    }
}

// 處理老師指令
function handleTeacherCommand(ws, id, message) {
    const { command, studentId } = message;
    
    switch (command) {
        case 'grant_control':
            // 老師指定學生開始
            if (studentId && students.has(studentId)) {
                // 先釋放當前玩家的控制權
                if (currentPlayer !== null) {
                    const current = students.get(currentPlayer);
                    if (current) {
                        current.hasPlayed = true;
                        current.playCount++;
                    }
                }
                
                currentPlayer = studentId;
                const student = students.get(studentId);
                student.ws.send(JSON.stringify({
                    type: 'control_granted',
                    gameReady: true
                }));
                
                broadcast({
                    type: 'player_started',
                    playerId: studentId,
                    playerName: student.name,
                    timestamp: Date.now()
                });
                
                console.log(`老師指定 ${student.name} 開始遊戲`);
                updateTeacherStudentList();
            }
            break;
            
        case 'release_current':
            // 老師釋放當前玩家控制權
            if (currentPlayer !== null) {
                handleReleaseControl(ws, currentPlayer);
            }
            break;
            
        case 'reset_student':
            // 重置學生遊戲狀態（可以再玩）
            if (studentId && students.has(studentId)) {
                const student = students.get(studentId);
                student.hasPlayed = false;
                updateTeacherStudentList();
            }
            break;
            
        case 'clear_all':
            // 重置所有學生
            students.forEach((data) => {
                data.hasPlayed = false;
            });
            playerQueue = [];
            if (currentPlayer !== null) {
                broadcast({
                    type: 'player_stopped',
                    playerId: currentPlayer,
                    timestamp: Date.now()
                });
                currentPlayer = null;
            }
            updateTeacherStudentList();
            break;
            
        case 'send_action':
            // 老師直接發送控制指令（教學模式）
            const { action, actionData } = message;
            broadcast({
                type: 'game_action',
                playerId: currentPlayer || 'teacher',
                action: action,
                data: actionData,
                fromTeacher: true,
                timestamp: Date.now()
            });
            break;
    }
}

// 處理斷線
function handleDisconnect(ws, id) {
    const connectionInfo = connections.get(ws);
    
    if (connectionInfo) {
        console.log(`[${new Date().toLocaleTimeString()}] 斷線: ${connectionInfo.name} (${id})`);
        
        if (connectionInfo.type === 'student') {
            students.delete(id);
            
            // 如果是當前玩家，停止遊戲
            if (currentPlayer === id) {
                currentPlayer = null;
                gameState.phase = 'idle';
                broadcast({
                    type: 'player_disconnected',
                    playerId: id,
                    timestamp: Date.now()
                });
            }
            
            // 從隊列移除
            playerQueue = playerQueue.filter(sid => sid !== id);
            updateTeacherStudentList();
        } else if (connectionInfo.type === 'teacher') {
            teachers.delete(id);
        }
        
        connections.delete(ws);
    }
}

// 定期清理逾時連線
setInterval(() => {
    connections.forEach((data, ws) => {
        if (ws.readyState === WebSocket.CLOSED) {
            // 清理工作會在 onclose 處理
        }
    });
}, 30000);

// 伺服器狀態監控
setInterval(() => {
    const studentsCount = students.size;
    const teachersCount = teachers.size;
    console.log(`[狀態] 學生: ${studentsCount}, 老師: ${teachersCount}, 當前玩家: ${currentPlayer || '無'}`);
}, 60000);

// 啟動伺服器
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           🎣 釣魚遊戲 WebSocket 伺服器已啟動 🎣              ║
╠════════════════════════════════════════════════════════════╣
║  伺服器端口: ${PORT}                                        ║
║  WebSocket:  ws://localhost:${PORT}                          ║
║  狀態: 等待連線...                                         ║
╚════════════════════════════════════════════════════════════╝
    `);
});

// 處理程序優雅關閉
process.on('SIGINT', () => {
    console.log('\n正在關閉伺服器...');
    
    broadcast({ type: 'server_shutdown' });
    
    wss.close(() => {
        server.close(() => {
            console.log('伺服器已關閉');
            process.exit(0);
        });
    });
});

process.on('SIGTERM', () => {
    console.log('\n收到 SIGTERM 信號，準備關閉...');
    process.exit(0);
});
