#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 從 JSON 輸出分析各個 scenario 的數據
function analyzeJsonOutput(jsonFilePath) {
  if (!fs.existsSync(jsonFilePath)) {
    console.error(`❌ JSON 文件不存在: ${jsonFilePath}`);
    console.log('請先使用 --out json=out/metrics.json 選項執行 k6');
    return;
  }

  const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
  const lines = jsonData.trim().split('\n');
  
  const scenarioData = new Map();
  
  console.log('🔍 分析 k6 JSON 輸出...');
  
  lines.forEach(line => {
    try {
      const data = JSON.parse(line);
      
      // 只處理 Point 類型的 metrics
      if (data.type === 'Point' && data.data && data.data.tags && data.data.tags.scenario) {
        const scenario = data.data.tags.scenario;
        const metricName = data.metric;
        const value = data.data.value;
        
        if (!scenarioData.has(scenario)) {
          scenarioData.set(scenario, {
            scenario: scenario,
            http_req_duration: [],
            iterations: 0,
            http_req_failed: [],
            vus: 0,
            dropped_iterations: 0
          });
        }
        
        const scenarioStats = scenarioData.get(scenario);
        
        switch (metricName) {
          case 'http_req_duration':
            scenarioStats.http_req_duration.push(value);
            break;
          case 'iterations':
            scenarioStats.iterations += value;
            break;
          case 'http_req_failed':
            scenarioStats.http_req_failed.push(value);
            break;
          case 'vus':
            scenarioStats.vus = Math.max(scenarioStats.vus, value);
            break;
          case 'dropped_iterations':
            scenarioStats.dropped_iterations += value;
            break;
        }
      }
    } catch (e) {
      // 忽略非 JSON 行
    }
  });
  
  return scenarioData;
}

// 計算統計數據
function calculateStats(values) {
  if (!values || values.length === 0) return { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  
  const sorted = values.slice().sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    avg: values.reduce((sum, val) => sum + val, 0) / len,
    min: sorted[0],
    max: sorted[len - 1],
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)]
  };
}

// 生成報告
function generateReport(scenarioData) {
  const results = [];
  const csvRows = ['rps,avg_latency_ms,min_latency_ms,max_latency_ms,p95_latency_ms,iterations,failed_rate,vus_max,dropped_iterations'];
  
  // 按 scenario 名稱排序
  const sortedScenarios = Array.from(scenarioData.keys()).sort((a, b) => {
    const aRps = parseInt(a.match(/step_(\d+)_rps/)?.[1] || '0');
    const bRps = parseInt(b.match(/step_(\d+)_rps/)?.[1] || '0');
    return aRps - bRps;
  });
  
  console.log('\n=== 各 Scenario 詳細結果 ===\n');
  
  sortedScenarios.forEach(scenario => {
    const data = scenarioData.get(scenario);
    const rpsMatch = scenario.match(/step_(\d+)_rps/);
    const rps = rpsMatch ? parseInt(rpsMatch[1]) : 0;
    
    const latencyStats = calculateStats(data.http_req_duration);
    const failedCount = data.http_req_failed.filter(v => v > 0).length;
    const failedRate = data.http_req_failed.length > 0 ? failedCount / data.http_req_failed.length : 0;
    
    const result = {
      step_rps: rps,
      avg_latency_ms: latencyStats.avg,
      min_latency_ms: latencyStats.min,
      max_latency_ms: latencyStats.max,
      p95_latency_ms: latencyStats.p95,
      p99_latency_ms: latencyStats.p99,
      iterations: data.iterations,
      failed_rate: failedRate,
      vus_max: data.vus,
      dropped_iterations: data.dropped_iterations
    };
    
    results.push(result);
    
    // 輸出到控制台
    console.log(`📊 ${scenario} (${rps} RPS):`);
    console.log(`   平均延遲: ${latencyStats.avg.toFixed(3)}ms`);
    console.log(`   延遲範圍: ${latencyStats.min.toFixed(1)}ms - ${latencyStats.max.toFixed(1)}ms`);
    console.log(`   P95 延遲: ${latencyStats.p95.toFixed(3)}ms`);
    console.log(`   P99 延遲: ${latencyStats.p99.toFixed(3)}ms`);
    console.log(`   總請求數: ${data.iterations}`);
    console.log(`   失敗率: ${(failedRate * 100).toFixed(2)}%`);
    console.log(`   最大 VUs: ${data.vus}`);
    console.log(`   丟棄請求: ${data.dropped_iterations}`);
    console.log('');
    
    // 添加到 CSV
    const csvRow = [
      rps,
      latencyStats.avg.toFixed(3),
      latencyStats.min.toFixed(3),
      latencyStats.max.toFixed(3),
      latencyStats.p95.toFixed(3),
      data.iterations,
      failedRate.toFixed(6),
      data.vus,
      data.dropped_iterations
    ].join(',');
    csvRows.push(csvRow);
  });
  
  return { results, csvRows };
}

// 主函數
function main() {
  const jsonFilePath = process.argv[2] || 'out/metrics.json';
  
  console.log(`📂 讀取 JSON 文件: ${jsonFilePath}`);
  
  const scenarioData = analyzeJsonOutput(jsonFilePath);
  if (!scenarioData || scenarioData.size === 0) {
    console.log('❌ 未找到有效的 scenario 數據');
    return;
  }
  
  const { results, csvRows } = generateReport(scenarioData);
  
  // 確保輸出目錄存在
  const outDir = 'out';
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  // 儲存詳細 JSON 結果
  fs.writeFileSync(path.join(outDir, 'scenario_analysis.json'), JSON.stringify(results, null, 2));
  
  // 儲存 CSV 結果
  fs.writeFileSync(path.join(outDir, 'scenario_results.csv'), csvRows.join('\n'));
  
  console.log('✅ 分析完成！');
  console.log(`📁 詳細結果: ${outDir}/scenario_analysis.json`);
  console.log(`📊 CSV 結果: ${outDir}/scenario_results.csv`);
}

if (require.main === module) {
  main();
}

module.exports = { analyzeJsonOutput, calculateStats, generateReport };
