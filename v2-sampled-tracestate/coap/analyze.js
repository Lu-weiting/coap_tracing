#!/usr/bin/env node

/**
 * Usage:
 *   node analyze.js [path-to-json-file]
 * 
 * Example:
 *   node analyze.js ./data/spans.json
 */

const fs = require('fs');
const path = require('path');

/**
 * 讀取每行 JSON (Line-delimited JSON) 並分別提取 latency。
 */
function parseTraces(filePath) {
  const latenciesA = [];
  const latenciesB = [];

  const data = fs.readFileSync(filePath, 'utf-8');
  // 假設是一行一個 JSON 物件
  const lines = data.split('\n').map(line => line.trim()).filter(l => l);

  for (const line of lines) {
    let span;
    try {
      span = JSON.parse(line);
    } catch (err) {
      console.warn(`Skip invalid JSON line: ${line}`);
      continue;
    }

    const operationName = span.operationName;
    const startTime = span.startTime;
    const endTime = span.endTime;

    if (!operationName || typeof startTime !== 'number' || typeof endTime !== 'number') {
      continue;
    }

    // 計算 latency (ms)
    const latency = endTime - startTime;

    if (operationName == 'Gateway-HTTP') {
      latenciesA.push(latency);
    } else if (operationName == 'IoT-Server-A') {
      latenciesB.push(latency);
    }
  }

  return { latenciesA, latenciesB };
}

/**
 * 取得統計數值 (count, avg, p95, p99, min, max)
 */
function getStats(latencies) {
  if (!latencies || latencies.length === 0) {
    return { count: 0, avg: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / count;
  // p95, p99 index
  const p95Index = Math.floor(count * 0.95) - 1;
  const p99Index = Math.floor(count * 0.99) - 1;
  // 保護機制：index 可能會小於 0
  const p95 = sorted[p95Index < 0 ? 0 : p95Index];
  const p99 = sorted[p99Index < 0 ? 0 : p99Index];

  return {
    count,
    avg,
    p95,
    p99,
    min: sorted[0],
    max: sorted[count - 1],
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node analyze.js [path-to-json-file]');
    process.exit(1);
  }

  // 絕對路徑
  const absPath = path.resolve(filePath);

  // 解析檔案
  const { latenciesA, latenciesB } = parseTraces(absPath);

  // 計算統計
  const statsA = getStats(latenciesA);
  const statsB = getStats(latenciesB);

  console.log('=== (Gateway) Latency Stats ===');
  console.log(statsA);
  console.log('=== (IoT Server A) Latency Stats ===');
  console.log(statsB);
}

// 如果此檔案是直接被呼叫，就執行 main()；若是被其他模組引用就不執行
if (require.main === module) {
  main();
}
