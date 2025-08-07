const http = require('http');
const Span = require('../span/span.js');
const CPUMonitor = require('../cpuMonitor.js');
const config = require('../config.js');

const serverIp = config.server.ip;
const serverPort = config.server.port;
const tracingBackendIp = config.tracingBackend.ip;
const tracingBackendPort = config.tracingBackend.port;

const HTTP_PORT = config.gateway.ports.http;
const HTTP_SPAN_PORT = config.gateway.ports.httpSpan;

function sendSpan(span, host = tracingBackendIp, port = tracingBackendPort) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(span);

    const options = {
      hostname: host,
      port: port,
      path: '/span',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (err) {
          reject(new Error('Failed to parse response: ' + err.message));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('Request failed: ' + err.message));
    });

    // Send the data
    req.write(data);
    req.end();
    // console.log("send span to spans_handler");
  });
}

// HTTP Client with Trace Context
function httpClient(options, data = null) {
  return new Promise((resolve, reject) => {

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: responseData
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    // Write data if present
    if (data) {
      req.write(data);
    }

    req.end();
  });
}

// Create an HTTP server
const server = http.createServer((httpReq, httpRes) => {
  // console.log('received a request:', httpReq.method, httpReq.url);
  // // console.log('Headers:', httpReq.headers);

  let body = '';

  // Collect request body data
  httpReq.on('data', (chunk) => {
    body += chunk;
  });

  // When request is complete
  httpReq.on('end', () => {
    // // console.log('Body:', body || 'No body');

    let span = new Span('Gateway-HTTP', httpReq.headers.traceparent);

    // Forward the request to the HTTP server
    (async () => {
      const options = {
        hostname: serverIp,
        port: serverPort,
        path: httpReq.url,
        method: httpReq.method,
        headers: httpReq.headers
      };

      try {
        const response = await httpClient(options);
        // console.log('get user function response:', response);
        httpRes.writeHead(200, { 'Content-Type': 'text/plain' });
        httpRes.end(response.body);
        if(span.getFlag() === '01') {
          span.addEndTime();
          // span.logSpan();
          sendSpan(span);
        }
      } catch (error) {
        console.error('Error:', error);
      }
    })();
    
  });

  httpReq.on('error', (err) => {
    console.error('Error receiving request:', err);
  });
});

// Start the server
server.listen(HTTP_PORT, () => {
  console.log(`Server is listening on http://localhost:${HTTP_PORT}`);
});

// Create a CoAP server
const spanCollector = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/span') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const span = JSON.parse(body);
        // console.log('received a span from http devices:', span);
        sendSpan(span);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

spanCollector.listen(HTTP_SPAN_PORT, () => {
  // console.log(`Server A is listening on port ${HTTP_SPAN_PORT}`);
});

// === CPU 監控設置 ===
const cpuMonitor = new CPUMonitor('Gateway');
cpuMonitor.start();

// === 程式結束時的處理 ===
process.on('SIGINT', () => {
  // console.log('Received SIGINT. Shutting down gracefully...');
  
  // 停止 CPU 監控
  cpuMonitor.stop();
  
  // 正式退出
  process.exit();
});
