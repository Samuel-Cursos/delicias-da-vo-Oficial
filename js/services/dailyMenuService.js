import { db, doc, onSnapshot } from "../core/firebase.js";
import { dataLojaISO } from "./managementCore.js";

export let cardapioDiarioAtual = null;

export function observarCardapioDiario(callback, dataISO = dataLojaISO()) {
  return onSnapshot(doc(db, "cardapiosDiarios", dataISO), snapshot => {
    cardapioDiarioAtual = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    callback?.(cardapioDiarioAtual, null);
  }, erro => {
    cardapioDiarioAtual = null;
    callback?.(cardapioDiarioAtual, erro);
  });
}

export function produtoLiberadoNoCardapio(produtoId) {
  const publicado = cardapioDiarioAtual?.publicado === true
    || cardapioDiarioAtual?.publicado === 1
    || String(cardapioDiarioAtual?.publicado || "").toLowerCase() === "true";
  if (!publicado) return true;
  const ids = Array.isArray(cardapioDiarioAtual.produtoIds) ? cardapioDiarioAtual.produtoIds : [];
  // Sem uma seleção explícita, a publicação do texto não deve esconder
  // todo o catálogo. A filtragem só acontece quando há produtos marcados.
  return ids.length ? ids.includes(String(produtoId)) : true;
}
