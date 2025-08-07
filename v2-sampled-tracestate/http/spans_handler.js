const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001; // Port number for the server
const logFilePath = path.join(__dirname, 'data','spans.json');

if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '');
  }
  
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/span') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const span = JSON.parse(body);
          // // console.log('Received span:', span);
  
          fs.appendFile(logFilePath, JSON.stringify(span) + '\n', err => {
            if (err) {
              console.error('Error saving span:', err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Failed to save span' }));
            }
  
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Span saved successfully' }));
          });
        } catch (err) {
          console.error('Error parsing JSON:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(PORT, () => {
    console.log(`Span Handler listening on port ${PORT}`);
  });
  