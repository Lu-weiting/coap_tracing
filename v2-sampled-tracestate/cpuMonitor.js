const fs = require('fs');
const path = require('path');

class CPUMonitor {
  constructor(serviceName = 'Unknown Service', logToFile = false, reportIntervalSec = 20) {
    this.serviceName = serviceName;
    this.logToFile = logToFile;
    this.reportIntervalSec = reportIntervalSec; // 統整報告間隔（秒）
    
    // CPU 使用量追蹤變數
    this.lastCPUUsage = process.cpuUsage();
    this.lastHRTime = process.hrtime();
    this.totalCPUSeconds = 0;
    this.totalElapsedSeconds = 0;
    this.intervalId = null;
    this.reportIntervalId = null;
    this.isMonitoring = false;
    
    // 用於存儲每秒的 CPU 使用率記錄
    this.cpuRecords = [];
    
    // 用於統整報告的變數
    this.reportStartTime = null;
    this.reportCPUSum = 0;
    this.reportCount = 0;
    
    // 設置 SIGINT 處理
    this.setupSigintHandler();
  }

  start(intervalMs = 1000) {
    if (this.isMonitoring) {
      console.log(`[${this.serviceName}] CPU monitoring is already running`);
      return;
    }

    console.log(`[${this.serviceName}] Starting CPU monitoring (report every ${this.reportIntervalSec}s)...`);
    this.isMonitoring = true;
    this.reportStartTime = Date.now();
    
    // 每秒測量但不輸出
    this.intervalId = setInterval(() => {
      this.measureCPU();
    }, intervalMs);
    
    // 定期報告統整結果
    this.reportIntervalId = setInterval(() => {
      this.reportSummary();
    }, this.reportIntervalSec * 1000);
  }

  stop() {
    if (!this.isMonitoring) {
      return;
    }

    console.log(`[${this.serviceName}] Stopping CPU monitoring...`);
    this.isMonitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.reportIntervalId) {
      clearInterval(this.reportIntervalId);
      this.reportIntervalId = null;
    }
    
    // 最後一次測量和報告
    this.measureCPU(true);
    this.reportSummary(true); // 輸出最後的統整報告
    this.generateSummary();
  }

  measureCPU(isFinal = false) {
    const currentCPUUsage = process.cpuUsage();
    const diffUser = currentCPUUsage.user - this.lastCPUUsage.user;
    const diffSystem = currentCPUUsage.system - this.lastCPUUsage.system;
    const diffCPU = diffUser + diffSystem;

    const currentTime = process.hrtime();
    const diffSec = currentTime[0] - this.lastHRTime[0];
    const diffNano = currentTime[1] - this.lastHRTime[1];
    const elapsedSec = diffSec + diffNano / 1e9;

    const cpuUsedSec = diffCPU / 1e6;
    // 從送出請求到拿到結果 elapsedSec , 程式自己算東西的時間cpuUsedSec
    const cpuPercent = (cpuUsedSec / elapsedSec) * 100;

    // 不再每秒輸出，改為累積到統整報告中
    // 記錄數據
    const record = {
      timestamp: new Date().toISOString(),
      cpuPercent: parseFloat(cpuPercent.toFixed(2)),
      elapsedSec: parseFloat(elapsedSec.toFixed(2)),
      serviceName: this.serviceName
    };
    this.cpuRecords.push(record);

    // 累積到報告統計中
    this.reportCPUSum += cpuPercent;
    this.reportCount++;

    // 累積總計
    this.totalCPUSeconds += cpuUsedSec;
    this.totalElapsedSeconds += elapsedSec;

    // 更新基準
    this.lastCPUUsage = currentCPUUsage;
    this.lastHRTime = currentTime;
  }

  reportSummary(isFinal = false) {
    if (this.reportCount === 0) {
      return;
    }

    const averageCPU = this.reportCPUSum / this.reportCount;
    const elapsedTime = (Date.now() - this.reportStartTime) / 1000;
    
    const prefix = isFinal ? '[Final Report]' : `[${elapsedTime.toFixed(0)}s]`;
    console.log(`[${this.serviceName}] ${prefix} Average CPU Usage: ${averageCPU.toFixed(2)}%`);
    
    // 重置統計變數，準備下一個報告週期
    if (!isFinal) {
      this.reportCPUSum = 0;
      this.reportCount = 0;
    }
  }

  generateSummary() {
    const avgCPUPercent = (this.totalCPUSeconds / this.totalElapsedSeconds) * 100;
    
    const summary = {
      serviceName: this.serviceName,
      totalRunningTime: parseFloat(this.totalElapsedSeconds.toFixed(2)),
      averageCPUUsage: parseFloat(avgCPUPercent.toFixed(2)),
      peakCPUUsage: Math.max(...this.cpuRecords.map(r => r.cpuPercent)),
      minCPUUsage: Math.min(...this.cpuRecords.map(r => r.cpuPercent)),
      totalRecords: this.cpuRecords.length
    };

    console.log(`\n=== [${this.serviceName}] Load Test Summary ===`);
    console.log(`Total Running Time: ${summary.totalRunningTime} sec`);
    console.log(`Average CPU Usage: ${summary.averageCPUUsage}% (single core)`);
    console.log(`Peak CPU Usage: ${summary.peakCPUUsage}% (single core)`);
    console.log(`Min CPU Usage: ${summary.minCPUUsage}% (single core)`);
    console.log(`Total Records: ${summary.totalRecords}`);
    console.log(`=================================================\n`);

    // 如果啟用文件記錄，將結果寫入文件
    if (this.logToFile) {
      this.writeToFile(summary);
    }

    return summary;
  }

  writeToFile(summary) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `cpu-monitor-${this.serviceName.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.json`;
      const dataDir = path.join(__dirname, '..', 'data');
      
      // 確保 data 目錄存在
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const filePath = path.join(dataDir, filename);
      
      const data = {
        summary,
        records: this.cpuRecords
      };
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`[${this.serviceName}] CPU monitoring data saved to: ${filePath}`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to save CPU monitoring data:`, error.message);
    }
  }

  setupSigintHandler() {
    process.on('SIGINT', () => {
      if (this.isMonitoring) {
        console.log(`\n[${this.serviceName}] Received SIGINT. Calculating overall average CPU usage...`);
        this.stop();
      }
      // 注意：這裡不直接呼叫 process.exit()，讓主程式決定何時退出
    });
  }

  // 獲取當前的 CPU 使用率統計
  getStats() {
    const avgCPUPercent = this.totalElapsedSeconds > 0 ? 
      (this.totalCPUSeconds / this.totalElapsedSeconds) * 100 : 0;
    
    return {
      serviceName: this.serviceName,
      isMonitoring: this.isMonitoring,
      totalRunningTime: parseFloat(this.totalElapsedSeconds.toFixed(2)),
      averageCPUUsage: parseFloat(avgCPUPercent.toFixed(2)),
      totalRecords: this.cpuRecords.length
    };
  }
}

module.exports = CPUMonitor; 