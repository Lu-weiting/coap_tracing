1. cd 進 dockerize，直接`./start.bash`，這會啟動好基於 CoAP 以及基於 HTTP 兩者的實驗環境
2. 同時打開另個 CLI 看當前是要壓測 CoAP 還是 HTTP 選擇執行 `./http-record.bash` 或 `./coap-record.bash` （紀錄 CPU, memory 平均使用量）
3. 各別輸入下方指令運行起 k6，然後就會以 HTTP Client 的角色對 Gateway 的 `GET /iot-test` 進行壓測。
```sh
docker run -i --rm \
    --network http_http-client-network \
    -e GATEWAY_HOST=http-gateway \
    -e GATEWAY_PORT=4000 \
    grafana/k6 run - < ./load-test/k6.js
```
```sh
docker run -i --rm \
    --network coap_coap-client-network \
    -e GATEWAY_HOST=coap-gateway \
    -e GATEWAY_PORT=3000 \
    grafana/k6 run - < ./load-test/k6.js
```

nvm alias default 22.18.0

SAMPLE_RATE=0.1 GATEWAY_HOST= GATEWAY_PORT= k6 run k6.js

k6 run k6-contant.js 

k6 run k6-ramping-saturation.js -e TRACESTATE_SIZE=16 -e MAX_VUS=200 -e GATEWAY_HOST=192.168.50.142 -e GATEWAY_PORT=3000

k6 run k6-constant-cpu.js -e GATEWAY_HOST=192.168.50.142 -e GATEWAY_PORT=3000 TRACESTATE_SIZE=16 -e TARGET_VUS=80