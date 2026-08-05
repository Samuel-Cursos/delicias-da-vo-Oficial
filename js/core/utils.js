export function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function limparTexto(texto) { return String(texto || "").trim(); }
export function gerarId(nome) {
  return limparTexto(nome).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString().slice(-5);
}
export function hojeISO() { return new Date().toISOString().slice(0, 10); }
export function agoraHora() { return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
export function salvarLocal(chave, valor) { localStorage.setItem(chave, JSON.stringify(valor)); }
export function carregarLocal(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave)) || padrao; } catch { return padrao; } }
