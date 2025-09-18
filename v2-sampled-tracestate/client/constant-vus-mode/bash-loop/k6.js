import http from "k6/http";
import { check } from "k6";
import { randomBytes } from "k6/crypto";

// 環境變數配置
const TRACESTATE_SIZE = parseInt(__ENV.TRACESTATE_SIZE) || 0; // bytes
const GATEWAY_HOST = __ENV.GATEWAY_HOST || "localhost";
const GATEWAY_PORT = __ENV.GATEWAY_PORT || "3000";
const TARGET_VUS = parseInt(__ENV.TARGET_VUS) || 50; // 從飽和點測試得出的VU數量
const SAMPLE_RATE = __ENV.SAMPLE_RATE ? parseFloat(__ENV.SAMPLE_RATE) : 1.0; // 1.0 = 100%
const TEST_DURATION = "30s";

// 計算字串的 UTF-8 字節長度 (k6 相容版本)
function getStringByteLength(str) {
  // 在 k6 中，我們可以使用 Buffer 或直接計算 ASCII 字元
  // 由於我們的 tracestate 只包含 ASCII 字元，每個字元就是 1 byte
  return str.length;
}

// 生成精確大小的 tracestate 資料
function generatePreciseTracestate(targetSize) {
  if (targetSize === 0) return '';
  
  let result = '';
  let currentSize = 0;
  let pairIndex = 1;
  
  while (currentSize < targetSize) {
    const pair = `k${pairIndex}=v${String(pairIndex).padStart(3, '0')}`;
    const pairSize = getStringByteLength(pair);
    
    // 檢查添加這個 pair 是否會超過目標大小
    if (currentSize + pairSize + (result.length > 0 ? 1 : 0) <= targetSize) {
      if (result.length > 0) result += ',';
      result += pair;
      currentSize = getStringByteLength(result);
    } else {
      // 如果會超過，用填充字元補足
      const remaining = targetSize - currentSize;
      if (remaining > 0) {
        result += 'x'.repeat(remaining);
      }
      break;
    }
    pairIndex++;
  }
  
  return result;
}

// 預定義的 tracestate 測試資料，以 128 bytes 為間隔到 1024 bytes
const TRACESTATE_DATA = {
  0: '',
  32: generatePreciseTracestate(32),
  64: generatePreciseTracestate(64),
  128: generatePreciseTracestate(128),
  192: generatePreciseTracestate(192),
  256: generatePreciseTracestate(256),
  320: generatePreciseTracestate(320),
  384: generatePreciseTracestate(384),
  448: generatePreciseTracestate(448),
  512: generatePreciseTracestate(512),
  576: generatePreciseTracestate(576),
  640: generatePreciseTracestate(640),
  704: generatePreciseTracestate(704),
  768: generatePreciseTracestate(768),
  832: generatePreciseTracestate(832),
  896: generatePreciseTracestate(896),
  960: generatePreciseTracestate(960),
  1024: generatePreciseTracestate(1024),
  1088: generatePreciseTracestate(1088),
  1152: generatePreciseTracestate(1152),
  1216: generatePreciseTracestate(1216),
  1248: generatePreciseTracestate(1248),
  1280: generatePreciseTracestate(1280),
  1408: generatePreciseTracestate(1408),
  1536: generatePreciseTracestate(1536),
  1664: generatePreciseTracestate(1664),
  1792: generatePreciseTracestate(1792),
  2048: generatePreciseTracestate(2048),
  4096: generatePreciseTracestate(4096),
  8192: generatePreciseTracestate(8192),
  10240: generatePreciseTracestate(10240),
  16384: generatePreciseTracestate(16384),
};

// 生成16進制字符串
function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const options = {
  gracefulStop: '0s',
  scenarios: {
    constant_load_test: {
      executor: "constant-vus",
      vus: TARGET_VUS,
      duration: TEST_DURATION,
      gracefulStop: '0s',
    },
  },
};

