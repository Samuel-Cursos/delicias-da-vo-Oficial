const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyCQzlseF8cyjwPIvX3TjPCznZojDMV2SIo";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "deliciasdavo54@gmail.com").toLowerCase();
const LIMITE_DATA_URL = 4_000_000;
const JANELA_LIMITE_MS = 60_000;
const MAXIMO_POR_MINUTO = 12;

const acessosPorIp = globalThis.__dvAcessosScannerIa || new Map();
globalThis.__dvAcessosScannerIa = acessosPorIp;

function responderSemCache(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function textoSeguro(valor, limite = 500) {
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

async function verificarAdministrador(req) {
  const cabecalho = String(req.headers.authorization || "");
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!token) return false;

  const resposta = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    }
  );
  if (!resposta.ok) return false;

  const dados = await resposta.json();
  const email = String(dados?.users?.[0]?.email || "").toLowerCase();
  return Boolean(email) && email === ADMIN_EMAIL;
}

function extrairImagem(dataUrl = "") {
  if (typeof dataUrl !== "string" || dataUrl.length > LIMITE_DATA_URL) return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length < 100) return null;
  return { mimeType: match[1], data: match[2] };
}

function extrairJson(texto = "") {
  return JSON.parse(String(texto).replace(/```json/gi, "").replace(/```/g, "").trim());
}

function normalizarPagamento(valor = "") {
  const texto = String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (texto.includes("misto")) return "Pagamento misto";
  if (texto.includes("pix")) return "Pix";
  if (texto.includes("dinheiro") || texto.includes("especie")) return "Dinheiro";
  if (texto.includes("debito")) return "Cartão débito";
  if (texto.includes("credito")) return "Cartão crédito";
  return "Não informado";
}

