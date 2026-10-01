import { exec } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import app from "./dist/server/index.js";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const clientRoot = resolve(appRoot, "dist", "client");
const host = "127.0.0.1";
const port = 4173;
const appUrl = `http://${host}:${port}`;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".kml": "application/vnd.google-earth.kml+xml; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeClientPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl).pathname);
  const relativePath = normalize(pathname).replace(/^([/\\])+/, "");
  const candidate = resolve(clientRoot, relativePath);
  return candidate.startsWith(`${clientRoot}${process.platform === "win32" ? "\\" : "/"}`)
    ? candidate
    : null;
}

async function fetchStaticAsset(request) {
  const filePath = safeClientPath(request.url);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const body = await import("node:fs/promises").then(({ readFile }) => readFile(filePath));
  return new Response(body, {
    headers: {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "cache-control": filePath.includes(`${join("dist", "client", "assets")}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

const environment = { ASSETS: { fetch: fetchStaticAsset } };

const server = createServer(async (incoming, outgoing) => {
  try {
    const requestUrl = new URL(incoming.url ?? "/", appUrl);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }

    const requestInit = { method: incoming.method, headers };
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      requestInit.body = incoming;
      requestInit.duplex = "half";
    }

    const pending = [];
    const context = {
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
      passThroughOnException() {},
    };
    // Serve bundled browser files before framework routing, which can reject /assets.
    const request = new Request(requestUrl, requestInit);
    const assetPath = safeClientPath(requestUrl.href);
    const isStatic = (incoming.method === "GET" || incoming.method === "HEAD")
      && assetPath && existsSync(assetPath) && statSync(assetPath).isFile();
    const response = isStatic
      ? await fetchStaticAsset(request)
      : await app.fetch(request, environment, context);

    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    if (incoming.method === "HEAD" || !response.body) outgoing.end();
    else outgoing.end(Buffer.from(await response.arrayBuffer()));
    void Promise.allSettled(pending);
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain" });
    outgoing.end("The local app encountered an error. See this window for details.");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Close the other app window and try again.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`App running at ${appUrl}`);
  if (process.platform === "win32") exec(`start "" "${appUrl}"`);
  if (process.platform === "darwin") exec(`open "${appUrl}"`);
});