export default function () {
  // 生成trace context
  const traceId = toHex(randomBytes(16));
  const spanId = toHex(randomBytes(8));
  // 依採樣率決定 sampled flag
  const sampled = Math.random() < SAMPLE_RATE;
  const traceFlags = sampled ? "01" : "00";

  const traceHeader = `00-${traceId}-${spanId}-${traceFlags}`;
  const tracestateContent = TRACESTATE_DATA[TRACESTATE_SIZE] || '';
  
  // 構建請求URL
  const url = `http://${GATEWAY_HOST}:${GATEWAY_PORT}/`;
  
  // 發送請求
  http.get(url, {
    headers: {
      traceparent: traceHeader,
      tracestate: tracestateContent,
    },
  });
  
  // // 檢查響應狀態
  // check(response, {
  //   "status is 200": (r) => r.status === 200,
  // });
}

// 測試開始時的設置
// export function setup() {
//   // 驗證 tracestate 大小
//   const actualSize = getStringByteLength(TRACESTATE_DATA[TRACESTATE_SIZE] || '');
  
//   console.log(`=== 測試配置 ===`);
//   console.log(`實際 Tracestate Size: ${actualSize} bytes`);
//   // console.log(`Tracestate Content: '${TRACESTATE_DATA[TRACESTATE_SIZE] || ''}'`);
//   console.log(`Target VUs: ${TARGET_VUS}`);
//   console.log(`Test Duration: ${TEST_DURATION}`);
//   console.log(`Target: ${GATEWAY_HOST}:${GATEWAY_PORT}`);
//   console.log(`==================`);
  
//   return {};
// }

// 產出你要的欄位；同時輸出成「單段 JSON」與「stdout 單行 CSV」
export function handleSummary(data) {
  // k6 metrics 的正確訪問方式
  const avgLatencyMs = (data.metrics.http_req_duration && data.metrics.http_req_duration.values && data.metrics.http_req_duration.values.avg) || 0;
  const iterations = (data.metrics.iterations && data.metrics.iterations.values && data.metrics.iterations.values.count) || 0;
  const dropped = (data.metrics.dropped_iterations && data.metrics.dropped_iterations.values && data.metrics.dropped_iterations.values.count) || 0;
  const failedRate = (data.metrics.http_req_failed && data.metrics.http_req_failed.values && data.metrics.http_req_failed.values.rate) || 0; 
  const vusMax =
    (data.metrics.vus_max && data.metrics.vus_max.values && data.metrics.vus_max.values.max) ||
    (data.metrics.vus_max && data.metrics.vus_max.values && data.metrics.vus_max.values.value) ||
    0;
  const vus =
    (data.metrics.vus && data.metrics.vus.values && data.metrics.vus.values.max) || 
    (data.metrics.vus && data.metrics.vus.values && data.metrics.vus.values.value) || 0;

  const row = [
    __ENV.RATE || "",
    avgLatencyMs.toFixed(3),
    iterations,
    vus,
    vusMax,
    dropped,
    failedRate.toFixed(6),
  ].join(",");

  const obj = {
    step_rps: Number(__ENV.RATE || 0),
    avg_latency_ms: avgLatencyMs,
    iterations,
    vus_observed: vus,
    vus_max_observed: vusMax,
    dropped_iterations: dropped,
    failed_rate: failedRate,
    started_at:
      (data.state && data.state.testRunDurationMs != null)
        ? Date.now() - data.state.testRunDurationMs
        : undefined,
  };

  return {
    // 每段存一份 JSON（方便追蹤）
    [`tracestate-sample-out/step_${__ENV.TRACESTATE_SIZE || "NA"}_${__ENV.SAMPLE_RATE || "NA"}.json`]: JSON.stringify(obj, null, 2),
    // 也把單段的彙總以「一行」CSV 印到 stdout，外層殼層會 append 起來
    stdout: row + "\n",
  };
}
