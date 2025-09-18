import http from 'k6/http';
import { randomBytes } from 'k6/crypto';

// 配置參數
const MAX_RPS = Number(__ENV.MAX_RPS || 100);
const STEP_DURATION = __ENV.STEP_DURATION || '30s';
const SLEEP_BETWEEN = Number(__ENV.SLEEP_BETWEEN || 3);

// 解析時間字串為秒數的輔助函數
function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  if (typeof duration === 'string') {
    const match = duration.match(/^(\d+)([smh]?)$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2] || 's';
      switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        default: return value;
      }
    }
  }
  return 30; // 預設值
}

// 建立多個 scenarios，每個代表不同的 RPS
const scenarios = {};
function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

const stepDurationSeconds = parseDurationToSeconds(STEP_DURATION);

// 為每個 RPS 等級建立一個 scenario
for (let rps = 1; rps <= MAX_RPS; rps++) {
  // 計算開始時間：前一個 scenario 的結束時間 + 間隔時間
  const startTime = `${(rps - 1) * (stepDurationSeconds + SLEEP_BETWEEN)}s`;
  
  scenarios[`step_${rps}_rps`] = {
    executor: 'constant-arrival-rate',
    startTime: startTime,
    duration: STEP_DURATION,
    rate: rps,
    timeUnit: '1s',
    preAllocatedVUs: 10,
    maxVUs: 500,
    gracefulStop: '0s',
    tags: { step_rps: String(rps), step_id: String(rps) },
  };
}

export const options = { 
  scenarios,
  gracefulStop: '0s',
  // 啟用詳細的 metrics 輸出，包含 scenario 標籤
  systemTags: ['scenario', 'vu', 'iter', 'status'],
};

export default function () {
  // 獲取測試參數
  const TRACESTATE_SIZE = parseInt(__ENV.TRACESTATE_SIZE) || 0;
  const SAMPLE_RATE = __ENV.SAMPLE_RATE ? parseFloat(__ENV.SAMPLE_RATE) : 1.0;
  
  // 生成 trace context
  const rawTraceId = randomBytes(16);
  const traceId = toHex(rawTraceId);
  const rawSpanId = randomBytes(8);
  const spanId = toHex(rawSpanId);
  
  // 依採樣率決定 sampled flag
  const sampled = Math.random() < SAMPLE_RATE;
  const traceFlags = sampled ? "01" : "00";
  const traceHeader = `00-${traceId}-${spanId}-${traceFlags}`;

  // 生成指定大小的 tracestate
  const tracestateContent = generatePreciseTracestate(TRACESTATE_SIZE);

  const gatewayHost = __ENV.GATEWAY_HOST;
  const gatewayPort = __ENV.GATEWAY_PORT;
  const url = `http://${gatewayHost}:${gatewayPort}/`;

  const headers = {
    traceparent: traceHeader,
  };
  
  // 只有當 tracestate 不為空時才添加 header
  if (tracestateContent) {
    headers.tracestate = tracestateContent;
  }

  http.get(url, { headers });
}

// 簡化的 handleSummary，主要用於說明
export function handleSummary(data) {
  const results = {};
  
  // 提供整體統計數據
  const overallMetrics = data.metrics;
  const avgLatencyMs = (overallMetrics.http_req_duration && overallMetrics.http_req_duration.values && overallMetrics.http_req_duration.values.avg) || 0;
  const iterations = (overallMetrics.iterations && overallMetrics.iterations.values && overallMetrics.iterations.values.count) || 0;
  const dropped = (overallMetrics.dropped_iterations && overallMetrics.dropped_iterations.values && overallMetrics.dropped_iterations.values.count) || 0;
  const failedRate = (overallMetrics.http_req_failed && overallMetrics.http_req_failed.values && overallMetrics.http_req_failed.values.rate) || 0;
  const vusMax = (overallMetrics.vus_max && overallMetrics.vus_max.values && overallMetrics.vus_max.values.max) || 0;
  const vus = (overallMetrics.vus && overallMetrics.vus.values && overallMetrics.vus.values.max) || 0;

  // 建立整體結果
  const overallResult = {
    test_type: "multi_scenario_load_test",
    max_rps: MAX_RPS,
    step_duration_seconds: stepDurationSeconds,
    sleep_between_seconds: SLEEP_BETWEEN,
    total_scenarios: MAX_RPS,
    overall_avg_latency_ms: avgLatencyMs,
    total_iterations: iterations,
    overall_vus_observed: vus,
    overall_vus_max_observed: vusMax,
    total_dropped_iterations: dropped,
    overall_failed_rate: failedRate,
    started_at: (data.state && data.state.testRunDurationMs != null) ? Date.now() - data.state.testRunDurationMs : undefined,
    note: "詳細的各 scenario 數據請查看 JSON 輸出文件"
  };

  // 儲存整體結果
  results['out/overall_results.json'] = JSON.stringify(overallResult, null, 2);
  
  // 輸出說明
  results.stdout = `
=== K6 多 Scenarios 壓測完成 ===

✅ 整體測試結果：
- RPS 範圍: 1-${MAX_RPS}
- 總 scenarios: ${MAX_RPS}
- 每個階段持續: ${stepDurationSeconds}s
- 階段間隔: ${SLEEP_BETWEEN}s
- 總 iterations: ${iterations}
- 整體平均延遲: ${avgLatencyMs.toFixed(3)}ms
- 整體失敗率: ${(failedRate * 100).toFixed(2)}%

📁 結果文件：
- 整體統計: out/overall_results.json
- 詳細 JSON 數據: out/metrics.json (包含各 scenario 分別數據)

🔧 後處理：
執行 node analyze_json_output.js 來分析各 scenario 的分別數據
`;
  
  return results;
}
