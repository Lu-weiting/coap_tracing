#!/usr/bin/env bash
set -euo pipefail

# 腳本說明：TRACESTATE_SIZE 變化測試
# 從 0 bytes 開始以 64 bytes 為間隔遞增到 1024 bytes
# SAMPLE_RATE 固定為 1 (100%)

# 配置參數
OUTDIR="${OUTDIR:-tracestate-size-out}"
CSV="${CSV:-tracestate_size_results.csv}"
MAX_RPS="${MAX_RPS:-100}"
STEP_DURATION="${STEP_DURATION:-30s}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-3}"
GATEWAY_HOST="${GATEWAY_HOST:-192.168.50.142}"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"

# TRACESTATE_SIZE 測試範圍：0, 64, 128, 192, 256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024
TRACESTATE_SIZES=(0 64 128 192 256 320 384 448 512 576 640 704 768 832 896 960 1024)
SAMPLE_RATE=1.0  # 固定為 100%

mkdir -p "$OUTDIR"

# 寫 CSV 表頭
echo "tracestate_size,sample_rate,max_rps,step_duration_seconds,sleep_between_seconds,total_scenarios,overall_avg_latency_ms,total_iterations,overall_vus_observed,overall_vus_max_observed,total_dropped_iterations,overall_failed_rate,started_at" > "$CSV"

echo "======================================"
echo "TRACESTATE_SIZE 變化測試開始"
echo "測試範圍: ${TRACESTATE_SIZES[*]} bytes"
echo "SAMPLE_RATE 固定: ${SAMPLE_RATE} (100%)"
echo "MAX_RPS: ${MAX_RPS}"
echo "STEP_DURATION: ${STEP_DURATION}"
echo "SLEEP_BETWEEN: ${SLEEP_BETWEEN}s"
echo "目標: ${GATEWAY_HOST}:${GATEWAY_PORT}"
echo "結果輸出: ${CSV}"
echo "======================================"

# 為每個 TRACESTATE_SIZE 執行完整的 RPS 測試
for tracestate_size in "${TRACESTATE_SIZES[@]}"; do
  echo ""
  echo "==> 執行 TRACESTATE_SIZE=${tracestate_size} bytes 的測試..."
  
  # 為當前 tracestate_size 創建獨立的輸出目錄
  current_outdir="${OUTDIR}/tracestate_${tracestate_size}"
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
    -e TRACESTATE_SIZE="$tracestate_size" \
    -e SAMPLE_RATE="$SAMPLE_RATE" \
    "k6.js" > "${current_outdir}/test_output.log" 2>&1
  
  # 檢查測試是否成功完成
  if [ $? -eq 0 ]; then
    echo "✅ TRACESTATE_SIZE=${tracestate_size} bytes 測試完成"
    
    # 檢查是否有整體結果文件
    if [ -f "${current_outdir}/overall_results.json" ]; then
      # 從 JSON 結果提取數據並添加到 CSV
      overall_data=$(cat "${current_outdir}/overall_results.json")
      
      # 使用 node 來解析 JSON 並生成 CSV 行
      csv_line=$(node -e "
        const data = $overall_data;
        const row = [
          '$tracestate_size',
          '$SAMPLE_RATE',
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
    echo "❌ TRACESTATE_SIZE=${tracestate_size} bytes 測試失敗"
  fi
  
  # 測試間休息
  if [[ "${#TRACESTATE_SIZES[@]}" -gt 1 ]] && [[ "$tracestate_size" != "${TRACESTATE_SIZES[-1]}" ]]; then
    echo "==> 等待 ${SLEEP_BETWEEN}s 後進行下一個測試..."
    sleep "$SLEEP_BETWEEN"
  fi
done

echo ""
echo "======================================"
echo "🎉 所有 TRACESTATE_SIZE 測試完成！"
echo "📊 結果匯總: $CSV"
echo "📁 詳細結果: $OUTDIR/"
echo "======================================"

echo ""
echo "📋 測試摘要："
echo "- 測試的 TRACESTATE_SIZE: ${TRACESTATE_SIZES[*]} bytes"
echo "- 每個大小的 RPS 範圍: 1-${MAX_RPS}"
echo "- SAMPLE_RATE 固定: ${SAMPLE_RATE} (100%)"
echo "- 總測試數量: ${#TRACESTATE_SIZES[@]} 個大小 × ${MAX_RPS} 個 RPS 等級"

echo ""
echo "🔧 後續分析："
echo "- 執行 'node analyze_json_output.js' 分析各個測試的詳細數據"
echo "- 查看 $CSV 了解整體趨勢"
