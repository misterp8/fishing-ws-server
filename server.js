const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

let teacherSocket = null;
let students = {}; // { id: ws }

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substr(2, 9);
    ws.id = id;
    console.log(`Client connected: ${id}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'TEACHER_HELLO') {
                teacherSocket = ws;
                console.log("Teacher connected");
            }
            if (data.type === 'JOIN') {
                ws.studentName = data.name;
                console.log(`Student: ${data.name}`);
                if (teacherSocket) {
                    teacherSocket.send(JSON.stringify({ type: 'UPDATE_LIST', students: getStudentList() }));
                }
            }
            if (data.type === 'GRANT') {
                const target = students[data.studentId];
                if (target) {
                    target.send(JSON.stringify({ type: data.granted ? 'CONTROL_GRANTED' : 'CONTROL_REVOKED' }));
                    teacherSocket.send(JSON.stringify({ type: 'UPDATE_LIST', students: getStudentList() }));
                }
            }
            if (data.type === 'INPUT_CMD') {
                if (students[id] && students[id].isAllowed) {
                    if (teacherSocket) {
                        teacherSocket.send(JSON.stringify({ type: 'REMOTE_INPUT', cmd: data.cmd, name: ws.studentName }));
                    }
                }
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        delete students[id];
        if (teacherSocket) teacherSocket.send(JSON.stringify({ type: 'UPDATE_LIST', students: getStudentList() }));
    });
});

function getStudentList() {
    return Object.keys(students).map(sid => ({
        id: sid,
        name: students[sid].studentName,
        allowed: students[sid].isAllowed || false
    }));
}

console.log("WebSocket Server running on port 8080");
