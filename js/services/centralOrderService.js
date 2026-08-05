
import {
  db, collection, collectionGroup, doc, onSnapshot, updateDoc, serverTimestamp
} from "../core/firebase.js";

export let pedidosNormaisCentral = [];
export let vendasCentral = [];
export let encomendasCentral = [];

function ordenar(lista) {
  return [...lista].sort((a,b) => {
    const ta = a.criadoEm?.toMillis?.() || a.criadoEmMs || Date.parse(`${a.dataISO || "1970-01-01"}T${a.hora || a.horaBR || "00:00"}`) || 0;
    const tb = b.criadoEm?.toMillis?.() || b.criadoEmMs || Date.parse(`${b.dataISO || "1970-01-01"}T${b.hora || b.horaBR || "00:00"}`) || 0;
    return tb-ta;
  });
}

export function observarPedidosNormaisCentral(callback) {
  return onSnapshot(collectionGroup(db,"pedidos"), snapshot => {
    pedidosNormaisCentral = ordenar(snapshot.docs
      .filter(item => item.ref.path.startsWith("pedidosSite/"))
      .map(item => ({ id:item.id, caminho:item.ref.path, ...item.data() })));
    callback(pedidosNormaisCentral,null);
  }, erro => callback(pedidosNormaisCentral,erro));
}

export function observarVendasCentral(callback) {
  return onSnapshot(collection(db,"vendas"), snapshot => {
    vendasCentral = ordenar(snapshot.docs.map(item => ({ id:item.id, ...item.data() })));
    callback(vendasCentral,null);
  }, erro => callback(vendasCentral,erro));
}

export function observarEncomendasCentral(callback) {
  return onSnapshot(collection(db,"encomendasFesta"), snapshot => {
    encomendasCentral = ordenar(snapshot.docs.map(item => ({ id:item.id, ...item.data() })));
    callback(encomendasCentral,null);
  }, erro => callback(encomendasCentral,erro));
}

export function consolidarCentralPedidos() {
  const normais = pedidosNormaisCentral.map(p => ({
    ...p,
    chave:`normal:${p.caminho}`,
    origem:"Pedido do site",
    origemTipo:"normal",
    numeroExibicao:p.numeroFormatado || p.numero || p.id,
    clienteNome:p.cliente?.nome || "Cliente",
    status:p.status || "registrado",
    dataExibicao:p.dataBR || p.dataISO || "",
    horaExibicao:p.horaBR || "",
    valor:Number(p.total || 0)
  }));

  const vendas = vendasCentral.map(v => ({
    ...v,
    chave:`venda:${v.id}`,
    origem:"Venda rápida",
    origemTipo:"venda",
    numeroExibicao:`VEN-${String(v.id).slice(-5).toUpperCase()}`,
    clienteNome:v.cliente?.nome || "Venda de balcão",
    status:v.status || "concluida",
    dataExibicao:v.dataISO || "",
    horaExibicao:v.hora || "",
    valor:Number(v.total || 0)
  }));

  const encomendas = encomendasCentral.map(p => ({
    ...p,
    chave:`festa:${p.id}`,
    origem:"Encomenda de festa",
    origemTipo:"festa",
    numeroExibicao:p.numero || p.id,
    clienteNome:p.cliente?.nome || "Cliente",
    dataExibicao:p.dataFesta || "",
    horaExibicao:p.hora || "",
    valor:Number(p.totalEstimado || 0)
  }));

  return ordenar([...normais,...vendas,...encomendas]);
}

export async function atualizarStatusPedidoNormal(caminho,status) {
  const segmentos=String(caminho).split("/").filter(Boolean);
  await updateDoc(doc(db,...segmentos), { status, atualizadoEm:serverTimestamp() });
}

export async function atualizarStatusVenda(id,status) {
  await updateDoc(doc(db,"vendas",id), { status, atualizadoEm:serverTimestamp() });
}
