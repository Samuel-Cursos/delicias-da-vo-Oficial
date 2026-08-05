const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyCQzlseF8cyjwPIvX3TjPCznZojDMV2SIo";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "deliciasdavo54@gmail.com").toLowerCase();
const LIMITE_NOME = 100;

function responderSemCache(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
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

function extrairJson(texto = "") {
  const limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(limpo);
}

function normalizarProduto(produto = {}) {
  const categorias = new Set(["salgados", "paes", "bebidas", "outros"]);
  const categoria = categorias.has(produto.categoria) ? produto.categoria : "outros";
  const preco = Math.max(0, Math.min(10000, Number(produto.preco || 0)));

  return {
    nome: String(produto.nome || "Produto").slice(0, 100),
    categoria,
    emoji: String(produto.emoji || "🍽️").slice(0, 12),
    descricao: String(produto.descricao || "").slice(0, 220),
    preco,
    sabores: Array.isArray(produto.sabores)
      ? produto.sabores.map(sabor => String(sabor).slice(0, 80)).slice(0, 20)
      : [],
    sobEncomenda: Boolean(produto.sobEncomenda),
    destaque: Boolean(produto.destaque)
  };
}

export default async function handler(req, res) {
  responderSemCache(res);

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  try {
    if (!(await verificarAdministrador(req))) {
      return res.status(401).json({ erro: "Acesso permitido somente ao administrador." });
    }

    const nome = String(req.body?.nome || "").trim().slice(0, LIMITE_NOME);

    if (!nome) {
      return res.status(400).json({ erro: "Informe o nome do produto." });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ erro: "A IA ainda não foi configurada na Vercel." });
    }

    const prompt = `Você auxilia o cadastro de produtos da lanchonete brasileira Delícias da Vó.
Produto informado: ${JSON.stringify(nome)}

Responda somente com JSON válido, sem markdown, no formato:
{"nome":"Nome corrigido","categoria":"salgados","emoji":"🥖","descricao":"Descrição curta","preco":8,"sabores":[],"sobEncomenda":false,"destaque":false}

Categorias permitidas: salgados, paes, bebidas, outros.`;

    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!resposta.ok) {
      console.error("Gemini respondeu com status", resposta.status);
      return res.status(502).json({ erro: "A IA não respondeu agora. Tente novamente em instantes." });
    }

    const data = await resposta.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texto) {
      return res.status(502).json({ erro: "A IA não retornou uma sugestão válida." });
    }

    return res.status(200).json(normalizarProduto(extrairJson(texto)));
  } catch (erro) {
    console.error("Erro em sugerir-produto:", erro);
    return res.status(500).json({ erro: "Não foi possível gerar a sugestão agora." });
  }
}
