const WebSocket = require('ws');
const PORT = process.env.PORT || 10000;

const wss = new WebSocket.Server({ port: PORT });

let players = [];
let currentIndex = 0;

function broadcastState() {
  const state = {
    type: 'state',
    currentPlayer: players[currentIndex]?.name || null,
    queue: players.map(p => p.name)
  };
  players.forEach(p => p.ws.send(JSON.stringify(state)));
}

wss.on('connection', ws => {
  ws.on('message', msg => {
    const data = JSON.parse(msg);

    if (data.type === 'join') {
      players.push({ name: data.name, ws });
      broadcastState();
      return;
    }

    const current = players[currentIndex];
    if (!current || ws !== current.ws) return;

    if (data.type === 'control') {
      wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify(data));
        }
      });
    }

    if (data.type === 'endTurn') {
      currentIndex = (currentIndex + 1) % players.length;
      broadcastState();
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.ws !== ws);
    if (currentIndex >= players.length) currentIndex = 0;
    broadcastState();
  });
});

console.log('WebSocket running on port', PORT);
