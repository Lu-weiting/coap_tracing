import http from "k6/http";
import { randomBytes } from "k6/crypto";
export const options = {
  gracefulStop: "0s",
  scenarios: {
    step: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE),
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 10,
      maxVUs: 1000,
      tags: { step_rps: String(__ENV.RATE), step_id: String(__ENV.STEP_ID) },
      gracefulStop: "0s",
    },
  },
};
function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 一個簡單的請求
export default function () {
  const rawTraceId = randomBytes(16);
  const traceId = toHex(rawTraceId);
  const rawSpanId = randomBytes(8);
  const spanId = toHex(rawSpanId);
  const traceHeader = `00-${traceId}-${spanId}-01`;

  const gatewayHost = __ENV.GATEWAY_HOST;
  const gatewayPort = __ENV.GATEWAY_PORT;
  const url = `http://${gatewayHost}:${gatewayPort}/`;

  http.get(url, {
    headers: {
      traceparent: traceHeader,
    },
  });
  
//   // 除錯：檢查回應
//   if (response.status !== 200) {
//     console.error(`Request failed: ${response.status} - ${response.body}`);
//   }
}

// 產出你要的欄位；同時輸出成「單段 JSON」與「stdout 單行 CSV」
export function handleSummary(data) {
  // 除錯：印出詳細的 metrics 結構
//   console.error(`Debug - http_req_duration:`, JSON.stringify(data.metrics.http_req_duration || {}, null, 2));
//   console.error(`Debug - iterations:`, JSON.stringify(data.metrics.iterations || {}, null, 2));
//   console.error(`Debug - http_req_failed:`, JSON.stringify(data.metrics.http_req_failed || {}, null, 2));
  
  // k6 metrics 的正確訪問方式
  const avgLatencyMs = (data.metrics.http_req_duration && data.metrics.http_req_duration.values && data.metrics.http_req_duration.values.avg) || 0;
  const iterations = (data.metrics.iterations && data.metrics.iterations.values && data.metrics.iterations.values.count) || 0;
  const iterationsRate = (data.metrics.iterations && data.metrics.iterations.values && data.metrics.iterations.values.rate) || 0;
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
    iterationsRate.toFixed(6),
    vus,
    vusMax,
    dropped,
    failedRate.toFixed(6),
  ].join(",");

  const obj = {
    step_rps: Number(__ENV.RATE || 0),
    avg_latency_ms: avgLatencyMs,
    iterations,
    iterationsRate,
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
    [`out/step_${__ENV.RATE || "NA"}.json`]: JSON.stringify(obj, null, 2),
    // 也把單段的彙總以「一行」CSV 印到 stdout，外層殼層會 append 起來
    stdout: row + "\n",
  };
}
