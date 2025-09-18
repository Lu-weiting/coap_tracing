#!/usr/bin/env bash
set -euo pipefail

# 腳本說明：SAMPLE_RATE 變化測試
# 從 0% 開始以 10% 為間隔遞增到 100% 的 SAMPLE_RATE
# TRACESTATE_SIZE 固定為 0 bytes

# 配置參數
OUTDIR="${OUTDIR:-sample-rate-out}"
CSV="${CSV:-sample_rate_results.csv}"
MAX_RPS="${MAX_RPS:-100}"
STEP_DURATION="${STEP_DURATION:-30s}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-3}"
GATEWAY_HOST="${GATEWAY_HOST:-192.168.50.142}"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"

# SAMPLE_RATE 測試範圍：0%, 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%, 100%
SAMPLE_RATES=(0.0 0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0)
TRACESTATE_SIZE=0  # 固定為 0 bytes

mkdir -p "$OUTDIR"

# 寫 CSV 表頭
echo "tracestate_size,sample_rate,max_rps,step_duration_seconds,sleep_between_seconds,total_scenarios,overall_avg_latency_ms,total_iterations,overall_vus_observed,overall_vus_max_observed,total_dropped_iterations,overall_failed_rate,started_at" > "$CSV"

echo "======================================"
echo "SAMPLE_RATE 變化測試開始"
echo "測試範圍: ${SAMPLE_RATES[*]} (0%-100%)"
echo "TRACESTATE_SIZE 固定: ${TRACESTATE_SIZE} bytes"
echo "MAX_RPS: ${MAX_RPS}"
echo "STEP_DURATION: ${STEP_DURATION}"
echo "SLEEP_BETWEEN: ${SLEEP_BETWEEN}s"
echo "目標: ${GATEWAY_HOST}:${GATEWAY_PORT}"
echo "結果輸出: ${CSV}"
echo "======================================"

# 為每個 SAMPLE_RATE 執行完整的 RPS 測試
for sample_rate in "${SAMPLE_RATES[@]}"; do
  # 計算百分比用於顯示
  percentage=$(node -e "console.log(Math.round($sample_rate * 100))")
  
  echo ""
  echo "==> 執行 SAMPLE_RATE=${sample_rate} (${percentage}%) 的測試..."
  
  # 為當前 sample_rate 創建獨立的輸出目錄
  current_outdir="${OUTDIR}/sample_rate_${percentage}pct"
  mkdir -p "$current_outdir"
  
  # 執行 k6 測試
  k6 run \
    --quiet \
    --out json="${current_outdir}/metrics.json" \
    -e MAX_RPS="$MAX_RPS" \
    -e STEP_DURATION="$STEP_DURATION" \
    -e SLEEP_BETWEEN="$SLEEP_BETWEEN" \
    -e GATEWAY_HOST="$GATEWAY_HOST" \
    -e GATEWAY_PORT="$GATEWAY_PORT" \
    -e TRACESTATE_SIZE="$TRACESTATE_SIZE" \
    -e SAMPLE_RATE="$sample_rate" \
    "k6.js" > "${current_outdir}/test_output.log" 2>&1
  
  # 檢查測試是否成功完成
  if [ $? -eq 0 ]; then
    echo "✅ SAMPLE_RATE=${sample_rate} (${percentage}%) 測試完成"
    
    # 檢查是否有整體結果文件
    if [ -f "${current_outdir}/overall_results.json" ]; then
      # 從 JSON 結果提取數據並添加到 CSV
      overall_data=$(cat "${current_outdir}/overall_results.json")
      
      # 使用 node 來解析 JSON 並生成 CSV 行
      csv_line=$(node -e "
        const data = $overall_data;
        const row = [
          '$TRACESTATE_SIZE',
          '$sample_rate',
          data.max_rps || '',
          data.step_duration_seconds || '',
          data.sleep_between_seconds || '',
          data.total_scenarios || '',
          data.overall_avg_latency_ms || '',
          data.total_iterations || '',
          data.overall_vus_observed || '',
          data.overall_vus_max_observed || '',
          data.total_dropped_iterations || '',
          data.overall_failed_rate || '',
          data.started_at || ''
        ].join(',');
        console.log(row);
      ")
      
      echo "$csv_line" >> "$CSV"
    else
      echo "⚠️  警告：找不到整體結果文件 ${current_outdir}/overall_results.json"
    fi
  else
    echo "❌ SAMPLE_RATE=${sample_rate} (${percentage}%) 測試失敗"
  fi
  
  # 測試間休息
  if [[ "${#SAMPLE_RATES[@]}" -gt 1 ]] && [[ "$sample_rate" != "${SAMPLE_RATES[-1]}" ]]; then
    echo "==> 等待 ${SLEEP_BETWEEN}s 後進行下一個測試..."
    sleep "$SLEEP_BETWEEN"
  fi
done

echo ""
echo "======================================"
echo "🎉 所有 SAMPLE_RATE 測試完成！"
echo "📊 結果匯總: $CSV"
echo "📁 詳細結果: $OUTDIR/"
echo "======================================"

echo ""
echo "📋 測試摘要："
echo "- 測試的 SAMPLE_RATE: ${SAMPLE_RATES[*]} (0%-100%)"
echo "- 每個採樣率的 RPS 範圍: 1-${MAX_RPS}"
echo "- TRACESTATE_SIZE 固定: ${TRACESTATE_SIZE} bytes"
echo "- 總測試數量: ${#SAMPLE_RATES[@]} 個採樣率 × ${MAX_RPS} 個 RPS 等級"

echo ""
echo "🔧 後續分析："
echo "- 執行 'node analyze_json_output.js' 分析各個測試的詳細數據"
echo "- 查看 $CSV 了解整體趨勢"



