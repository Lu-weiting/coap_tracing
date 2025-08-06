import http from "k6/http";
import { check } from "k6";
import { randomBytes } from "k6/crypto";
import { Trend, Rate, Counter } from "k6/metrics";

// 環境變數配置
const TRACESTATE_SIZE = parseInt(__ENV.TRACESTATE_SIZE); // bytes
const GATEWAY_HOST = __ENV.GATEWAY_HOST;
const GATEWAY_PORT = __ENV.GATEWAY_PORT;
const MAX_VUS = parseInt(__ENV.MAX_VUS) || 200; // 最大VU數量
const STAGE_DURATION = __ENV.STAGE_DURATION || "60s"; // 每個階段持續時間

// 自定義指標
const saturationTrend = new Trend('saturation_rps');
const responseTimeTrend = new Trend('custom_response_time');
const errorRate = new Rate('custom_error_rate');
const requestCounter = new Counter('total_requests');

// 全域變數用於飽和點檢測
let stageMetrics = [];
let currentStage = 0;

// 生成符合W3C規範的tracestate
function generateTracestate(targetBytes) {
  if (targetBytes <= 0) return '';
  
  let tracestate = '';
  let currentSize = 0;
  let counter = 1;
  
  while (currentSize < targetBytes) {
    // 格式: keyN=valueN (每個條目大約8-12字節)
    const key = `k${counter}`;
    const value = `v${counter.toString().padStart(3, '0')}`;
    const entry = `${key}=${value}`;
    
    // 檢查是否會超過目標大小
    const separator = tracestate ? ',' : '';
    const newEntry = separator + entry;
    const newSize = Buffer.byteLength(tracestate + newEntry, 'utf8');
    
    if (newSize > targetBytes) {
      // 如果會超過，用隨機字符填滿剩餘空間
      const remaining = targetBytes - currentSize;
      if (remaining > 0 && tracestate) {
        const padding = 'x'.repeat(Math.max(0, remaining - 1));
        tracestate += ',' + padding;
      }
      break;
    }
    
    tracestate += newEntry;
    currentSize = newSize;
    counter++;
  }
  
  return tracestate;
}

// 生成16進制字符串
function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 動態生成測試階段
function generateStages() {
  const stages = [];
  const step = Math.max(5, Math.floor(MAX_VUS / 20)); // 至少5個VU為一階段
  
  for (let vus = step; vus <= MAX_VUS; vus += step) {
    stages.push({ duration: STAGE_DURATION, target: vus });
  }
  
  // 添加冷卻階段
  stages.push({ duration: "30s", target: 0 });
  
  return stages;
}

export const options = {
  scenarios: {
    saturation_test: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: generateStages(),
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"], // P95響應時間閾值
    http_req_failed: ["rate<0.05"],    // 錯誤率閾值5%
    custom_response_time: ["p(95)<1000"],
  },
};

// // 飽和點檢測邏輯
// function detectSaturation(currentRPS, previousRPS, currentP95, errorRate) {
//   const rpsGrowthRate = previousRPS > 0 ? (currentRPS - previousRPS) / previousRPS : 1;
  
//   return {
//     rpsStagnant: rpsGrowthRate < 0.05, // RPS增長率小於5%
//     latencySpike: currentP95 > 500,    // P95響應時間超過500ms
//     highErrorRate: errorRate > 0.02,   // 錯誤率超過2%
//     isSaturated: rpsGrowthRate < 0.05 || currentP95 > 500 || errorRate > 0.02
//   };
// }

export default function () {
  // 生成trace context
  const traceId = toHex(randomBytes(16));
  const spanId = toHex(randomBytes(8));
  const traceFlags = "01";
  const traceHeader = `00-${traceId}-${spanId}-${traceFlags}`;
  const tracestateContent = generateTracestate(TRACESTATE_SIZE);
  
  // 構建請求URL
  const url = `http://${GATEWAY_HOST}:${GATEWAY_PORT}/iot-test`;
  
  // 發送請求
  const startTime = Date.now();
  const response = http.get(url, {
    headers: {
      traceparent: traceHeader,
      tracestate: tracestateContent,
      "Content-Type": "application/json",
    },
    timeout: "10s",
  });
  const endTime = Date.now();
  
  // 記錄自定義指標
  const responseTime = endTime - startTime;
  responseTimeTrend.add(responseTime);
  errorRate.add(response.status !== 200);
  requestCounter.add(1);
  
  // 檢查響應
  const success = check(response, {
    "status is 200": (r) => r.status === 200,
    "response time < 1000ms": (r) => r.timings.duration < 1000,
  });
  
  if (!success) {
    console.log(`Request failed: Status=${response.status}, Duration=${response.timings.duration}ms`);
  }
}

