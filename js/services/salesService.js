import { db, collection, doc, onSnapshot, serverTimestamp, query, where, runTransaction, getDoc } from "../core/firebase.js";
import { hojeISO, agoraHora } from "../core/utils.js";

export let vendasHoje = [];

export function observarVendasHoje(callback) {
  const q = query(collection(db, "vendas"), where("dataISO", "==", hojeISO()));

  return onSnapshot(q, (snapshot) => {
    vendasHoje = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .filter(venda => venda.status !== "cancelada")
      .sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));

    callback(vendasHoje);
  });
}

function itensValidos(itens) {
  if (!Array.isArray(itens) || !itens.length) throw new Error("Adicione pelo menos um produto.");

  return itens.map(item => {
    const quantidade = Number(item.quantidade || 0);
    if (!item?.id || quantidade <= 0) throw new Error("Item de venda invalido.");
    return { ...item, quantidade };
  });
}

async function atualizarEstoque(transaction, itens, direcao) {
  const registros = await Promise.all(itens.map(async item => {
    const ref = doc(db, "produtos", item.id);
    return { item, ref, snapshot: await transaction.get(ref) };
  }));

  registros.forEach(({ item, ref, snapshot }) => {
    if (!snapshot.exists()) throw new Error("Produto nao encontrado: " + (item.nome || item.id));

    const produto = snapshot.data();
    if (produto.sobEncomenda) return;

    if (item.variacaoId) {
      const variacoes = Array.isArray(produto.variacoes) ? [...produto.variacoes] : [];
      const indice = variacoes.findIndex(variacao => variacao.id === item.variacaoId);
      if (indice < 0) throw new Error("Variacao nao encontrada para " + (item.nome || "o produto"));

      const atual = Number(variacoes[indice].estoque || 0);
      const proximo = atual + direcao * item.quantidade;
      if (proximo < 0) throw new Error("Estoque insuficiente para " + (item.nome || "o produto"));

      transaction.update(ref, {
        ["variacoes." + indice + ".estoque"]: proximo,
        atualizadoEm: serverTimestamp()
      });
      return;
    }

    const atual = Number(produto.estoque || 0);
    const proximo = atual + direcao * item.quantidade;
    if (proximo < 0) throw new Error("Estoque insuficiente para " + (item.nome || "o produto"));

    transaction.update(ref, { estoque: proximo, atualizadoEm: serverTimestamp() });
  });
}

export async function registrarVendaRapida({
  itens = [],
  pagamento,
  pagamentos = [],
  total,
  observacao,
  permitirSemItens = false,
  origem = "venda-rapida"
}) {
  const itensDaVenda = permitirSemItens ? [] : itensValidos(itens);
  const valor = Number(total || 0);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe um valor de venda válido.");

  const pagamentosValidos = Array.isArray(pagamentos)
    ? pagamentos
      .map(item => ({ tipo: String(item?.tipo || "Não informado"), valor: Number(item?.valor || 0) }))
      .filter(item => Number.isFinite(item.valor) && item.valor > 0)
    : [];

  if (pagamentosValidos.length) {
    const somaPagamentos = pagamentosValidos.reduce((soma, item) => soma + item.valor, 0);
    if (Math.abs(somaPagamentos - valor) >= 0.01) {
      throw new Error("A soma das formas de pagamento deve ser igual ao total da venda.");
    }
  }

  const vendaRef = doc(collection(db, "vendas"));
  const venda = {
    tipo: "fisica",
    itens: itensDaVenda,
    pagamento: pagamento || "Não informado",
    pagamentos: pagamentosValidos,
    statusPagamento: "pago",
    total: valor,
    observacao: observacao || "",
    status: "concluida",
    origem,
    semBaixaEstoque: permitirSemItens,
    dataISO: hojeISO(),
    hora: agoraHora(),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };

  await runTransaction(db, async transaction => {
    if (!permitirSemItens) await atualizarEstoque(transaction, itensDaVenda, -1);
    transaction.set(vendaRef, venda);
  });

  const salvo = await getDoc(vendaRef);
  if (!salvo.exists()) throw new Error("A venda não ficou disponível no Firestore após a gravação.");
  return { id: vendaRef.id, ...venda };
}

export async function excluirVendaComEstorno(venda) {
  if (!venda?.id) throw new Error("Venda invalida.");

  await runTransaction(db, async transaction => {
    const vendaRef = doc(db, "vendas", venda.id);
    const snapshot = await transaction.get(vendaRef);
    if (!snapshot.exists()) throw new Error("Venda nao encontrada.");

    const dados = snapshot.data();
    if (dados.status === "cancelada") throw new Error("Esta venda ja foi cancelada.");

    const itensVenda = Array.isArray(dados.itens) ? dados.itens : [];
    if (!dados.semBaixaEstoque && itensVenda.length) {
      await atualizarEstoque(transaction, itensValidos(itensVenda), 1);
    }
    transaction.update(vendaRef, {
      status: "cancelada",
      canceladaEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
  });
}

export function resumoCaixa(vendas) {
  const resumo = {
    Pix: 0,
    Dinheiro: 0,
    "Cartão débito": 0,
    "Cartão crédito": 0,
    Total: 0,
    Quantidade: vendas.length
  };

  vendas.forEach(venda => {
    const detalhes = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
    if (detalhes.length) {
      detalhes.forEach(item => {
        const tipo = item.tipo || "Não informado";
        resumo[tipo] = (resumo[tipo] || 0) + Number(item.valor || 0);
      });
    } else {
      resumo[venda.pagamento] = (resumo[venda.pagamento] || 0) + Number(venda.total || 0);
    }
    resumo.Total += Number(venda.total || 0);
  });

  return resumo;
}
