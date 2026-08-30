const LIMITE_ITEM_CARDAPIO = 120;

export function normalizarItemCardapio(item = "") {
  return String(item ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITE_ITEM_CARDAPIO);
}

export function chaveItemCardapio(item = "") {
  return normalizarItemCardapio(item)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function deduplicarItensCardapio(itens = [], limite = 30) {
  const vistos = new Set();
  const resultado = [];
  const fonte = Array.isArray(itens) ? itens : String(itens || "").split(/\r?\n/);

  for (const item of fonte) {
    const texto = normalizarItemCardapio(item);
    const chave = chaveItemCardapio(texto);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(texto);
    if (resultado.length >= limite) break;
  }
  return resultado;
}

export function itensTextoCardapio(texto = "") {
  return deduplicarItensCardapio(String(texto || "").split(/\r?\n/));
}

export function bibliotecaItensCardapio(cardapios = [], atuais = []) {
  const historico = (Array.isArray(cardapios) ? cardapios : [])
    .slice()
    .sort((a, b) => String(b?.dataISO || b?.id || "").localeCompare(String(a?.dataISO || a?.id || "")));
  const itens = historico.flatMap(cardapio => Array.isArray(cardapio?.itens) ? cardapio.itens : []);
  return deduplicarItensCardapio([...itens, ...(Array.isArray(atuais) ? atuais : [])], 150);
}

export function adicionarItemCardapio(textoAtual = "", item = "") {
  return itensTextoCardapio([...itensTextoCardapio(textoAtual), item].join("\n")).join("\n");
}
