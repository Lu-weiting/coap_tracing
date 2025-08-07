const http = require('http');
const coap = require('coap');
const Span = require('../span/span.js');
const CPUMonitor = require('../cpuMonitor.js');
const config = require('../config.js');

const serverIp = config.server.ip;
const serverPort = config.server.port;
const tracingBackendIp = config.tracingBackend.ip;
const tracingBackendPort = config.tracingBackend.port;

const HTTP_PORT = config.gateway.ports.http;
const COAP_SPAN_PORT = config.gateway.ports.coapSpan;

function toBinary(text) {
  return Buffer.from(text);
}

function toString(data) {
  return data.toString()
}

coap.registerOption("2076", toBinary, toString) // traceparent
coap.registerOption("2104", toBinary, toString) // tracestate

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
    
    let responseBody = '';
    let span = new Span('Gateway-HTTP', httpReq.headers.traceparent);
    
    // Forward the request to the CoAP server
    const coapReq = coap.request({
      hostname: serverIp,
      port: serverPort,
      method: httpReq.method,
      pathname: httpReq.url,
    });

    // append trace context headers if they are not empty
    if (httpReq.headers.traceparent) {
      coapReq.setOption("2076", span.getTraceParent()); // traceparent
    }
    if (httpReq.headers.tracestate) {
      coapReq.setOption("2104", httpReq.headers.tracestate); // original tracestate appended with new custom tracestate
    }

    coapReq.on('response', (coapRes) => {
      // console.log('get response:', coapRes.payload.toString());
      responseBody = coapRes.payload.toString()
      // Respond to the client
      httpRes.writeHead(200, { 'Content-Type': 'text/plain' });
      httpRes.end(responseBody);
      if(span.getFlag() === '01') {
        span.addEndTime();
        // span.logSpan();
        sendSpan(span);
      }
    });

    coapReq.end();

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
const spanCollector = coap.createServer(async(req, res) => {
  if (req.method === 'POST' && req.url === '/span') {
    const span = JSON.parse(req.payload.toString());
    // console.log('received a span from coap devices:', span);
    sendSpan(span);      
  }
});

spanCollector.listen(COAP_SPAN_PORT, () => {
  // console.log(`Server A is listening on port ${COAP_SPAN_PORT}`);
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
