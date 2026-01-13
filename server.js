const { WebSocketServer } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// Render requires binding to a port provided by environment variable
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Fishing Game Server is Running!');
});

const wss = new WebSocketServer({ server });

// Game State
let displaySocket = null;
const players = new Map(); // Key: Socket, Value: { id, name }
let queue = []; // Array of { id, name, socket }
let currentTurnPlayerId = null;

console.log(`Server started on port ${port}`);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.id = uuidv4(); // Temporary ID until registered

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                // 1. The Main Game Screen connects
                case 'REGISTER_DISPLAY':
                    console.log('Display connected');
                    // Close old display if exists to prevent conflicts
                    if (displaySocket && displaySocket.readyState === 1) {
                        displaySocket.close();
                    }
                    displaySocket = ws;
                    ws.role = 'DISPLAY';
                    
                    // Immediately send current state to display
                    broadcastState();
                    break;

                // 2. A Mobile Controller connects
                case 'REGISTER_CONTROLLER':
                    const playerName = data.payload.name || `P-${ws.id.substr(0,4)}`;
                    console.log(`Player connected: ${playerName}`);
                    
                    ws.role = 'CONTROLLER';
                    ws.playerName = playerName;
                    
                    // Add to players map
                    players.set(ws, { id: ws.id, name: playerName });

                    // Add to queue
                    queue.push({ id: ws.id, name: playerName, socket: ws });

                    // Check if game needs a start
                    checkTurnRotation();
                    
                    // Update everyone
                    broadcastState();
                    break;

                // 3. Game Action (Cast, Reel, Left, Right)
                case 'ACTION':
                    if (ws.role === 'CONTROLLER') {
                        // Only accept actions from the current player
                        if (currentTurnPlayerId === ws.id) {
                            if (displaySocket && displaySocket.readyState === 1) {
                                displaySocket.send(JSON.stringify({
                                    type: 'ACTION',
                                    payload: data.action, // 'LEFT', 'RIGHT', 'CLICK'
                                    player: ws.playerName
                                }));
                            }
                        }
                    }
                    break;
                
                // Keep-alive ping from client (optional, but handled by heartbeat below)
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
            console.log(`Player disconnected: ${ws.playerName}`);
            handlePlayerDisconnect(ws);
        }
    });
});

// Logic to handle player leaving
function handlePlayerDisconnect(ws) {
    // Remove from Players Map
    players.delete(ws);

    // Remove from Queue
    const wasCurrentTurn = (currentTurnPlayerId === ws.id);
    queue = queue.filter(p => p.id !== ws.id);

    // If the active player left, rotate turn
    if (wasCurrentTurn) {
        currentTurnPlayerId = null;
        checkTurnRotation();
    }

    broadcastState();
}

// Logic to rotate turns
function checkTurnRotation() {
    // If nobody is playing and we have people in queue
    if (!currentTurnPlayerId && queue.length > 0) {
        // Pick first in line
        const nextPlayer = queue[0]; // Logic: Winner stays? Or simple rotation? 
        // Let's do simple FIFO: The person at index 0 is playing. 
        // If you want "Pass the pad" style where user plays once then goes to back, logic changes here.
        // Current logic: queue[0] is always the active player.
        
        currentTurnPlayerId = nextPlayer.id;
        console.log(`New turn: ${nextPlayer.name}`);
    } else if (queue.length === 0) {
        currentTurnPlayerId = null;
    }
}

// Send Queue info and Current Player info to everyone
function broadcastState() {
    const queueNames = queue.map(p => p.name);
    const currentPlayerObj = queue.find(p => p.id === currentTurnPlayerId);
    const currentPlayerName = currentPlayerObj ? currentPlayerObj.name : null;

    const msg = JSON.stringify({
        type: 'QUEUE_UPDATE',
        payload: queueNames
    });

    const turnMsg = JSON.stringify({
        type: 'CURRENT_PLAYER',
        payload: currentPlayerName
    });

    // 1. Send to Display
    if (displaySocket && displaySocket.readyState === 1) {
        displaySocket.send(msg);
        displaySocket.send(turnMsg);
    }

    // 2. Send to All Controllers
    players.forEach((info, socket) => {
        if (socket.readyState === 1) {
            socket.send(msg);
            socket.send(turnMsg);
        }
    });
}

// Optional: Rotate turn automatically after X seconds or upon 'GAME_OVER' event from Display
// For now, we assume the player stays until they disconnect or we implement a "DONE" message from Display.

// --- Heartbeat to keep connections alive on Render ---
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
