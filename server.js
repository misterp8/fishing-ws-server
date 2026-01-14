
const { WebSocketServer } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Fishing Game Server (Robust Queue Mode) Running!');
});

const wss = new WebSocketServer({ server });

// --- STATE MANAGEMENT ---
// Players queue: Array of { ws, id, name }
// Index 0 is ALWAYS the active player.
let players = []; 
let displaySocket = null;

console.log(`Server started on port ${port}`);

// --- BROADCAST HELPER ---
function broadcastState() {
    // 1. Prepare Data
    const queueData = players.map(p => ({
        id: p.id,
        name: p.name
    }));

    const activePlayer = players.length > 0 ? players[0] : null;
    
    const payload = {
        queue: queueData,
        activePlayerId: activePlayer ? activePlayer.id : null,
        activePlayerName: activePlayer ? activePlayer.name : null
    };

    const message = JSON.stringify({
        type: 'STATE_UPDATE',
        payload: payload
    });

    // 2. Send to Display
    if (displaySocket && displaySocket.readyState === 1) {
        displaySocket.send(message);
    }

    // 3. Send to Controllers (Also notify them of their own ID confirmation/turn status)
    players.forEach(p => {
        if (p.ws.readyState === 1) {
            p.ws.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    ws.id = uuidv4();
    ws.isAlive = true;
    ws.role = 'UNKNOWN'; // 'DISPLAY' or 'CONTROLLER'

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (rawMessage) => {
        try {
            const data = JSON.parse(rawMessage);

            // --- 1. REGISTRATION ---
            if (data.type === 'REGISTER_DISPLAY') {
                console.log('[CONN] Display Registered');
                // Force close old display connection if exists to prevent ghost inputs
                if (displaySocket && displaySocket !== ws && displaySocket.readyState === 1) {
                    displaySocket.close();
                }
                displaySocket = ws;
                ws.role = 'DISPLAY';
                broadcastState();
                return;
            }

            if (data.type === 'REGISTER_CONTROLLER') {
                const name = data.payload.name || `P-${ws.id.substr(0,4)}`;
                console.log(`[CONN] Player Joined: ${name}`);
                
                ws.role = 'CONTROLLER';
                ws.playerName = name;
                
                // Add to END of queue
                players.push({ ws, id: ws.id, name });
                
                // Send specific registration success to this phone
                ws.send(JSON.stringify({
                    type: 'REGISTERED',
                    payload: { id: ws.id }
                }));

                broadcastState();
                return;
            }

            // --- 2. GAME COMMANDS (DISPLAY ONLY) ---
            
            // NEXT_TURN: The core rotation logic
            if (data.type === 'NEXT_TURN') {
                // Check if sender is display (Relaxed check: allow if it matches displaySocket ref)
                const isDisplay = ws.role === 'DISPLAY' || ws === displaySocket;
                if (!isDisplay) return;

                console.log('[GAME] Next Turn Requested');

                if (players.length > 1) {
                    // ROTATION LOGIC: Move first to last
                    const [first, ...rest] = players;
                    players = [...rest, first];
                    console.log(`[GAME] Queue Rotated. New Leader: ${players[0].name}`);
                } else if (players.length === 1) {
                    console.log('[GAME] Single player mode - staying as leader.');
                } else {
                    console.log('[GAME] Queue empty, cannot rotate.');
                }

                broadcastState();
                return;
            }

            // SET_ACTIVE_PLAYER: Jump queue logic
            if (data.type === 'SET_ACTIVE_PLAYER') {
                const isDisplay = ws.role === 'DISPLAY' || ws === displaySocket;
                if (!isDisplay) return;
                
                const targetId = data.payload;
                console.log(`[GAME] Force Select: ${targetId}`);

                if (targetId) {
                    const idx = players.findIndex(p => p.id === targetId);
                    if (idx > -1) {
                        // Remove from current position
                        const p = players.splice(idx, 1)[0];
                        // Insert at front
                        players.unshift(p);
                    }
                }
                broadcastState();
                return;
            }

            // --- 3. PLAYER ACTIONS (CONTROLLER ONLY) ---
            if (data.type === 'ACTION') {
                if (ws.role !== 'CONTROLLER') return;

                // STRICT CHECK: Is this socket the active player (Index 0)?
                const activePlayer = players[0];
                
                if (activePlayer && activePlayer.id === ws.id) {
                    // Forward to Display
                    if (displaySocket && displaySocket.readyState === 1) {
                        displaySocket.send(JSON.stringify({
                            type: 'ACTION',
                            payload: data.action,
                            player: ws.playerName
                        }));
                    }
                }
                return;
            }

            // --- 4. FEEDBACK (Display -> Controller) ---
            if (data.type === 'FEEDBACK') {
                const isDisplay = ws.role === 'DISPLAY' || ws === displaySocket;
                if (!isDisplay) return;
                
                // Send vibration/feedback only to the ACTIVE player
                if (players.length > 0) {
                    const activePlayer = players[0];
                    if (activePlayer.ws.readyState === 1) {
                        activePlayer.ws.send(JSON.stringify({
                            type: 'FEEDBACK',
                            payload: data.payload
                        }));
                    }
                }
            }

        } catch (e) {
            console.error('Msg Error:', e);
        }
    });

    ws.on('close', () => {
        if (ws.role === 'DISPLAY' || ws === displaySocket) {
            console.log('[CONN] Display Disconnected');
            if (displaySocket === ws) displaySocket = null;
        } 
        
        // Check if it was a player
        const pIndex = players.findIndex(p => p.id === ws.id);
        if (pIndex > -1) {
            const p = players[pIndex];
            console.log(`[CONN] Player Left: ${p.name}`);
            players.splice(pIndex, 1);
            broadcastState();
        }
    });
});

// Keep-alive heartbeat
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(port);
