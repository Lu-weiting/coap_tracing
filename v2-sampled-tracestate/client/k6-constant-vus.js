import http from "k6/http";
import { check } from "k6";
import { randomBytes } from "k6/crypto";
import { Trend, Rate, Counter, Gauge } from "k6/metrics";

// 環境變數配置
const TRACESTATE_SIZE = parseInt(__ENV.TRACESTATE_SIZE) || 16; // bytes
const GATEWAY_HOST = __ENV.GATEWAY_HOST || "localhost";
const GATEWAY_PORT = __ENV.GATEWAY_PORT || "3000";
const TARGET_VUS = parseInt(__ENV.TARGET_VUS) || 50; // 從飽和點測試得出的VU數量
const TEST_DURATION = __ENV.TEST_DURATION || "300s"; // 測試持續時間
const WARMUP_DURATION = __ENV.WARMUP_DURATION || "30s"; // 預熱時間

// 自定義指標
const actualRPSTrend = new Trend('actual_rps');
const responseTimeTrend = new Trend('response_time_detailed');
const errorRate = new Rate('error_rate_detailed');
const requestCounter = new Counter('total_requests_detailed');
const activeVUsGauge = new Gauge('active_vus');

// 性能統計
let requestCount = 0;
let errorCount = 0;
let totalResponseTime = 0;
let minResponseTime = Infinity;
let maxResponseTime = 0;
let responseTimes = [];

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

export const options = {
  scenarios: {
    constant_load_test: {
      executor: "constant-vus",
      vus: TARGET_VUS,
      duration: TEST_DURATION,
      gracefulRampDown: "10s", // 優雅關閉時間
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    http_req_failed: ["rate<0.05"],
    response_time_detailed: ["p(95)<1000"],
    error_rate_detailed: ["rate<0.05"],
  },
  // 設定更詳細的輸出
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  // 生成trace context
  const traceId = toHex(randomBytes(16));
  const spanId = toHex(randomBytes(8));
  const traceFlags = "01";
  const traceHeader = `00-${traceId}-${spanId}-${traceFlags}`;
  const tracestateContent = generateTracestate(TRACESTATE_SIZE);
  
  // 構建請求URL
  const url = `http://${GATEWAY_HOST}:${GATEWAY_PORT}/iot-test`;
  
  // 記錄請求開始時間
  const requestStartTime = Date.now();
  
  // 發送請求
  const response = http.get(url, {
    headers: {
      traceparent: traceHeader,
      tracestate: tracestateContent,
      "Content-Type": "application/json",
    },
    timeout: "10s",
  });
  
  // 計算響應時間
  const requestEndTime = Date.now();
  const responseTime = requestEndTime - requestStartTime;
  
  // 更新統計數據
  requestCount++;
  totalResponseTime += responseTime;
  minResponseTime = Math.min(minResponseTime, responseTime);
  maxResponseTime = Math.max(maxResponseTime, responseTime);
  responseTimes.push(responseTime);
  
  // 記錄自定義指標
  responseTimeTrend.add(responseTime);
  requestCounter.add(1);
  
  // 檢查響應狀態
  const isSuccess = response.status === 200;
  if (!isSuccess) {
    errorCount++;
  }
  errorRate.add(!isSuccess);
  
  // 詳細的響應檢查
  const checks = check(response, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
    "response time < 1000ms": (r) => r.timings.duration < 1000,
    "response has content": (r) => r.body && r.body.length > 0,
  });
  
  // 記錄失敗的請求詳情
  if (!isSuccess) {
    console.log(`Request failed: Status=${response.status}, Duration=${responseTime}ms, Error=${response.error}`);
  }
  
  // 每100個請求輸出一次進度（避免過多日誌）
  if (requestCount % 100 === 0) {
    const currentRPS = requestCount / ((Date.now() - __STARTTIME) / 1000);
    const currentErrorRate = (errorCount / requestCount) * 100;
    console.log(`Progress: ${requestCount} requests, RPS: ${currentRPS.toFixed(2)}, Error Rate: ${currentErrorRate.toFixed(2)}%`);
    
    // 記錄當前RPS
    actualRPSTrend.add(currentRPS);
  }
}

