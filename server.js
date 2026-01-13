
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
let currentTurnPlayerId = null;

console.log(`Server started on port ${port}`);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.id = uuidv4(); // Unique ID for every connection

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
                    console.log(`Player connected: ${playerName} (${ws.id})`);
                    
                    ws.role = 'CONTROLLER';
                    ws.playerName = playerName;
                    
                    // Add to players map
                    players.set(ws, { id: ws.id, name: playerName });

                    // Update everyone
                    broadcastState();
                    break;

                // 3. Teacher Selects a Player (Sent from Display)
                case 'SET_ACTIVE_PLAYER':
                    if (ws.role === 'DISPLAY') {
                        const targetId = data.payload; // ID or null
                        currentTurnPlayerId = targetId;
                        console.log(`Teacher selected player ID: ${targetId}`);
                        broadcastState();
                    }
                    break;

                // 4. Game Action (Cast, Reel, Left, Right)
                case 'ACTION':
                    if (ws.role === 'CONTROLLER') {
                        // Only accept actions from the current player
                        if (currentTurnPlayerId === ws.id) {
                            if (displaySocket && displaySocket.readyState === 1) {
                                displaySocket.send(JSON.stringify({
                                    type: 'ACTION',
                                    payload: data.action, // 'LEFT', 'RIGHT', 'CLICK', 'UP', 'DOWN'
                                    player: ws.playerName
                                }));
                            }
                        }
                    }
                    break;
                
                // Keep-alive ping from client
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

    // If the active player left, reset turn
    if (currentTurnPlayerId === ws.id) {
        currentTurnPlayerId = null;
    }

    broadcastState();
}

// Send Player List and Current Player info to everyone
function broadcastState() {
    // Convert Map to Array of objects for the frontend
    const playerList = Array.from(players.values()).map(p => ({
        id: p.id,
        name: p.name
    }));

    // Find the name of the current player for the controllers (who rely on name matching)
    // and for the display to show who is active
    let currentPlayerName = null;
    if (currentTurnPlayerId) {
        // Find player by ID in the values
        const activeObj = playerList.find(p => p.id === currentTurnPlayerId);
        if (activeObj) {
            currentPlayerName = activeObj.name;
        }
    }

    const msg = JSON.stringify({
        type: 'QUEUE_UPDATE',
        payload: playerList // Now sending [{id, name}, ...] instead of just names
    });

    const turnMsg = JSON.stringify({
        type: 'CURRENT_PLAYER',
        payload: currentPlayerName // Sending Name for compatibility with existing controller code
    });
    
    // Also send the ID to the Display so it knows exactly which ID is active
    const turnIdMsg = JSON.stringify({
        type: 'CURRENT_PLAYER_ID',
        payload: currentTurnPlayerId
    });

    // 1. Send to Display
    if (displaySocket && displaySocket.readyState === 1) {
        displaySocket.send(msg);
        displaySocket.send(turnMsg);
        displaySocket.send(turnIdMsg);
    }

    // 2. Send to All Controllers
    players.forEach((info, socket) => {
        if (socket.readyState === 1) {
            socket.send(msg);
            socket.send(turnMsg);
        }
    });
}

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
