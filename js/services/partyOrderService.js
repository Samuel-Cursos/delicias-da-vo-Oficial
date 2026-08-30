import { db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";
import { APP_CONFIG } from "../core/config.js";

export let encomendasFesta = [];

function codigoAleatorio(tamanho = 5) {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const valores = new Uint32Array(tamanho);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(valores);
  } else {
    valores.forEach((_, indice) => { valores[indice] = Math.floor(Math.random() * alfabeto.length); });
  }

  return Array.from(valores, valor => alfabeto[valor % alfabeto.length]).join("");
}

function dataLojaCompacta(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data).map(parte => [parte.type, parte.value]));

  return `${partes.year}${partes.month}${partes.day}`;
}

function criarNumeroPedido() {
  return `DV-F-${dataLojaCompacta()}-${codigoAleatorio()}`;
}

export function observarEncomendasFesta(callback) {
  return onSnapshot(collection(db, "encomendasFesta"), snapshot => {
    encomendasFesta = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.criadoEm?.toMillis?.() || a.criadoEmMs || 0;
        const tb = b.criadoEm?.toMillis?.() || b.criadoEmMs || 0;
        return tb - ta;
      });
    callback(encomendasFesta, null);
  }, erro => callback(encomendasFesta, erro));
}

export async function registrarEncomendaFesta(dados) {
  const pedidoRef = doc(collection(db, "encomendasFesta"));
  const agora = Date.now();
  const novoPedido = {
    ...dados,
    numero: criarNumeroPedido(),
    status: "aguardando_confirmacao",
    visualizado: false,
    criadoEmMs: agora,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };

  if (APP_CONFIG.previewMode) {
    const simulado = { id: pedidoRef.id, ...novoPedido, criadoEm: new Date(agora).toISOString(), atualizadoEm: new Date(agora).toISOString(), preview: true };
    try {
      const chave = `${APP_CONFIG.storagePreview}:festas`;
      const anteriores = JSON.parse(localStorage.getItem(chave) || "[]");
      localStorage.setItem(chave, JSON.stringify([simulado, ...anteriores].slice(0, 20)));
    } catch {}
    return simulado;
  }
  await setDoc(pedidoRef, novoPedido);
  return { id: pedidoRef.id, ...novoPedido };
}

export async function atualizarStatusEncomendaFesta(id, status) {
  await updateDoc(doc(db, "encomendasFesta", id), {
    status,
    atualizadoEm: serverTimestamp()
  });
}

export async function marcarEncomendaVisualizada(id) {
  await updateDoc(doc(db, "encomendasFesta", id), {
    visualizado: true,
    visualizadoEm: serverTimestamp()
  });
}

export async function excluirEncomendaFesta(id) {
  await deleteDoc(doc(db, "encomendasFesta", id));
}
