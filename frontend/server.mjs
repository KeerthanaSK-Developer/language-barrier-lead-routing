import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT) || 8080;
const API_URL = process.env.API_URL || "http://localhost:8000/api";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

if (!fs.existsSync(DIST)) {
  console.error(`dist folder missing at ${DIST}`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(DIST, "config.js"),
  `window.__APP_CONFIG__ = { API_URL: ${JSON.stringify(API_URL)} };\n`
);

function resolveFile(urlPath) {
  const cleaned = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const relative = cleaned.replace(/^\/+/, "") || "index.html";
  let filePath = path.join(DIST, relative);

  if (!filePath.startsWith(DIST)) {
    return path.join(DIST, "index.html");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return path.join(DIST, "index.html");
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = resolveFile(urlPath);
    const ext = path.extname(filePath).toLowerCase();

    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Frontend listening on http://0.0.0.0:${PORT}`);
  console.log(`API_URL=${API_URL}`);
});
