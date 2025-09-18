#!/usr/bin/env bash
set -euo pipefail

# 預設參數
MAX_RPS="${MAX_RPS:-100}"
STEP_DURATION="${STEP_DURATION:-30s}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-3}"
OUTDIR="${OUTDIR:-out}"

# 建立輸出目錄
mkdir -p "$OUTDIR"

echo "==> 開始多 scenarios 壓測（使用 JSON 輸出）"
echo "==> 最大 RPS: $MAX_RPS"
echo "==> 每個步驟持續時間: $STEP_DURATION"
echo "==> 步驟間隔時間: ${SLEEP_BETWEEN}s"
echo "==> 輸出目錄: $OUTDIR"
echo ""

# 執行 k6 多 scenarios 測試，使用 JSON 輸出
echo "🚀 執行 k6 測試..."
k6 run \
  --quiet \
  --out json="$OUTDIR/metrics.json" \
  -e MAX_RPS="$MAX_RPS" \
  -e GATEWAY_HOST="192.168.50.142" \
  -e GATEWAY_PORT="3000" \
  -e STEP_DURATION="$STEP_DURATION" \
  -e SLEEP_BETWEEN="$SLEEP_BETWEEN" \
  "k6.js"

echo ""
echo "📊 分析各 scenario 結果..."
# 使用 Node.js 分析 JSON 輸出
node analyze_json_output.js "$OUTDIR/metrics.json"

echo ""
echo "==> 壓測完成！"
echo "==> 整體統計: $OUTDIR/overall_results.json"
echo "==> 各 scenario 詳細分析: $OUTDIR/scenario_analysis.json"
echo "==> CSV 結果: $OUTDIR/scenario_results.csv"
echo "==> 原始 JSON 數據: $OUTDIR/metrics.json"
