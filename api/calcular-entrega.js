const LIMITE_ENDERECO = 400;
const JANELA_LIMITE_MS = 60_000;
const MAXIMO_POR_MINUTO = 20;
const CACHE_ORIGEM_MS = 24 * 60 * 60 * 1000;

const cacheOrigens = globalThis.__dvCacheOrigensEntrega || new Map();
const acessosPorIp = globalThis.__dvAcessosEntrega || new Map();
globalThis.__dvCacheOrigensEntrega = cacheOrigens;
globalThis.__dvAcessosEntrega = acessosPorIp;

function responderSemCache(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function textoSeguro(valor, limite = LIMITE_ENDERECO) {
  return String(valor || "").trim().replace(/\s+/g, " ").slice(0, limite);
}

function corpoJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function dentroDoLimite(req) {
  const ip = textoSeguro(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "desconhecido", 120)
    .split(",")[0]
    .trim();
  const agora = Date.now();
  const anteriores = (acessosPorIp.get(ip) || []).filter(instante => agora - instante < JANELA_LIMITE_MS);
  anteriores.push(agora);
  acessosPorIp.set(ip, anteriores);
  return anteriores.length <= MAXIMO_POR_MINUTO;
}

async function buscarJson(url, tempoMaximoMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tempoMaximoMs);

  try {
    const resposta = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!resposta.ok) {
      const erro = new Error("Serviço de localização indisponível");
      erro.statusExterno = resposta.status;
      throw erro;
    }

    return await resposta.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocodificar(endereco, apiKey, filtro = "countrycode:br") {
  const parametros = new URLSearchParams({
    text: endereco,
    filter: filtro,
    lang: "pt",
    limit: "1",
    format: "json",
    apiKey
  });
  const dados = await buscarJson(`https://api.geoapify.com/v1/geocode/search?${parametros}`);
  const resultado = dados?.results?.[0];

  if (!resultado || !Number.isFinite(Number(resultado.lat)) || !Number.isFinite(Number(resultado.lon))) {
    return null;
  }

  return {
    lat: Number(resultado.lat),
    lon: Number(resultado.lon),
    formatado: textoSeguro(resultado.formatted || endereco),
    confianca: Number(resultado.rank?.confidence || 0)
  };
}

async function geocodificarOrigem(endereco, apiKey) {
  const chave = endereco.toLocaleLowerCase("pt-BR");
  const cache = cacheOrigens.get(chave);
  if (cache && Date.now() - cache.salvoEm < CACHE_ORIGEM_MS) return cache.valor;

  const valor = await geocodificar(endereco, apiKey);
  if (valor) cacheOrigens.set(chave, { salvoEm: Date.now(), valor });
  return valor;
}

async function calcularRota(origem, destino, apiKey) {
  const parametros = new URLSearchParams({
    waypoints: `${origem.lat},${origem.lon}|${destino.lat},${destino.lon}`,
    mode: "drive",
    type: "balanced",
    units: "metric",
    format: "json",
    apiKey
  });
  const dados = await buscarJson(`https://api.geoapify.com/v1/routing?${parametros}`);
  return dados?.results?.[0] || null;
}

export default async function handler(req, res) {
  responderSemCache(res);

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  if (!dentroDoLimite(req)) {
    return res.status(429).json({ erro: "Muitas consultas seguidas. Aguarde um minuto e tente novamente." });
  }

  const apiKey = textoSeguro(process.env.GEOAPIFY_API_KEY, 300);
  if (!apiKey) {
    return res.status(503).json({
      codigo: "GEOAPIFY_NAO_CONFIGURADA",
      erro: "O cálculo automático de entrega ainda não foi configurado."
    });
  }

  const corpo = corpoJson(req);
  const origemTexto = textoSeguro(corpo.origem);
  const destinoTexto = textoSeguro(corpo.destino);

  if (origemTexto.length < 8 || destinoTexto.length < 8) {
    return res.status(400).json({ erro: "Informe os endereços completos da loja e da entrega." });
  }

  try {
    const origem = await geocodificarOrigem(origemTexto, apiKey);
    if (!origem) {
      return res.status(422).json({ codigo: "ORIGEM_NAO_ENCONTRADA", erro: "Não foi possível localizar o endereço da loja." });
    }

    const filtroDestino = `circle:${origem.lon},${origem.lat},15000|countrycode:br`;
    const destino = await geocodificar(destinoTexto, apiKey, filtroDestino);
    if (!destino) {
      return res.status(422).json({ codigo: "DESTINO_NAO_ENCONTRADO", erro: "Não foi possível localizar o endereço de entrega." });
    }

    const rota = await calcularRota(origem, destino, apiKey);
    const distanciaMetros = Number(rota?.distance);
    const duracaoSegundos = Number(rota?.time);
    if (!Number.isFinite(distanciaMetros) || distanciaMetros <= 0) {
      return res.status(422).json({ codigo: "ROTA_NAO_ENCONTRADA", erro: "Não foi possível calcular uma rota de entrega para esse endereço." });
    }

    return res.status(200).json({
      distanciaKm: Number((distanciaMetros / 1000).toFixed(2)),
      duracaoMin: Number.isFinite(duracaoSegundos) ? Math.max(1, Math.ceil(duracaoSegundos / 60)) : null,
      origemResolvida: origem.formatado,
      destinoResolvido: destino.formatado,
      fonte: "Geoapify"
    });
  } catch (erro) {
    console.error("Falha ao calcular entrega:", erro?.name || "Erro", erro?.statusExterno || "");
    return res.status(502).json({ erro: "O serviço de distância não respondeu agora. Tente novamente em instantes." });
  }
}
