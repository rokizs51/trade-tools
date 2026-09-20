import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { createBuyerDiscoveryRuntime } from "./buyerDiscoveryRuntime.mjs";
import { createBuyerApiHandler } from "./buyerApi.mjs";
import { createPersistence } from "./persistence.mjs";
import {
  AuthenticationError,
  createBrowserAuthConfig,
  createRequestAuthenticator,
  readAuthConfig,
} from "./supabaseAuth.mjs";

const root = process.cwd();
const port = Number(process.env.PORT ?? 4173);
const persistence = createPersistence({ root });
const authConfig = readAuthConfig(process.env, persistence.provider);
const authenticateRequest = createRequestAuthenticator(authConfig);
const browserAuthConfig = createBrowserAuthConfig(authConfig);
const repository = persistence.costingRepository;
const loadPlanRepository = persistence.loadPlanRepository;
const buyerRepository = persistence.buyerRepository;
const interruptedBuyerSearches = await buyerRepository.interruptStaleSearchRuns(new Date().toISOString());
const buyerRuntime = process.env.OPENROUTER_API_KEY
  ? createBuyerDiscoveryRuntime({ repository: buyerRepository })
  : undefined;
const handleBuyerApiRequest = createBuyerApiHandler({
  repository: buyerRepository,
  runtime: buyerRuntime,
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/auth/config.js") {
    sendBrowserAuthConfig(response, browserAuthConfig);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    let identity;
    try {
      identity = await authenticateRequest(request);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        sendJson(response, 401, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }

    request.auth = identity;
    if (request.method === "GET" && url.pathname === "/api/session") {
      sendJson(response, 200, { user: identity });
      return;
    }
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
  console.log(persistence.provider === "postgres"
    ? "Database: Supabase Postgres"
    : `SQLite database: ${persistence.databasePath}`);
  console.log(authConfig.mode === "supabase" ? "Authentication: Supabase Auth" : "Authentication: disabled for local SQLite");

  if (interruptedBuyerSearches > 0) {
    console.log(`Recovered ${interruptedBuyerSearches} interrupted buyer search(es).`);
  }
});

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendBrowserAuthConfig(response, config) {
  const serialized = JSON.stringify(config).replaceAll("<", "\\u003c");
  response.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`window.__TRADE_TOOLS_AUTH_CONFIG__ = Object.freeze(${serialized});`);
}

async function handleApiRequest(request, response, url) {
  try {
    if (await handleBuyerApiRequest(request, response, url)) {
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/costings") {
      sendJson(response, 200, await repository.list());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/load-plans") {
      sendJson(response, 200, await loadPlanRepository.list());
      return;
    }

    const costingMatch = url.pathname.match(/^\/api\/costings\/([^/]+)$/);
    const archiveMatch = url.pathname.match(/^\/api\/costings\/([^/]+)\/archive$/);
    const loadPlanMatch = url.pathname.match(/^\/api\/load-plans\/([^/]+)$/);
    const loadPlanArchiveMatch = url.pathname.match(/^\/api\/load-plans\/([^/]+)\/archive$/);

    if (request.method === "GET" && costingMatch) {
      const costing = await repository.get(decodeURIComponent(costingMatch[1]));

      if (!costing) {
        sendJson(response, 404, { error: "Costing not found." });
        return;
      }

      sendJson(response, 200, costing);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/costings") {
      const draft = await readJsonBody(request);
      sendJson(response, 201, await repository.save(draft, {
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "GET" && loadPlanMatch) {
      const loadPlan = await loadPlanRepository.get(decodeURIComponent(loadPlanMatch[1]));

      if (!loadPlan) {
        sendJson(response, 404, { error: "Load plan not found." });
        return;
      }

      sendJson(response, 200, loadPlan);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/load-plans") {
      const draft = await readJsonBody(request);
      sendJson(response, 201, await loadPlanRepository.save(draft, {
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "PUT" && loadPlanMatch) {
      const draft = await readJsonBody(request);
      sendJson(response, 200, await loadPlanRepository.save(draft, {
        existingId: decodeURIComponent(loadPlanMatch[1]),
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "DELETE" && loadPlanMatch) {
      const deleted = await loadPlanRepository.delete(decodeURIComponent(loadPlanMatch[1]));

      if (!deleted) {
        sendJson(response, 404, { error: "Load plan not found." });
        return;
      }

      sendJson(response, 200, { deleted: true });
      return;
    }

    if (request.method === "POST" && loadPlanArchiveMatch) {
      const archived = await loadPlanRepository.archive(decodeURIComponent(loadPlanArchiveMatch[1]), new Date().toISOString());

      if (!archived) {
        sendJson(response, 404, { error: "Load plan not found." });
        return;
      }

      sendJson(response, 200, archived);
      return;
    }

    if (request.method === "PUT" && costingMatch) {
      const draft = await readJsonBody(request);
      sendJson(response, 200, await repository.save(draft, {
        existingId: decodeURIComponent(costingMatch[1]),
        now: new Date().toISOString(),
        createId: randomUUID,
      }));
      return;
    }

    if (request.method === "DELETE" && costingMatch) {
      const deleted = await repository.delete(decodeURIComponent(costingMatch[1]));

      if (!deleted) {
        sendJson(response, 404, { error: "Costing not found." });
        return;
      }

      sendJson(response, 200, { deleted: true });
      return;
    }

    if (request.method === "POST" && archiveMatch) {
      const archived = await repository.archive(decodeURIComponent(archiveMatch[1]), new Date().toISOString());

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
