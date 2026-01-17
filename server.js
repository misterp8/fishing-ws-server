const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let teacherWs = null;
let students = {}; // { id: { ws, name } }

console.log(`WebSocket Server is running on port ${PORT}`);

wss.on('connection', (ws) => {
    let id = null;
    let role = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'teacher_join':
                    // 如果已有老師，斷開舊連線 (或可設定為允許多個老師，這裡簡化為單一老師)
                    if (teacherWs && teacherWs !== ws) {
                        teacherWs.send(JSON.stringify({ type: 'force_logout' }));
                        teacherWs.close();
                    }
                    teacherWs = ws;
                    role = 'TEACHER';
                    console.log('Teacher connected');
                    // 發送當前學生列表給老師
                    ws.send(JSON.stringify({ 
                        type: 'update_students', 
                        students: Object.values(students).map(s => ({ id: s.id, name: s.name }))
                    }));
                    break;

                case 'student_join':
                    id = data.id || Math.random().toString(36).substr(2, 9);
                    role = 'STUDENT';
                    students[id] = { ws, name: data.name, id };
                    
                    if (teacherWs && teacherWs.readyState === WebSocket.OPEN) {
                        teacherWs.send(JSON.stringify({ 
                            type: 'student_connected', 
                            student: { id, name: data.name } 
                        }));
                    }
                    // 確認連線給學生
                    ws.send(JSON.stringify({ type: 'connected', id }));
                    console.log(`Student ${data.name} connected`);
                    break;

                case 'transfer_control':
                    // 老師選擇學生
                    if (role === 'TEACHER' && teacherWs === ws) {
                        const targetId = data.studentId;
                        
                        // 通知所有學生
                        Object.values(students).forEach(s => {
                            if (s.ws.readyState === WebSocket.OPEN) {
                                const isActive = (s.id === targetId);
                                s.ws.send(JSON.stringify({ 
                                    type: 'control_update', 
                                    active: isActive 
                                }));
                                
                                if (isActive) {
                                    // 觸發震動
                                    s.ws.send(JSON.stringify({ type: 'vibrate' }));
                                }
                            }
                        });
                        
                        // 更新老師端 UI 狀態 (廣播回老師確認)
                        ws.send(JSON.stringify({ type: 'control_sync', studentId: targetId }));
                    }
                    break;

                case 'action':
                    // 學生發送動作 (aim, interact)
                    if (role === 'STUDENT' && students[id]) {
                        // 轉發給老師
                        if (teacherWs && teacherWs.readyState === WebSocket.OPEN) {
                            teacherWs.send(JSON.stringify({
                                type: 'student_action',
                                action: data.action,
                                payload: data.payload
                            }));
                        }
                    }
                    break;
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });

    ws.on('close', () => {
        if (role === 'TEACHER' && teacherWs === ws) {
            teacherWs = null;
            console.log('Teacher disconnected');
        } else if (role === 'STUDENT' && id) {
            delete students[id];
            if (teacherWs && teacherWs.readyState === WebSocket.OPEN) {
                teacherWs.send(JSON.stringify({ type: 'student_disconnected', id }));
            }
            console.log(`Student ${id} disconnected`);
        }
    });
});
