const fs = require('fs');
const path = require('path');

class CPUMonitor {
  constructor(serviceName = 'Unknown Service', logToFile = false) {
    this.serviceName = serviceName;
    this.logToFile = logToFile;
    
    // CPU 使用量追蹤變數
    this.lastCPUUsage = process.cpuUsage();
    this.lastHRTime = process.hrtime();
    this.totalCPUSeconds = 0;
    this.totalElapsedSeconds = 0;
    this.intervalId = null;
    this.isMonitoring = false;
    
    // 用於存儲每秒的 CPU 使用率記錄
    this.cpuRecords = [];
    
    // 設置 SIGINT 處理
    this.setupSigintHandler();
  }

  start(intervalMs = 1000) {
    if (this.isMonitoring) {
      console.log(`[${this.serviceName}] CPU monitoring is already running`);
      return;
    }

    console.log(`[${this.serviceName}] Starting CPU monitoring...`);
    this.isMonitoring = true;
    
    this.intervalId = setInterval(() => {
      this.measureCPU();
    }, intervalMs);
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
    
    // 最後一次測量
    this.measureCPU(true);
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
    const cpuPercent = (cpuUsedSec / elapsedSec) * 100;

    if (!isFinal) {
      console.log(`[${this.serviceName}] [1s Metrics] CPU usage = ${cpuPercent.toFixed(2)}% (interval=${elapsedSec.toFixed(2)}s)`);
    }

    // 記錄數據
    const record = {
      timestamp: new Date().toISOString(),
      cpuPercent: parseFloat(cpuPercent.toFixed(2)),
      elapsedSec: parseFloat(elapsedSec.toFixed(2)),
      serviceName: this.serviceName
    };
    this.cpuRecords.push(record);

    // 累積總計
    this.totalCPUSeconds += cpuUsedSec;
    this.totalElapsedSeconds += elapsedSec;

    // 更新基準
    this.lastCPUUsage = currentCPUUsage;
    this.lastHRTime = currentTime;
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
