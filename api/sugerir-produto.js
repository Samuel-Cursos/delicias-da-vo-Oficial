export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  try {
    const { nome } = req.body || {};

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: "Informe o nome do produto." });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        erro: "GEMINI_API_KEY não configurada na Vercel."
      });
    }

    const prompt = `
Você é um assistente de cadastro para uma lanchonete brasileira chamada Delícias da Vó.

Produto informado: "${nome}"

Responda SOMENTE com JSON válido, sem markdown.

Use este formato:
{
  "nome": "Nome corrigido",
  "categoria": "salgados",
  "emoji": "🥖",
  "descricao": "Descrição curta",
  "preco": 8,
  "sabores": [],
  "sobEncomenda": false,
  "destaque": false
}

Categorias permitidas:
salgados, paes, bebidas, outros.
`;

    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        })
      }
    );

    const textoBruto = await resposta.text();

    if (!resposta.ok) {
      return res.status(500).json({
        erro: "Erro ao chamar Gemini.",
        status: resposta.status,
        respostaGemini: textoBruto
      });
    }

    let data;

    try {
      data = JSON.parse(textoBruto);
    } catch {
      return res.status(500).json({
        erro: "Gemini respondeu algo que não é JSON da API.",
        respostaBruta: textoBruto
      });
    }

    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        erro: "Gemini não retornou texto.",
        respostaGemini: data
      });
    }

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    try {
      const produto = JSON.parse(text);
      return res.status(200).json(produto);
    } catch {
      return res.status(500).json({
        erro: "Gemini respondeu texto, mas não era JSON válido.",
        textoGerado: text
      });
    }

  } catch (erro) {
    return res.status(500).json({
      erro: "Erro interno ao gerar sugestão.",
      detalhe: String(erro?.message || erro)
    });
  }
}