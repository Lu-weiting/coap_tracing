import http from "k6/http";
import { check } from "k6";
import { randomBytes } from "k6/crypto";

const RPS = __ENV.RPS ? parseInt(__ENV.RPS) : 5;
function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const options = {
  scenarios: {
    constant_rate_test: {
      executor: "constant-arrival-rate",
      rate: RPS,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: Math.min(RPS * 2, 100),
      maxVUs: 500,
    },
  },
};
export default function () {
  //   const traceId = randomBytes(16, "hex");
  const rawTraceId = randomBytes(16);
  const traceId = toHex(rawTraceId); // 手動轉成 Hex 字串
  //   const spanId = randomBytes(8, "hex");
  const rawSpanId = randomBytes(8);
  const spanId = toHex(rawSpanId);
  const traceHeader = `00-${traceId}-${spanId}-01`;

  const gatewayHost = __ENV.GATEWAY_HOST;
  const gatewayPort = __ENV.GATEWAY_PORT;
  const url = `http://${gatewayHost}:${gatewayPort}/iot-test`;

  let res = http.get(url, {
    headers: {
      traceparent: traceHeader,
      // "Content-Type": "application/json",
    },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}
