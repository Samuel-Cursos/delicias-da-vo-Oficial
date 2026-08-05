import { db, doc, getDoc, setDoc, onSnapshot, runTransaction, serverTimestamp } from "../core/firebase.js";

export let resumoPedidosSiteHoje = {
  data: "",
  ultimoNumero: 0,
  totalPedidos: 0,
  ultimoPedido: null
};

export function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

export function dataLocalBR(data = new Date()) {
  return data.toLocaleDateString("pt-BR");
}

export function horaLocalBR(data = new Date()) {
  return data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatarNumeroPedido(numero) {
  return `#${String(numero || 0).padStart(3, "0")}`;
}

export function observarResumoPedidosSiteHoje(callback) {
  const hoje = dataLocalISO();
  const ref = doc(db, "contadoresPedidos", hoje);

  return onSnapshot(ref, snapshot => {
    const dados = snapshot.exists() ? snapshot.data() : {};

    resumoPedidosSiteHoje = {
      data: hoje,
      ultimoNumero: Number(dados.ultimoNumero || 0),
      totalPedidos: Number(dados.totalPedidos || dados.ultimoNumero || 0),
      ultimoPedido: dados.ultimoPedido || null
    };

    if (callback) callback(resumoPedidosSiteHoje);
  });
}

export async function gerarPedidoSite(dadosPedido) {
  const agora = new Date();
  const dataISO = dataLocalISO(agora);
  const dataBR = dataLocalBR(agora);
  const horaBR = horaLocalBR(agora);

  const contadorRef = doc(db, "contadoresPedidos", dataISO);

  const resultado = await runTransaction(db, async transaction => {
    const contadorSnap = await transaction.get(contadorRef);
    const atual = contadorSnap.exists() ? Number(contadorSnap.data().ultimoNumero || 0) : 0;
    const proximo = atual + 1;

    const numeroFormatado = formatarNumeroPedido(proximo);
    const pedidoId = `pedido_${dataISO.replaceAll("-", "")}_${String(proximo).padStart(3, "0")}`;
    const pedidoRef = doc(db, "pedidosSite", dataISO, "pedidos", pedidoId);

    const pedidoFinal = {
      ...dadosPedido,
      id: pedidoId,
      numero: proximo,
      numeroFormatado,
      status: dadosPedido.status || "registrado",
      dataISO,
      dataBR,
      horaBR,
      criadoEm: serverTimestamp()
    };

    transaction.set(pedidoRef, pedidoFinal);

    transaction.set(contadorRef, {
      data: dataISO,
      ultimoNumero: proximo,
      totalPedidos: proximo,
      ultimoPedido: {
        id: pedidoId,
        numero: proximo,
        numeroFormatado,
        dataBR,
        horaBR,
        cliente: dadosPedido?.cliente?.nome || "",
        total: Number(dadosPedido?.total || 0)
      },
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    return pedidoFinal;
  });

  return resultado;
}
