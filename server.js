const WebSocket = require('ws');
const http = require('http');

// 建立 HTTP 伺服器
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Fishing WebSocket Server is Running');
});

const wss = new WebSocket.Server({ server });

// 存儲連線的學生資訊
const clients = new Map();
let activeControllerId = null; // 當前擁有控制權的學生 ID

wss.on('connection', (ws) => {
    ws.id = Math.random().toString(36).substr(2, 9);
    console.log(`Client connected: ${ws.id}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // 處理學生加入
            if (data.type === 'JOIN_STUDENT') {
                const student = {
                    id: ws.id,
                    name: data.name || `Student ${ws.id.substr(0,4)}`,
                    role: 'student',
                    ws: ws
                };
                clients.set(ws.id, student);
                broadcastStudentList();
            }
            
            // 處理教師端確認身分
            else if (data.type === 'JOIN_TEACHER') {
                const teacher = {
                    id: ws.id,
                    name: 'Teacher',
                    role: 'teacher',
                    ws: ws
                };
                clients.set(ws.id, teacher);
                broadcastStudentList(); 
            }

            // 處理教師選擇學生
            else if (data.type === 'GRANT_CONTROL' && data.targetId) {
                revokeCurrentControl(); 
                activeControllerId = data.targetId;
                
                const targetStudent = clients.get(activeControllerId);
                if (targetStudent && targetStudent.ws.readyState === WebSocket.OPEN) {
                    targetStudent.ws.send(JSON.stringify({ type: 'CONTROL_GRANTED' }));
                    console.log(`Control granted to ${targetStudent.name}`);
                }
                broadcastStudentList();
            }

            // 處理收回控制權
            else if (data.type === 'REVOKE_CONTROL') {
                console.log("Teacher requested REVOKE_CONTROL");
                
                // 1. 清除 Server 端的控制者 ID
                if (activeControllerId) {
                    const student = clients.get(activeControllerId);
                    if (student && student.ws.readyState === WebSocket.OPEN) {
                        student.ws.send(JSON.stringify({ type: 'CONTROL_REVOKED' }));
                        console.log(`Notified ${student.name} of revocation`);
                    }
                    activeControllerId = null;
                }
                // 2. 廣報最新的學生列表給老師 (這會讓前端 UI 更新)
                broadcastStudentList();
                
                // [新增] 3. 廣報一個「控制權已收回」的通知給老師 (確保前端同步)
                // 這是雙重保險，防止前端 UI 沒更新
                broadcastToTeachers({ type: 'CONTROL_REVOKED_CONFIRM' });
            }

            // [修改重點] 轉發遊戲狀態更新給指定學生 (解決咬餌震動問題)
            else if (data.type === 'GAME_STATE_UPDATE' && data.targetId) {
                const targetClient = clients.get(data.targetId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify(data));
                }
            }

            // 轉發學生的遊戲操作給教師端
            else if (data.type === 'GAME_ACTION') {
                if (ws.id === activeControllerId) {
                    broadcastToTeachers(data);
                }
            }

        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ws.id}`);
        if (ws.id === activeControllerId) {
            activeControllerId = null;
        }
        clients.delete(ws.id);
        broadcastStudentList();
    });
});

function revokeCurrentControl() {
    if (activeControllerId) {
        const student = clients.get(activeControllerId);
        if (student && student.ws.readyState === WebSocket.OPEN) {
            student.ws.send(JSON.stringify({ type: 'CONTROL_REVOKED' }));
        }
        activeControllerId = null;
    }
}

function broadcastStudentList() {
    const studentList = [];
    clients.forEach((client) => {
        if (client.role === 'student') {
            studentList.push({
                id: client.id,
                name: client.name,
                isActive: (client.id === activeControllerId)
            });
        }
    });

    const message = JSON.stringify({ type: 'STUDENT_LIST', list: studentList });
    
    // 只發送給老師
    clients.forEach((client) => {
        if (client.role === 'teacher' && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

function broadcastToTeachers(data) {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.role === 'teacher' && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket Server is running on port ${PORT}`);
});