function normalizarResultado(resultado = {}) {
  const valor = Math.max(0, Math.min(1_000_000, Number(resultado.valor || 0)));
  const subtotal = Math.max(0, Math.min(1_000_000, Number(resultado.subtotal || 0)));
  const desconto = Math.max(0, Math.min(1_000_000, Number(resultado.desconto || 0)));
  const pagamentos = Array.isArray(resultado.pagamentos)
    ? resultado.pagamentos
      .map(item => ({
        tipo: normalizarPagamento(item?.tipo),
        valor: Math.max(0, Math.min(1_000_000, Number(item?.valor || 0)))
      }))
      .filter(item => item.tipo !== "Não informado" && item.valor > 0)
      .slice(0, 4)
    : [];
  const tipos = [...new Set(pagamentos.map(item => item.tipo))];
  const pagamentoInformado = normalizarPagamento(resultado.pagamento);
  const pagamento = tipos.length > 1 ? "Pagamento misto" : (tipos[0] || pagamentoInformado);

  return {
    valor: Number(valor.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    desconto: Number(desconto.toFixed(2)),
    pagamento,
    pagamentos,
    confianca: Math.round(Math.max(0, Math.min(100, Number(resultado.confianca || 0)))),
    textoReconhecido: textoSeguro(resultado.textoReconhecido || "", 2500),
    observacao: textoSeguro(resultado.observacao || "", 300),
    origem: "gemini"
  };
}

function normalizarResultadoCardapio(resultado = {}) {
  const candidatos = Array.isArray(resultado.itens) && resultado.itens.length
    ? resultado.itens
    : String(resultado.textoReconhecido || "").split(/[\n•;]+/);
  const vistos = new Set();
  const itens = candidatos.map(item => textoSeguro(item, 120)).filter(item => {
    const chave = item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  }).slice(0, 40);
  return {
    itens,
    titulo: textoSeguro(resultado.titulo || "", 120),
    observacao: textoSeguro(resultado.observacao || "", 500),
    confianca: Math.round(Math.max(0, Math.min(100, Number(resultado.confianca || 0)))),
    textoReconhecido: textoSeguro(resultado.textoReconhecido || itens.join(" • "), 2500),
    origem: "gemini"
  };
}

async function chamarGemini(imagem, modo, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const ehCardapio = modo === "cardapio";
  const contexto = modo === "compra" ? "uma compra/despesa" : "uma venda recebida";
  const prompt = ehCardapio
    ? `Analise esta imagem de um cardápio de comida brasileira criado para publicação no Instagram.

Extraia SOMENTE:
- cada prato ou item de comida legível, um por entrada, preservando o nome escrito na arte;
- o título do cardápio, se existir;
- uma observação do dia, se existir;
- uma transcrição curta do texto relevante para conferência.

Regras:
- Não invente pratos, ingredientes, preços ou informações que não estejam visíveis.
- Ignore logotipo, telefone, endereço, hashtags e chamadas que não sejam itens do cardápio.
- Se um item não estiver legível, não tente adivinhar.
- Itens repetidos devem aparecer somente uma vez.
- A confiança deve ser um número inteiro de 0 a 100.`
    : `Analise esta foto de uma anotação brasileira de ${contexto}. A escrita pode ser cursiva.

Extraia SOMENTE:
- o valor total final já com descontos;
- quando aparecerem claramente, o subtotal antes do desconto e o desconto aplicado;
- a forma de pagamento: Pix, Dinheiro, Cartão débito, Cartão crédito, Pagamento misto ou Não informado;
- no pagamento misto, o valor de cada forma;
- uma transcrição curta do trecho que justificou a leitura.

Regras:
- Nunca invente valor ou pagamento.
- Se não estiver legível, use valor 0 e confiança baixa.
- Ignore datas, telefones, quantidades e valores que não sejam o total final.
- Se subtotal ou desconto não estiverem claros, retorne 0 nesses campos.
- Converta vírgula decimal brasileira corretamente. Exemplo: 18,50 = 18.5.
- A confiança deve ser um número inteiro de 0 a 100.`;
  const responseSchema = ehCardapio
    ? {
      type: "OBJECT",
      properties: {
        itens: { type: "ARRAY", items: { type: "STRING" } },
        titulo: { type: "STRING" },
        observacao: { type: "STRING" },
        confianca: { type: "INTEGER" },
        textoReconhecido: { type: "STRING" }
      },
      required: ["itens", "titulo", "observacao", "confianca", "textoReconhecido"]
    }
    : {
      type: "OBJECT",
      properties: {
        valor: { type: "NUMBER" },
        subtotal: { type: "NUMBER" },
        desconto: { type: "NUMBER" },
        pagamento: {
          type: "STRING",
          enum: ["Pix", "Dinheiro", "Cartão débito", "Cartão crédito", "Pagamento misto", "Não informado"]
        },
        pagamentos: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              tipo: { type: "STRING" },
              valor: { type: "NUMBER" }
            },
            required: ["tipo", "valor"]
          }
        },
        confianca: { type: "INTEGER" },
        textoReconhecido: { type: "STRING" },
        observacao: { type: "STRING" }
      },
      required: ["valor", "subtotal", "desconto", "pagamento", "pagamentos", "confianca", "textoReconhecido", "observacao"]
    };

  try {
    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType: imagem.mimeType, data: imagem.data } }
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema
          }
        })
      }
    );

    if (!resposta.ok) {
      const erro = new Error(resposta.status === 429 ? "Limite gratuito atingido" : "Gemini indisponível");
      erro.statusExterno = resposta.status;
      throw erro;
    }

    const dados = await resposta.json();
    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error("Leitura vazia");
    const resultado = extrairJson(texto);
    return ehCardapio ? normalizarResultadoCardapio(resultado) : normalizarResultado(resultado);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  responderSemCache(res);

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }
  if (!dentroDoLimite(req)) {
    return res.status(429).json({ codigo: "MUITAS_LEITURAS", erro: "Muitas leituras seguidas. Aguarde um minuto e tente novamente." });
  }

  try {
    if (!(await verificarAdministrador(req))) {
      return res.status(401).json({ erro: "Acesso permitido somente ao administrador." });
    }

    const apiKey = textoSeguro(process.env.GEMINI_API_KEY, 300);
    if (!apiKey) {
      return res.status(503).json({ codigo: "IA_NAO_CONFIGURADA", erro: "A leitura inteligente ainda não foi configurada na Vercel." });
    }

    const corpo = corpoJson(req);
    const imagem = extrairImagem(corpo.imagem);
    if (!imagem) {
      return res.status(400).json({ erro: "A imagem é inválida ou ficou grande demais." });
    }
    const modo = ["compra", "cardapio"].includes(corpo.modo) ? corpo.modo : "venda";
    return res.status(200).json(await chamarGemini(imagem, modo, apiKey));
  } catch (erro) {
    console.error("Falha na leitura inteligente:", erro?.name || "Erro", erro?.statusExterno || "");
    if (erro?.statusExterno === 429) {
      return res.status(429).json({ codigo: "LIMITE_IA", erro: "O limite gratuito da leitura inteligente foi atingido. Use a leitura local por enquanto." });
    }
    if (erro?.name === "AbortError") {
      return res.status(504).json({ codigo: "TEMPO_IA", erro: "A leitura demorou demais. Tente novamente ou use a leitura local." });
    }
    return res.status(502).json({ erro: "Não foi possível ler essa foto com a IA agora. Use a leitura local ou digite o valor." });
  }
}
