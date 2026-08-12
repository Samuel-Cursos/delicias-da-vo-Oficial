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
  if (!cardapioDiarioAtual?.publicado) return true;
  const ids = Array.isArray(cardapioDiarioAtual.produtoIds) ? cardapioDiarioAtual.produtoIds : [];
  return ids.length ? ids.includes(String(produtoId)) : false;
}
