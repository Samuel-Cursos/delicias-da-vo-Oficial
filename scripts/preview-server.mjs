import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const argumentos = process.argv.slice(2);
const portaIndice = argumentos.indexOf("--port");
const porta = Number(portaIndice >= 0 ? argumentos[portaIndice + 1] : 4173) || 4173;
const tipos = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8"
};

function caminhoSeguro(urlPath) {
  let decodificado;
  try { decodificado = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const relativo = decodificado === "/" ? "index.html" : decodificado.replace(/^\/+/, "");
  const absoluto = path.resolve(root, relativo);
  return absoluto === root || absoluto.startsWith(`${root}${path.sep}`) ? absoluto : null;
}

const servidor = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("Método não permitido");
  }
  const pedido = caminhoSeguro(req.url || "/");
  if (!pedido) { res.writeHead(400); return res.end("Endereço inválido"); }
  let arquivo = pedido;
  try {
    const informacao = await stat(arquivo);
    if (informacao.isDirectory()) arquivo = path.join(arquivo, "index.html");
    await stat(arquivo);
    res.writeHead(200, {
      "Content-Type": tipos[path.extname(arquivo).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(arquivo).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Página não encontrada");
  }
});

servidor.listen(porta, "0.0.0.0", () => {
  console.log(`Servidor de revisão ativo na porta ${porta}`);
});
