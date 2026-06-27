// services/sse.js
// Server-Sent Events 廣播管理

const clients = new Set();

function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 保持連線心跳
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  clients.add(res);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, clientCount };
