/**
 * 釣魚遊戲 WebSocket 伺服器
 * - 管理學生連線
 - 控制權分配
 * - 遊戲狀態同步
 */

const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🎣 Fishing Game WebSocket Server\n');
});

const wss = new WebSocket.Server({ server });

const connections = new Map(); // ws -> { id, name, type }
const students = new Map();    // studentId -> { ws, name, isPlaying, hasPlayed }
const gameHost = null;         // 老師端的 WebSocket
let currentController = null;  // 當前有控制權的學生 ID

function generateId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getStudentList() {
    const list = [];
    students.forEach((data, id) => {
        list.push({
            id: id,
            name: data.name,
            isPlaying: data.isPlaying,
            hasPlayed: data.hasPlayed
        });
    });
    return list;
}

function broadcastToTeacher(message) {
    if (gameHost && gameHost.readyState === WebSocket.OPEN) {
        gameHost.send(JSON.stringify(message));
    }
}

function broadcastToController(message) {
    if (currentController && students.has(currentController)) {
        const student = students.get(currentController);
        if (student.ws.readyState === WebSocket.OPEN) {
            student.ws.send(JSON.stringify(message));
        }
    }
}

function broadcastToAll(message) {
    const msgStr = JSON.stringify(message);
    connections.forEach((data, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msgStr);
        }
    });
}

wss.on('connection', (ws) => {
    const id = generateId();
    const connInfo = { id, type: null, name: '' };
    connections.set(ws, connInfo);
    
    console.log(`[${new Date().toLocaleTimeString()}] 新連線: ${id}`);
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handleMessage(ws, id, msg);
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
    
    ws.send(JSON.stringify({
        type: 'connected',
        yourId: id,
        timestamp: Date.now()
    }));
});

function handleMessage(ws, id, msg) {
    console.log(`[${id}] ${msg.type}`);
    
    switch (msg.type) {
        case 'register':
            handleRegister(ws, id, msg);
            break;
            
        case 'request_control':
            handleRequestControl(ws, id);
            break;
            
        case 'game_action':
            handleGameAction(id, msg);
            break;
            
        case 'teacher_grant':
            handleTeacherGrant(ws, id, msg);
            break;
            
        case 'teacher_release':
            handleTeacherRelease(ws, id);
            break;
            
        case 'student_disconnect':
            handleStudentDisconnect(ws, id);
            break;
    }
}

function handleRegister(ws, id, msg) {
    const { role, name } = msg;
    const connInfo = connections.get(ws);
    
    if (role === 'teacher') {
        connInfo.type = 'teacher';
        connInfo.name = name || '老師';
        console.log(`老師 "${connInfo.name}" 已連線`);
        
        ws.send(JSON.stringify({
            type: 'teacher_registered',
            students: getStudentList(),
            currentController: currentController
        }));
        
    } else if (role === 'student') {
        connInfo.type = 'student';
        connInfo.name = name || `學生_${id}`;
        
        students.set(id, {
            ws: ws,
            name: connInfo.name,
            isPlaying: false,
            hasPlayed: false
        });
        
        console.log(`學生 "${connInfo.name}" (${id}) 已連線`);
        
        ws.send(JSON.stringify({
            type: 'student_registered',
            yourId: id,
            waiting: currentController !== null
        }));
        
        broadcastToTeacher({
            type: 'student_list',
            students: getStudentList()
        });
    }
}

function handleRequestControl(ws, id) {
    if (currentController !== null) {
        ws.send(JSON.stringify({
            type: 'control_busy',
            currentController: currentController
        }));
        return;
    }
    
    const student = students.get(id);
    if (!student) return;
    
    currentController = id;
    student.isPlaying = true;
    
    ws.send(JSON.stringify({
        type: 'control_granted'
    }));
    
    broadcastToTeacher({
        type: 'control_started',
        studentId: id,
        studentName: student.name
    });
    
    broadcastToAll({
        type: 'now_playing',
        studentName: student.name
    });
    
    console.log(`控制權給予 ${student.name}`);
}

function handleGameAction(id, msg) {
    if (id !== currentController) return;
    
    broadcastToTeacher({
        type: 'game_action',
        fromStudent: id,
        action: msg.action,
        data: msg.data,
        timestamp: Date.now()
    });
}

function handleTeacherGrant(ws, id, msg) {
    if (connections.get(ws)?.type !== 'teacher') return;
    
    const targetId = msg.studentId;
    const student = students.get(targetId);
    
    if (!student) return;
    
    // 先釋放當前控制權
    if (currentController !== null) {
        const current = students.get(currentController);
        if (current) {
            current.isPlaying = false;
            current.hasPlayed = true;
        }
    }
    
    currentController = targetId;
    student.isPlaying = true;
    
    // 通知被選中的學生
    student.ws.send(JSON.stringify({
        type: 'control_granted'
    }));
    
    broadcastToTeacher({
        type: 'control_started',
        studentId: targetId,
        studentName: student.name
    });
    
    broadcastToAll({
        type: 'now_playing',
        studentName: student.name
    });
    
    console.log(`老師指定 ${student.name} 控制遊戲`);
    
    broadcastToTeacher({
        type: 'student_list',
        students: getStudentList()
    });
}

function handleTeacherRelease(ws, id) {
    if (connections.get(ws)?.type !== 'teacher') return;
    
    if (currentController !== null) {
        const student = students.get(currentController);
        if (student) {
            student.isPlaying = false;
            student.hasPlayed = true;
            student.ws.send(JSON.stringify({
                type: 'control_released'
            }));
        }
        
        broadcastToTeacher({
            type: 'control_stopped',
            studentId: currentController
        });
        
        broadcastToAll({
            type: 'game_paused'
        });
        
        console.log(`老師釋放控制權`);
        currentController = null;
        
        broadcastToTeacher({
            type: 'student_list',
            students: getStudentList()
        });
    }
}

function handleStudentDisconnect(ws, id) {
    if (students.has(id)) {
        students.delete(id);
        
        if (currentController === id) {
            currentController = null;
            broadcastToAll({
                type: 'controller_disconnected'
            });
        }
        
        broadcastToTeacher({
            type: 'student_list',
            students: getStudentList()
        });
    }
}

function handleDisconnect(ws, id) {
    const connInfo = connections.get(ws);
    
    if (connInfo) {
        console.log(`斷線: ${connInfo.name} (${id})`);
        
        if (connInfo.type === 'student') {
            handleStudentDisconnect(ws, id);
        }
        
        connections.delete(ws);
    }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║         🎣 釣魚遊戲 WebSocket 伺服器 🎣            ║
╠═══════════════════════════════════════════════════╣
║  埠: ${PORT}                                          ║
║  WebSocket: ws://localhost:${PORT}                    ║
╚═══════════════════════════════════════════════════╝
    `);
});

process.on('SIGINT', () => {
    console.log('\n正在關閉伺服器...');
    broadcastToAll({ type: 'server_shutdown' });
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});
