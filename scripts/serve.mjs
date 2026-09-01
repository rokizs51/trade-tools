import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { createSqliteCostingRepository } from "./sqliteCostingRepository.mjs";

const root = process.cwd();
const port = Number(process.env.PORT ?? 4173);
const repository = createSqliteCostingRepository(join(root, "data", "costings.sqlite"));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, response, url);
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(resolve(root)) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Export Cost Calculator: http://localhost:${port}`);
  console.log(`SQLite database: ${join(root, "data", "costings.sqlite")}`);
});

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleApiRequest(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/costings") {
      sendJson(response, 200, repository.list());
      return;
    }

    const costingMatch = url.pathname.match(/^\/api\/costings\/([^/]+)$/);
    const archiveMatch = url.pathname.match(/^\/api\/costings\/([^/]+)\/archive$/);

    if (request.method === "GET" && costingMatch) {
      const costing = repository.get(decodeURIComponent(costingMatch[1]));

      if (!costing) {
        sendJson(response, 404, { error: "Costing not found." });
        return;
      }

      sendJson(response, 200, costing);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/costings") {
      const draft = await readJsonBody(request);
      sendJson(response, 201, repository.save(draft, {
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "PUT" && costingMatch) {
      const draft = await readJsonBody(request);
      sendJson(response, 200, repository.save(draft, {
        existingId: decodeURIComponent(costingMatch[1]),
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "DELETE" && costingMatch) {
      const deleted = repository.delete(decodeURIComponent(costingMatch[1]));

      if (!deleted) {
        sendJson(response, 404, { error: "Costing not found." });
        return;
      }

      sendJson(response, 200, { deleted: true });
      return;
    }

    if (request.method === "POST" && archiveMatch) {
      const archived = repository.archive(decodeURIComponent(archiveMatch[1]), new Date().toISOString());

      if (!archived) {
        sendJson(response, 404, { error: "Costing not found." });
        return;
      }

      sendJson(response, 200, archived);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Server error." });
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