// 計算百分位數
function calculatePercentile(values, percentile) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// 測試結束後的結果分析
export function handleSummary(data) {
  const testDuration = data.state.testRunDurationMs / 1000;
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : requestCount;
  const actualRPS = totalRequests / testDuration;
  const overallErrorRate = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : (errorCount / requestCount);
  
  // 響應時間統計
  const responseTimeStats = {
    min: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.min : minResponseTime,
    max: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.max : maxResponseTime,
    avg: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : (totalResponseTime / requestCount),
    p50: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.med : calculatePercentile(responseTimes, 50),
    p90: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(90)"] : calculatePercentile(responseTimes, 90),
    p95: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(95)"] : calculatePercentile(responseTimes, 95),
    p99: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(99)"] : calculatePercentile(responseTimes, 99),
  };
  
  const results = {
    testConfig: {
      tracestateSize: TRACESTATE_SIZE,
      targetVUs: TARGET_VUS,
      testDuration: TEST_DURATION,
      gatewayEndpoint: `${GATEWAY_HOST}:${GATEWAY_PORT}`,
      timestamp: new Date().toISOString()
    },
    performanceResults: {
      actualRPS: Math.round(actualRPS * 100) / 100,
      totalRequests: totalRequests,
      testDurationSeconds: Math.round(testDuration * 100) / 100,
      successfulRequests: totalRequests - errorCount,
      failedRequests: errorCount,
      errorRate: Math.round(overallErrorRate * 10000) / 100, // 轉換為百分比
      successRate: Math.round((1 - overallErrorRate) * 10000) / 100
    },
    responseTimeMetrics: {
      min: Math.round(responseTimeStats.min * 100) / 100,
      max: Math.round(responseTimeStats.max * 100) / 100,
      average: Math.round(responseTimeStats.avg * 100) / 100,
      p50: Math.round(responseTimeStats.p50 * 100) / 100,
      p90: Math.round(responseTimeStats.p90 * 100) / 100,
      p95: Math.round(responseTimeStats.p95 * 100) / 100,
      p99: Math.round(responseTimeStats.p99 * 100) / 100
    },
    cpuMonitoringNote: {
      message: "CPU監控數據請查看對應服務的CPU監控日誌",
      expectedCpuLogLocation: "../data/",
      services: ["Gateway", "CoAP-Server", "IoT-Server"],
      cpuDataFormat: "cpu-monitor-{service}-{timestamp}.json"
    },
    qualityAssessment: {
      performanceGrade: getPerformanceGrade(responseTimeStats.p95, overallErrorRate),
      recommendations: getRecommendations(actualRPS, responseTimeStats.p95, overallErrorRate)
    }
  };
  
  // 輸出到控制台
  console.log("\n=== Constant VU Load Test Results ===");

  console.log(`Tracestate Size: ${TRACESTATE_SIZE} bytes`);
  console.log(`Target VUs: ${TARGET_VUS}`);
  console.log(`Test Duration: ${testDuration}s`);
  console.log(`Actual RPS: ${results.performanceResults.actualRPS}`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Success Rate: ${results.performanceResults.successRate}%`);
  console.log(`Error Rate: ${results.performanceResults.errorRate}%`);
  console.log(`Response Time P95: ${results.responseTimeMetrics.p95}ms`);
  console.log(`Response Time P99: ${results.responseTimeMetrics.p99}ms`);
  console.log(`Performance Grade: ${results.qualityAssessment.performanceGrade}`);
  console.log("======================================\n");
  
  return {
    'constant-load-results.json': JSON.stringify(results, null, 2),
    'stdout': `
Constant Load Test Summary:
- Tracestate Size: ${TRACESTATE_SIZE} bytes
- Target VUs: ${TARGET_VUS}
- Actual RPS: ${results.performanceResults.actualRPS}
- Success Rate: ${results.performanceResults.successRate}%
- P95 Response Time: ${results.responseTimeMetrics.p95}ms
- Performance Grade: ${results.qualityAssessment.performanceGrade}

Note: Check CPU monitoring logs in ../data/ directory for detailed CPU usage during this test.
`
  };
}

// 性能等級評估
function getPerformanceGrade(p95ResponseTime, errorRate) {
  if (errorRate > 0.05 || p95ResponseTime > 1000) return "Poor";
  if (errorRate > 0.02 || p95ResponseTime > 500) return "Fair";
  if (errorRate > 0.01 || p95ResponseTime > 200) return "Good";
  return "Excellent";
}

// 性能建議
function getRecommendations(actualRPS, p95ResponseTime, errorRate) {
  const recommendations = [];
  
  if (errorRate > 0.02) {
    recommendations.push("High error rate detected. Consider reducing load or investigating server issues.");
  }
  
  if (p95ResponseTime > 500) {
    recommendations.push("High response time detected. Consider optimizing server performance or reducing load.");
  }
  
  if (actualRPS < TARGET_VUS * 0.5) {
    recommendations.push("Low RPS compared to VUs. Check for bottlenecks or connection issues.");
  }
  
  if (recommendations.length === 0) {
    recommendations.push("Performance looks good! System is handling the load well.");
  }
  
  return recommendations;
}

// 測試開始時的設置
export function setup() {
  console.log(`Configuration:`);
  console.log(`- Tracestate Size: ${TRACESTATE_SIZE} bytes`);
  console.log(`- Target VUs: ${TARGET_VUS}`);
  console.log(`- Test Duration: ${TEST_DURATION}`);
  console.log(`- Target: ${GATEWAY_HOST}:${GATEWAY_PORT}`);
  console.log(`- Expected to generate CPU monitoring data for analysis`);
  
  // 記錄測試開始時間
  global.__STARTTIME = Date.now();
  
  return {};
}

// 測試結束時的清理
export function teardown(data) {
  console.log("Constant load test completed");
  console.log("Please check the CPU monitoring logs for detailed CPU usage analysis");
}