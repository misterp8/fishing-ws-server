const WebSocket = require('ws');
const http = require('http');

// 建立 HTTP 伺服器 (這只是為了符合 Render.com 的標準 WebSocket 部署需求)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Fishing WebSocket Server is Running');
});

const wss = new WebSocket.Server({ server });

// 存儲連線的學生資訊
// 結構: { id: ws.id, name: "Student Name", role: 'student' | 'teacher', ws: ws }
const clients = new Map();
let activeControllerId = null; // 當前擁有控制權的學生 ID

wss.on('connection', (ws) => {
    // 生成唯一 ID
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
            
            // 處理教師端確認身分 (簡單的第一個連線視為教師或特定標記)
            else if (data.type === 'JOIN_TEACHER') {
                const teacher = {
                    id: ws.id,
                    name: 'Teacher',
                    role: 'teacher',
                    ws: ws
                };
                clients.set(ws.id, teacher);
                // 更新教師那邊的列表
                broadcastStudentList(); 
            }

            // 處理教師選擇學生
            else if (data.type === 'GRANT_CONTROL' && data.targetId) {
                revokeCurrentControl(); // 先收回舊控制權
                activeControllerId = data.targetId;
                
                const targetStudent = clients.get(activeControllerId);
                if (targetStudent && targetStudent.ws.readyState === WebSocket.OPEN) {
                    targetStudent.ws.send(JSON.stringify({ type: 'CONTROL_GRANTED' }));
                    console.log(`Control granted to ${targetStudent.name}`);
                }
                broadcastStudentList();
            }

            // 處理收回控制權 (遊戲結束或手動收回)
            else if (data.type === 'REVOKE_CONTROL') {
                revokeCurrentControl();
                broadcastStudentList();
            }

            // 轉發學生的遊戲操作給教師端
            else if (data.type === 'GAME_ACTION') {
                // 只有擁有控制權的學生才能操作
                if (ws.id === activeControllerId) {
                    // 廣播給教師端
                    broadcastToTeachers(data); // <--- 這裡已修正
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
