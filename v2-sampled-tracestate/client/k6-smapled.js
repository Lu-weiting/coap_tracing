import http from "k6/http";
import { check } from "k6";
import { randomBytes } from "k6/crypto";

const RPS = __ENV.RPS ? parseInt(__ENV.RPS) : 5;
const SAMPLE_RATE = __ENV.SAMPLE_RATE ? parseFloat(__ENV.SAMPLE_RATE) : 1.0; // 1.0 = 100%

function toHex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const options = {
  scenarios: {
    constant_rate_test: {
      executor: "constant-arrival-rate",
      rate: 70,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: Math.min(RPS * 2, 100),
      maxVUs: 500,
    },
  },
};

export default function () {
  const traceId = toHex(randomBytes(16));
  const spanId = toHex(randomBytes(8));

  // 依採樣率決定 sampled flag
  const sampled = Math.random() < SAMPLE_RATE;
  const traceFlags = sampled ? "01" : "00";

  const traceHeader = `00-${traceId}-${spanId}-${traceFlags}`;

  const gatewayHost = __ENV.GATEWAY_HOST;
  const gatewayPort = __ENV.GATEWAY_PORT;
  const url = `http://${gatewayHost}:${gatewayPort}/iot-test`;

  let res = http.get(url, {
    headers: {
      traceparent: traceHeader,
      "Content-Type": "application/json",
    },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}
