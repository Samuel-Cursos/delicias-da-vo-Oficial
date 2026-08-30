import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = path.join(projectRoot, "dist");
const serverRoot = path.join(distRoot, "server");
const hostingRoot = path.join(distRoot, ".openai");
const includedRoots = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "sitemap.xml",
  "assets",
  "css",
  "js",
  "gestao",
  "pages",
];

async function collectFiles(relativePath, output) {
  const absolutePath = path.join(projectRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => null);

  if (!entries) {
    const contents = await readFile(absolutePath);
    output[`/${relativePath.replaceAll(path.sep, "/")}`] = contents.toString("base64");
    return;
  }

  for (const entry of entries) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(child, output);
    } else if (entry.isFile()) {
      const contents = await readFile(path.join(projectRoot, child));
      output[`/${child.replaceAll(path.sep, "/")}`] = contents.toString("base64");
    }
  }
}

const files = {};
for (const includedRoot of includedRoots) {
  await collectFiles(includedRoot, files);
}

const workerSource = `const files = ${JSON.stringify(files)};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extension(pathname) {
  const dotIndex = pathname.lastIndexOf(".");
  return dotIndex === -1 ? "" : pathname.slice(dotIndex).toLowerCase();
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Endereço inválido", { status: 400 });
    }

    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/gestao" || pathname === "/gestao/") pathname = "/gestao/index.html";

    const encoded = files[pathname];
    if (!encoded) {
      return new Response("Página não encontrada", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const headers = new Headers({
      "content-type": contentTypes[extension(pathname)] || "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (pathname.endsWith(".html") || pathname === "/service-worker.js") {
      headers.set("cache-control", "no-cache");
    } else {
      headers.set("cache-control", "public, max-age=3600");
    }

    return new Response(request.method === "HEAD" ? null : decodeBase64(encoded), {
      status: 200,
      headers,
    });
  },
};
`;

await rm(distRoot, { recursive: true, force: true });
await mkdir(serverRoot, { recursive: true });
await mkdir(hostingRoot, { recursive: true });
await writeFile(path.join(serverRoot, "index.js"), workerSource);
await cp(
  path.join(projectRoot, ".openai", "hosting.json"),
  path.join(hostingRoot, "hosting.json"),
);

console.log(`Empacotados ${Object.keys(files).length} arquivos estáticos.`);
