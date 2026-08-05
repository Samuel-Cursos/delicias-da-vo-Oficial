
import {
  db, collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../core/firebase.js";

export let movimentosFinanceiros = [];
export let vendasFinanceiras = [];
export let encomendasFinanceiras = [];
export let custosProdutos = {};
export let fechamentosFinanceiros = [];

function ordenarPorData(lista = []) {
  return [...lista].sort((a,b) => {
    const ta = a.criadoEm?.toMillis?.() || a.criadoEmMs || Date.parse(`${a.dataISO || "1970-01-01"}T${a.hora || "00:00"}`) || 0;
    const tb = b.criadoEm?.toMillis?.() || b.criadoEmMs || Date.parse(`${b.dataISO || "1970-01-01"}T${b.hora || "00:00"}`) || 0;
    return tb - ta;
  });
}

export function observarMovimentosFinanceiros(callback) {
  return onSnapshot(collection(db, "movimentosFinanceiros"), snapshot => {
    movimentosFinanceiros = ordenarPorData(snapshot.docs.map(d => ({ id:d.id, ...d.data() })));
    callback(movimentosFinanceiros, null);
  }, erro => callback(movimentosFinanceiros, erro));
}

export function observarVendasFinanceiras(callback) {
  return onSnapshot(collection(db, "vendas"), snapshot => {
    vendasFinanceiras = ordenarPorData(snapshot.docs.map(d => ({ id:d.id, ...d.data() })));
    callback(vendasFinanceiras, null);
  }, erro => callback(vendasFinanceiras, erro));
}

export function observarEncomendasFinanceiras(callback) {
  return onSnapshot(collection(db, "encomendasFesta"), snapshot => {
    encomendasFinanceiras = ordenarPorData(snapshot.docs.map(d => ({ id:d.id, ...d.data() })));
    callback(encomendasFinanceiras, null);
  }, erro => callback(encomendasFinanceiras, erro));
}

export function observarCustosProdutos(callback) {
  return onSnapshot(collection(db, "custosProdutos"), snapshot => {
    custosProdutos = {};
    snapshot.docs.forEach(d => { custosProdutos[d.id] = { id:d.id, ...d.data() }; });
    callback(custosProdutos, null);
  }, erro => callback(custosProdutos, erro));
}

export async function salvarMovimentoFinanceiro(movimento) {
  const id = movimento.id || `mov-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const referencia = doc(db, "movimentosFinanceiros", id);
  await setDoc(referencia, {
    tipo: movimento.tipo === "saida" ? "saida" : "entrada",
    descricao: String(movimento.descricao || "").trim(),
    categoria: String(movimento.categoria || "Outros").trim(),
    valor: Number(movimento.valor || 0),
    pagamento: String(movimento.pagamento || "Não informado"),
    pagamentos: Array.isArray(movimento.pagamentos) ? movimento.pagamentos.map(item => ({ tipo: String(item.tipo || "Não informado"), valor: Number(item.valor || 0) })).filter(item => item.valor > 0) : [],
    dataISO: movimento.dataISO || new Date().toISOString().slice(0,10),
    hora: movimento.hora || new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
    observacao: String(movimento.observacao || "").trim(),
    origem: String(movimento.origem || "manual"),
    ocrTexto: String(movimento.ocrTexto || "").slice(0, 12000),
    atualizadoEm: serverTimestamp(),
    criadoEm: movimento.criadoEm || serverTimestamp()
  }, { merge:true });

  // Confirma que o documento realmente pode ser lido após a gravação.
  // Assim uma regra do Firestore incorreta não parece um salvamento bem-sucedido.
  const salvo = await getDoc(referencia);
  if (!salvo.exists()) {
    throw new Error("O lançamento não ficou disponível no Firestore após a gravação.");
  }
  return id;
}

export async function excluirMovimentoFinanceiro(id) {
  await deleteDoc(doc(db, "movimentosFinanceiros", id));
}

export async function salvarCustoProduto(produtoId, dados) {
  await setDoc(doc(db, "custosProdutos", produtoId), {
    produtoId,
    nome: String(dados.nome || ""),
    custoUnitario: Number(dados.custoUnitario || 0),
    atualizadoEm: serverTimestamp()
  }, { merge:true });
}


export function observarFechamentosFinanceiros(callback) {
  return onSnapshot(collection(db, "fechamentosFinanceiros"), snapshot => {
    fechamentosFinanceiros = ordenarPorData(snapshot.docs.map(d => ({ id:d.id, ...d.data() })));
    callback(fechamentosFinanceiros, null);
  }, erro => callback(fechamentosFinanceiros, erro));
}

export async function salvarFechamentoFinanceiro(mesId, resumo) {
  await setDoc(doc(db, "fechamentosFinanceiros", mesId), {
    mesId,
    ...resumo,
    fechadoEm: serverTimestamp(),
    criadoEmMs: Date.now()
  }, { merge:true });
}

function dataISOEncomenda(encomenda) {
  if (encomenda.dataEntregaISO) return encomenda.dataEntregaISO;
  if (encomenda.dataFesta) return encomenda.dataFesta;
  if (encomenda.criadoEm?.toDate) return encomenda.criadoEm.toDate().toISOString().slice(0,10);
  return new Date(encomenda.criadoEmMs || Date.now()).toISOString().slice(0,10);
}

export function consolidarFinanceiro() {
  const automáticos = [];

  vendasFinanceiras
    .filter(venda => venda.status !== "cancelada")
    .forEach(venda => {
    automáticos.push({
      id:`venda-${venda.id}`,
      origem:"Venda rápida",
      tipo:"entrada",
      descricao:venda.observacao ? `Venda rápida — ${venda.observacao}` : "Venda rápida",
      categoria:"Vendas",
      valor:Number(venda.total || 0),
      pagamento:venda.pagamento || "Não informado",
      pagamentos:Array.isArray(venda.pagamentos) ? venda.pagamentos : [],
      dataISO:venda.dataISO || "",
      hora:venda.hora || "",
      itens:venda.itens || [],
      automatico:true
    });
  });

  encomendasFinanceiras
    .filter(p => p.status === "entregue")
    .forEach(p => {
      automáticos.push({
        id:`encomenda-${p.id}`,
        origem:"Encomenda entregue",
        tipo:"entrada",
        descricao:`Encomenda ${p.numero || ""} — ${p.cliente?.nome || "Cliente"}`.trim(),
        categoria:"Encomendas",
        valor:Number(p.totalEstimado || 0),
        pagamento:p.pagamento || "Não informado",
        dataISO:dataISOEncomenda(p),
        hora:p.hora || "",
        itens:p.itens || [],
        automatico:true
      });
    });

  const manuais = movimentosFinanceiros.map(m => ({...m, origem:"Manual", automatico:false}));
  return ordenarPorData([...automáticos, ...manuais]);
}

export function calcularCustoItens(itens = []) {
  return itens.reduce((total,item) => {
    const custo = Number(custosProdutos[item.id || item.produtoId]?.custoUnitario || 0);
    return total + custo * Number(item.quantidade || 0);
  }, 0);
}
