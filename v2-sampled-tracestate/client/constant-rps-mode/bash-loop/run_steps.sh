#!/usr/bin/env bash
set -euo pipefail

OUTDIR="${OUTDIR:-out}"
CSV="${CSV:-results.csv}"
MAX_RPS="${MAX_RPS:-100}"  
SLEEP_BETWEEN="${SLEEP_BETWEEN:-3}"   
STEP_DURATION="${STEP_DURATION:-30}"

mkdir -p "$OUTDIR"
# 先寫 CSV 表頭
echo "rps,avg_latency_ms,iterations,iterations_rate,vus,vus_max,dropped_iterations,failed_rate" > "$CSV"

# 逐段啟動 k6；每段是獨立行程 → 連線池一定重建
for rps in $(seq 10 10 "$MAX_RPS"); do
  echo "==> Running step: ${rps} RPS for ${STEP_DURATION}s"
  # 將 handleSummary 輸出的單行 CSV 追加到總表
  k6 run \
    --quiet \
    -e RATE="$rps" \
    -e GATEWAY_HOST="192.168.50.142" \
    -e GATEWAY_PORT="3000" \
    -e STEP_DURATION="$STEP_DURATION" \
    -e STEP_ID="$rps" \
    "loop-arrival-rate.js" \
    | tee -a "$CSV" > /dev/null
  # 段間休息
  if [[ "$SLEEP_BETWEEN" != "0" ]]; then
    echo "==> Finished step ${rps}, sleeping ${SLEEP_BETWEEN}s..."
    sleep "$SLEEP_BETWEEN"
  fi
done

echo ""
echo "All done."
echo "CSV summary   : $CSV"
echo "Per-step JSON : $OUTDIR/step_*.json"
