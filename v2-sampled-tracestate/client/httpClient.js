const http = require('http');
const Span = require('../span/span.js');
const config = require('../config.js');


const gatewayIp = process.env.GATEWAY_IP;
const gatewayPort = config.gateway.ports.http;
const tracingBackendIp = config.tracingBackend.ip;
const tracingBackendPort = config.tracingBackend.port;
const tracestateContent = ''; // Optional, can add custom trace state if needed

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
      console.log("send span to spans_handler");
  });
}

// HTTP Client with Trace Context
function httpClient(options, data = null) {
  return new Promise((resolve, reject) => {
    console.log(process.env.GATEWAY_IP)
    let span = new Span('HTTP Client');

    span.setFlag('01'); // Set flag to indicate this is a client span

    // Merge headers with Trace Context headers
    options.headers = {
      ...options.headers,
      traceparent: span.getTraceParent(),
      tracestate: tracestateContent // Optional, can add custom trace state if needed
    };

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
        if(span.getFlag() === '01') {
          span.addEndTime();
          // span.logSpan();
          sendSpan(span);
        }
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

// Example usage
(async () => {
  const options = {
    hostname: gatewayIp,
    port: gatewayPort,
    path: '/',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await httpClient(options);
    console.log('get user function response:', response);
  } catch (error) {
    console.error('Error:', error);
  }
})();
