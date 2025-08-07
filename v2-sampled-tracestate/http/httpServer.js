const Span = require('../span/span.js');
const CPUMonitor = require('../cpuMonitor.js');
const http = require('http');
const config = require('../config.js');

const httpSpanServerIp = config.gateway.ip;
const httpSpanServerPort = config.gateway.ports.httpSpan;

const HTTP_PORT = config.server.port;

function sendSpan(span, host = httpSpanServerIp, port = httpSpanServerPort) {
  const payload = JSON.stringify(span);

  const options = {
    hostname: host,
    port: port,
    path: '/span',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    res.on('data', () => {});
    res.on('end', () => {});
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.write(payload);
  req.end();
  // console.log("send span to gateway");
}


// // Server B
// const serverB = coap.createServer((req, res) => {
//   if (req.method === 'GET') {
//     // console.log(`Server B received request: ${req.url}`);
//     // 回傳模擬數據
//     res.end('Response from Server B');
//   }
// });

// serverB.listen(5684, () => {
//   // console.log('Server B is listening on port 5684');
// });

// Server A
const serverA = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    let traceparent = req.headers['traceparent'] ? req.headers['traceparent'].toString() : null;
    let span = new Span('IoT-Server-A', traceparent);
    // console.log(`Server A received request: ${req.url}`);
    // req.options.forEach((option) => {
    //     if(option.name == '65000'){
    //         // console.log(`Server A received traceparent: ${option.value.toString( )}`);
    //     }
    //     else if(option.name == '65001'){
    //         // console.log(`Server A received tracestate: ${option.value.toString()}`);
    //     }
    // }); 

    // random delay (300-1000ms)
    // await sleep(Math.floor(Math.random() * (1000 - 300 + 1)) + 300);

    // // 呼叫 Server B
    // const reqB = coap.request({
    //   hostname: 'localhost',
    //   port: 5684,
    //   method: 'GET',
    //   pathname: '/b',
    // });

    // reqB.on('response', (resB) => {
    //   // console.log(`Server A received response from Server B: ${resB.payload.toString()}`);

    //   // 將 Server B 的回應傳回 Client
    //   res.end(`Server A forwarding response: ${resB.payload.toString()}`);
    // });

    // reqB.end();
    res.end(`a`);
    if(span.getFlag() === '01') {
      span.addEndTime();
      // span.logSpan();
      sendSpan(span);
    }
  }
});

serverA.listen(HTTP_PORT, () => {
  // console.log(`Server A is listening on port ${HTTP_PORT}`);
});


// === CPU 監控設置 ===
const cpuMonitor = new CPUMonitor('IoT-Server');
cpuMonitor.start();

// === 程式結束時的處理 ===
process.on('SIGINT', () => {
  // console.log('Received SIGINT. Shutting down gracefully...');
  
  // 停止 CPU 監控
  cpuMonitor.stop();
  
  // 正式退出
  process.exit();
});
