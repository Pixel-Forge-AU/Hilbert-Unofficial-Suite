import http from "node:http";
import { METRICS_CONTENT_TYPE, renderMetrics } from "@implementation-orchestrator/observability";

export function startMetricsServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      renderMetrics()
        .then((body) => {
          res.writeHead(200, { "Content-Type": METRICS_CONTENT_TYPE });
          res.end(body);
        })
        .catch((error: unknown) => {
          res.writeHead(500);
          res.end(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port);
  return server;
}
