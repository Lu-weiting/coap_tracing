require("dotenv").config({ path: require('path').join(__dirname, '.env') });

const config = {
  // Server Configuration (coap server)
  server: {
    ip: process.env.SERVER_IP || "10.10.10.3",
    port: parseInt(process.env.SERVER_PORT) || 5683,
  },

  // Tracing Backend Configuration (spans_handler)
  tracingBackend: {
    ip: process.env.TRACING_BACKEND_IP || "192.168.50.113",
    port: parseInt(process.env.TRACING_BACKEND_PORT) || 3001,
  },
  gateway: {
    ip: process.env.GATEWAY_IP || "192.168.50.142",
    lanIp: "10.10.10.1",
    ports: {
      http: parseInt(process.env.HTTP_PORT) || 3000,
      coapSpan: parseInt(process.env.COAP_SPAN_PORT) || 3002,
      httpSpan: parseInt(process.env.HTTP_SPAN_PORT) || 3002,
    },
  },

};

// 驗證配置
function validateConfig() {
  const errors = [];

  if (!config.server.ip) {
    errors.push("SERVER_IP is required");
  }

  if (isNaN(config.server.port) || config.server.port <= 0) {
    errors.push("SERVER_PORT must be a valid port number");
  }

  if (!config.tracingBackend.ip) {
    errors.push("TRACING_BACKEND_IP is required");
  }

  if (isNaN(config.tracingBackend.port) || config.tracingBackend.port <= 0) {
    errors.push("TRACING_BACKEND_PORT must be a valid port number");
  }

  if (!config.gateway.ip) {
    errors.push("GATEWAY_IP is required");
  }

  if (isNaN(config.gateway.ports.http) || config.gateway.ports.http <= 0) {
    errors.push("HTTP_PORT must be a valid port number");
  }

  if (isNaN(config.gateway.ports.coapSpan) || config.gateway.ports.coapSpan <= 0) {
    errors.push("COAP_SPAN_PORT must be a valid port number");
  }

  if (isNaN(config.gateway.ports.httpSpan) || config.gateway.ports.httpSpan <= 0) {
    errors.push("HTTP_SPAN_PORT must be a valid port number");
  }

  if (errors.length > 0) {
    console.error("Configuration errors:");
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
}

// 初始化配置
validateConfig();

module.exports = config;
