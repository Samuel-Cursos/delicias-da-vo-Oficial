import { db, collection, doc, setDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

const FUSO_LOJA = "America/Sao_Paulo";

export let resumoPedidosSiteHoje = {
  data: "",
  ultimoNumero: 0,
  totalPedidos: 0,
  ultimoPedido: null
};

function partesData(data = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_LOJA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data);

  return Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
}

export function dataLocalISO(data = new Date()) {
  const partes = partesData(data);
  return `${partes.year}-${partes.month}-${partes.day}`;
}

export function dataLocalBR(data = new Date()) {
  const partes = partesData(data);
  return `${partes.day}/${partes.month}/${partes.year}`;
}

export function horaLocalBR(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_LOJA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(data);
}

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

function criarNumeroPedido(dataISO) {
  const dataCurta = dataISO.replaceAll("-", "").slice(2);
  return `DV-${dataCurta}-${codigoAleatorio()}`;
}

export function formatarNumeroPedido(numero) {
  if (typeof numero === "string") return numero;
  return `#${String(numero || 0).padStart(3, "0")}`;
}

export function observarResumoPedidosSiteHoje(callback) {
  const hoje = dataLocalISO();
  const ref = collection(db, "pedidosSite", hoje, "pedidos");

  return onSnapshot(ref, snapshot => {
    const pedidos = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => Number(b.criadoEmMs || 0) - Number(a.criadoEmMs || 0));

    const ultimo = pedidos[0] || null;

    resumoPedidosSiteHoje = {
      data: hoje,
      ultimoNumero: pedidos.length,
      totalPedidos: pedidos.length,
      ultimoPedido: ultimo ? {
        id: ultimo.id,
        numero: ultimo.numero,
        numeroFormatado: ultimo.numeroFormatado || ultimo.numero,
        dataBR: ultimo.dataBR || "",
        horaBR: ultimo.horaBR || "",
        cliente: ultimo.cliente?.nome || "",
        total: Number(ultimo.total || 0)
      } : null
    };

    callback?.(resumoPedidosSiteHoje, null);
  }, erro => callback?.(resumoPedidosSiteHoje, erro));
}

export async function gerarPedidoSite(dadosPedido) {
  const agora = new Date();
  const dataISO = dataLocalISO(agora);
  const dataBR = dataLocalBR(agora);
  const horaBR = horaLocalBR(agora);
  const numeroFormatado = criarNumeroPedido(dataISO);
  const pedidoRef = doc(collection(db, "pedidosSite", dataISO, "pedidos"));

  const pedidoFinal = {
    ...dadosPedido,
    id: pedidoRef.id,
    numero: numeroFormatado,
    numeroFormatado,
    status: dadosPedido.status || "registrado",
    dataISO,
    dataBR,
    horaBR,
    criadoEmMs: agora.getTime(),
    criadoEm: serverTimestamp()
  };

  await setDoc(pedidoRef, pedidoFinal);
  return pedidoFinal;
}
