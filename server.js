
const { WebSocketServer } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Fishing Game Server (Strict Queue Mode) Running!');
});

const wss = new WebSocketServer({ server });

let displaySocket = null;
// Players is now an ARRAY to enforce order.
// { ws: socket, id: string, name: string }
let players = []; 

console.log(`Server started on port ${port}`);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.id = uuidv4(); 

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'REGISTER_DISPLAY':
                    console.log('Display connected');
                    if (displaySocket && displaySocket.readyState === 1) {
                        displaySocket.close();
                    }
                    displaySocket = ws;
                    ws.role = 'DISPLAY';
                    broadcastState();
                    break;

                case 'REGISTER_CONTROLLER':
                    const playerName = data.payload.name || `P-${ws.id.substr(0,4)}`;
                    console.log(`Player Join: ${playerName}`);
                    
                    ws.role = 'CONTROLLER';
                    ws.playerName = playerName;
                    
                    // Add to end of queue
                    players.push({ ws, id: ws.id, name: playerName });

                    // Tell controller its ID
                    ws.send(JSON.stringify({
                        type: 'REGISTERED',
                        payload: { id: ws.id }
                    }));

                    broadcastState();
                    break;

                case 'SET_ACTIVE_PLAYER':
                    if (ws.role === 'DISPLAY') {
                        const targetId = data.payload;
                        console.log(`Teacher requested: ${targetId}`);
                        
                        if (targetId) {
                            const index = players.findIndex(p => p.id === targetId);
                            if (index > -1) {
                                // MOVE TO FRONT (Jump Queue)
                                const p = players.splice(index, 1)[0];
                                players.unshift(p);
                                console.log(`Moved ${p.name} to front of queue.`);
                            }
                        }
                        broadcastState();
                    }
                    break;

                case 'ACTION':
                    if (ws.role === 'CONTROLLER') {
                        // Strict Rule: Only Index 0 can play
                        const activePlayer = players[0];
                        
                        if (activePlayer && activePlayer.id === ws.id) {
                            console.log(`Action accepted from leader: ${ws.playerName}`);
                            if (displaySocket && displaySocket.readyState === 1) {
                                displaySocket.send(JSON.stringify({
                                    type: 'ACTION',
                                    payload: data.action, 
                                    player: ws.playerName
                                }));
                            }
                        } else {
                            // Debugging
                            const rank = players.findIndex(p => p.id === ws.id);
                            console.log(`Ignored action from Rank ${rank} (${ws.playerName}). Leader is ${activePlayer?.name}`);
                        }
                    }
                    break;
                
                // NEW: Handle Feedback (Vibration) from Display -> Active Controller
                case 'FEEDBACK':
                    if (ws.role === 'DISPLAY') {
                        const activePlayer = players[0];
                        if (activePlayer && activePlayer.ws.readyState === 1) {
                            activePlayer.ws.send(JSON.stringify({
                                type: 'FEEDBACK',
                                payload: data.payload // 'VIBRATE_START' or 'VIBRATE_STOP'
                            }));
                        }
                    }
                    break;

                case 'PING':
                    ws.send(JSON.stringify({ type: 'PONG' }));
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        if (ws.role === 'DISPLAY') {
            console.log('Display disconnected');
            displaySocket = null;
        } else if (ws.role === 'CONTROLLER') {
            console.log(`Player Left: ${ws.playerName}`);
            // Remove from queue
            players = players.filter(p => p.ws !== ws);
            broadcastState();
        }
    });
});

function broadcastState() {
    // 1. Queue Update
    const queueList = players.map(p => ({
        id: p.id,
        name: p.name
    }));

    // 2. Who is active? ALWAYS index 0
    const activePlayer = players.length > 0 ? players[0] : null;
    const activeId = activePlayer ? activePlayer.id : null;
    const activeName = activePlayer ? activePlayer.name : null;

    const msgQueue = JSON.stringify({ type: 'QUEUE_UPDATE', payload: queueList });
    const msgTurnId = JSON.stringify({ type: 'CURRENT_PLAYER_ID', payload: activeId });
    const msgTurnName = JSON.stringify({ type: 'CURRENT_PLAYER', payload: activeName });

    // Send to Display
    if (displaySocket && displaySocket.readyState === 1) {
        displaySocket.send(msgQueue);
        displaySocket.send(msgTurnId);
        displaySocket.send(msgTurnName);
    }

    // Send to Controllers
    players.forEach(p => {
        if (p.ws.readyState === 1) {
            p.ws.send(msgQueue);
            p.ws.send(msgTurnId);
            p.ws.send(msgTurnName);
        }
    });
}

// Heartbeat
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', function close() {
    clearInterval(interval);
});

server.listen(port);
