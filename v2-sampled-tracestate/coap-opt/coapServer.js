const coap = require('coap');
const ISpan = require('../span/iotSpan.js');
const CPUMonitor = require('../cpuMonitor.js');
const config = require('../config.js');

const coapSpanServerIp = config.gateway.ip;
const coapSpanServerPort = config.gateway.ports.coapSpan;

const COAP_PORT = config.server.port;

function sendSpan(span, host = coapSpanServerIp, port = coapSpanServerPort) {
  const req = coap.request({
    hostname: host,
    port: port,
    method: 'POST',
    pathname: '/span',
    confirmable: false,
  });

  const payloadBuffer = Buffer.from(JSON.stringify(span));
  req.write(payloadBuffer);
  req.end();
  console.log("send span to gateway");
}


// // Server B
// const serverB = coap.createServer((req, res) => {
//   if (req.method === 'GET') {
//     console.log(`Server B received request: ${req.url}`);
//     // 回傳模擬數據
//     res.end('Response from Server B');
//   }
// });

// serverB.listen(5684, () => {
//   console.log('Server B is listening on port 5684');
// });

// Server A
const serverA = coap.createServer(async (req, res) => {
  if (req.method === 'GET') {
    let span = new ISpan('IoT-Server-A', req.options.find(option => option.name == '2140').value.toString('hex'), req._packet.token.toString('hex'));
    console.log(`Server A received request: ${req.url}`);
    // req.options.forEach((option) => {
    //     if(option.name == '65000'){
    //         console.log(`Server A received traceparent: ${option.value.toString()}`);
    //     }
    //     else if(option.name == '65001'){
    //         console.log(`Server A received tracestate: ${option.value.toString()}`);
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
    //   console.log(`Server A received response from Server B: ${resB.payload.toString()}`);

    //   // 將 Server B 的回應傳回 Client
    //   res.end(`Server A forwarding response: ${resB.payload.toString()}`);
    // });

    // reqB.end();
    res.end(`Hello http client!`);
    if(span.getFlag() === '01') {
      span.addEndTime();
      span.logSpan();
      sendSpan(span);
    }
  }
});

serverA.listen(COAP_PORT, () => {
  console.log(`Server A is listening on port ${COAP_PORT}`);
});

// === CPU 監控設置 ===
const cpuMonitor = new CPUMonitor('CoAP-Server');
cpuMonitor.start();

// === 程式結束時的處理 ===
process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  
  // 停止 CPU 監控
  cpuMonitor.stop();
  
  // 正式退出
  process.exit();
});
