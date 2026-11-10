import http from "node:http";

export function startHealthServer(getStatus, port) {
  const server = http.createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, ...getStatus() }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  server.listen(port, () => {
    console.log("[health] status endpoint listening on port " + port);
  });
  return server;
}
