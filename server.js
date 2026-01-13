
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
let currentTurnPlayerName = null; // Track Name to allow reconnection/hijacking

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
                    if (displaySocket && displaySocket.readyState === 1) {
                        displaySocket.close();
                    }
                    displaySocket = ws;
                    ws.role = 'DISPLAY';
                    broadcastState();
                    break;

                // 2. A Mobile Controller connects
                case 'REGISTER_CONTROLLER':
                    const playerName = data.payload.name || `P-${ws.id.substr(0,4)}`;
                    console.log(`Player connected: ${playerName} (${ws.id})`);
                    
                    ws.role = 'CONTROLLER';
                    ws.playerName = playerName;
                    players.set(ws, { id: ws.id, name: playerName });

                    // --- ROBUST RECONNECT LOGIC (Name Hijacking) ---
                    // If the game is waiting for "Bob", and "Bob" connects (new ID),
                    // update the turn ID to this new socket so they can play immediately.
                    if (currentTurnPlayerName && playerName === currentTurnPlayerName) {
                        console.log(`♻️ RECONNECT: ${playerName} rejoined. Transferring control to new ID ${ws.id}`);
                        currentTurnPlayerId = ws.id;
                    }

                    // Tell the controller its ID
                    ws.send(JSON.stringify({
                        type: 'REGISTERED',
                        payload: { id: ws.id }
                    }));

                    broadcastState();
                    break;

                // 3. Teacher Selects a Player
                case 'SET_ACTIVE_PLAYER':
                    if (ws.role === 'DISPLAY') {
                        const targetId = data.payload; // ID or null
                        currentTurnPlayerId = targetId;
                        
                        // Update the cached Name
                        if (targetId) {
                            // Find the player object to get the name
                            let found = false;
                            for (let [socket, p] of players) {
                                if (p.id === targetId) {
                                    currentTurnPlayerName = p.name;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) currentTurnPlayerName = null; // Should not happen usually
                        } else {
                            currentTurnPlayerName = null;
                        }

                        console.log(`Teacher selected: ${currentTurnPlayerName} (${currentTurnPlayerId})`);
                        broadcastState();
                    }
                    break;

                // 4. Game Action
                case 'ACTION':
                    if (ws.role === 'CONTROLLER') {
                        // Strict ID check, but Reconnect Logic makes this safe
                        if (currentTurnPlayerId === ws.id) {
                            if (displaySocket && displaySocket.readyState === 1) {
                                displaySocket.send(JSON.stringify({
                                    type: 'ACTION',
                                    payload: data.action, 
                                    player: ws.playerName
                                }));
                                console.log(`Action forwarded: ${data.action} from ${ws.playerName}`);
                            }
                        } else {
                            // Debugging for "Green Screen but No Control"
                            console.warn(`Blocked action from ${ws.playerName} (${ws.id}). Expecting: ${currentTurnPlayerId}`);
                            
                            // Edge Case Recovery:
                            // If IDs don't match, but Names DO, force an update (Self-healing)
                            if (currentTurnPlayerName && ws.playerName === currentTurnPlayerName) {
                                console.log("⚠️ Self-Healing: Name match detected on blocked action. Updating ID.");
                                currentTurnPlayerId = ws.id;
                                // Retry sending action? No, just let the next one succeed.
                                broadcastState();
                            }
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
            console.log(`Player disconnected: ${ws.playerName}`);
            players.delete(ws);
            
            // NOTE: Do NOT set currentTurnPlayerId to null immediately.
            // This allows the user to refresh the page and "reclaim" their spot via Name Hijacking.
            // The teacher can manually deselect if needed.
            
            broadcastState();
        }
    });
});

function broadcastState() {
    const playerList = Array.from(players.values()).map(p => ({
        id: p.id,
        name: p.name
    }));

    const msg = JSON.stringify({
        type: 'QUEUE_UPDATE',
        payload: playerList 
    });

    // Send Name (Legacy/Visual)
    const turnMsg = JSON.stringify({
        type: 'CURRENT_PLAYER',
        payload: currentTurnPlayerName 
    });
    
    // Send ID (Logic)
    const turnIdMsg = JSON.stringify({
        type: 'CURRENT_PLAYER_ID',
        payload: currentTurnPlayerId
    });

    if (displaySocket && displaySocket.readyState === 1) {
        displaySocket.send(msg);
        displaySocket.send(turnMsg);
        displaySocket.send(turnIdMsg);
    }

    players.forEach((info, socket) => {
        if (socket.readyState === 1) {
            socket.send(msg);
            socket.send(turnMsg);
            socket.send(turnIdMsg);
        }
    });
}

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