// 階段結束時的處理
export function handleSummary(data) {
  // 分析每個階段的性能數據
  const stages = generateStages();
  let saturationPoint = null;
  let maxRPS = 0;
  let optimalVUs = 0;
  
  // 計算整體指標
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const totalDuration = data.state.testRunDurationMs / 1000;
  const avgRPS = totalRequests / totalDuration;
  const p95ResponseTime = data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(95)"] : 0;
  const overallErrorRate = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  
  // 估算飽和點（這裡使用簡化的方法，實際可能需要更複雜的分析）
  if (p95ResponseTime > 500 || overallErrorRate > 0.02) {
    saturationPoint = {
      detected: true,
      estimatedVUs: Math.floor(MAX_VUS * 0.7), // 保守估計
      estimatedRPS: Math.floor(avgRPS * 0.8),
      reason: p95ResponseTime > 500 ? "high_latency" : "high_error_rate"
    };
  } else {
    saturationPoint = {
      detected: false,
      estimatedVUs: MAX_VUS,
      estimatedRPS: Math.floor(avgRPS),
      reason: "not_reached"
    };
  }
  
  maxRPS = Math.max(maxRPS, avgRPS);
  optimalVUs = saturationPoint.estimatedVUs;
  
  const results = {
    testConfig: {
      tracestateSize: TRACESTATE_SIZE,
      maxVUs: MAX_VUS,
      stageDuration: STAGE_DURATION,
      gatewayEndpoint: `${GATEWAY_HOST}:${GATEWAY_PORT}`
    },
    saturationAnalysis: {
      saturationDetected: saturationPoint.detected,
      saturationReason: saturationPoint.reason,
      recommendedVUs: optimalVUs,
      maxRPS: Math.round(maxRPS),
      estimatedRPS: saturationPoint.estimatedRPS
    },
    performanceMetrics: {
      totalRequests: totalRequests,
      testDuration: Math.round(totalDuration),
      averageRPS: Math.round(avgRPS),
      p95ResponseTime: Math.round(p95ResponseTime),
      errorRate: Math.round(overallErrorRate * 10000) / 100, // 轉換為百分比
      successRate: Math.round((1 - overallErrorRate) * 10000) / 100
    },
    recommendations: {
      constantVUTest: {
        recommendedVUs: optimalVUs,
        expectedRPS: saturationPoint.estimatedRPS,
        testDuration: "300s" // 建議的constant VU測試時間
      }
    },
    timestamp: new Date().toISOString()
  };
  
  // 輸出到控制台
  console.log("\n=== Saturation Test Results ===");

  console.log(`Tracestate Size: ${TRACESTATE_SIZE} bytes`);
  console.log(`Max RPS Achieved: ${results.performanceMetrics.averageRPS}`);
  console.log(`Recommended VUs for Constant Test: ${optimalVUs}`);
  console.log(`P95 Response Time: ${results.performanceMetrics.p95ResponseTime}ms`);
  console.log(`Error Rate: ${results.performanceMetrics.errorRate}%`);
  console.log(`Saturation Detected: ${saturationPoint.detected ? 'Yes' : 'No'}`);
  if (saturationPoint.detected) {
    console.log(`Saturation Reason: ${saturationPoint.reason}`);
  }
  console.log("================================\n");
  
  return {
    'saturation-results.json': JSON.stringify(results, null, 2),
    'stdout': `
Saturation Test Summary:
- Tracestate Size: ${TRACESTATE_SIZE} bytes  
- Max RPS: ${results.performanceMetrics.averageRPS}
- Recommended VUs: ${optimalVUs}
- Next Step: Run constant VU test with ${optimalVUs} VUs
`
  };
}

// 測試開始時的設置
export function setup() {
  console.log(`Testing up to ${MAX_VUS} VUs with ${STAGE_DURATION} per stage`);
  console.log(`Target: ${GATEWAY_HOST}:${GATEWAY_PORT}`);
  return {};
}

// 測試結束時的清理
export function teardown(data) {
  console.log("Saturation test completed");
}