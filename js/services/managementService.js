import {
  db, collection, collectionGroup, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, runTransaction
} from "../core/firebase.js";
import { dataLojaISO, horaLoja, numeroSeguro } from "./managementCore.js";
import { deduplicarItensCardapio } from "./menuLibrary.js";

export const estadoGestao = {
  pedidosSite: [],
  pedidosManuais: [],
  encomendas: [],
  solicitacoesEmpresas: [],
  vendas: [],
  produtos: [],
  usuarios: [],
  movimentosFinanceiros: [],
  custosProdutos: [],
  fechamentosFinanceiros: [],
  insumos: [],
  movimentacoesEstoque: [],
  fichasTecnicas: [],
  fornecedores: [],
  compras: [],
  cardapios: [],
  sessoesCaixa: [],
  movimentosCaixa: [],
  perdasEstoque: [],
  equipe: [],
  convitesEquipe: [],
  solicitacoesAcesso: [],
  configuracaoOperacao: {},
  erros: {}
};

export function limparEstadoGestao() {
  Object.keys(estadoGestao).forEach(chave => {
    if (Array.isArray(estadoGestao[chave])) estadoGestao[chave] = [];
  });
  estadoGestao.configuracaoOperacao = {};
  estadoGestao.erros = {};
}

function ordenar(lista = []) {
  return [...lista].sort((a, b) => {
    const ta = a.criadoEm?.toMillis?.() || numeroSeguro(a.criadoEmMs) || Date.parse(`${a.dataISO || a.dataFesta || "1970-01-01"}T${a.hora || a.horaBR || "00:00"}`) || 0;
    const tb = b.criadoEm?.toMillis?.() || numeroSeguro(b.criadoEmMs) || Date.parse(`${b.dataISO || b.dataFesta || "1970-01-01"}T${b.hora || b.horaBR || "00:00"}`) || 0;
    return tb - ta;
  });
}

function observarColecao(nome, referencia, aoMudar, mapear = item => ({ id: item.id, ...item.data() })) {
  return onSnapshot(referencia, snapshot => {
    estadoGestao[nome] = ordenar(snapshot.docs.map(mapear).filter(Boolean));
    delete estadoGestao.erros[nome];
    aoMudar?.(estadoGestao, { nome });
  }, erro => {
    estadoGestao.erros[nome] = erro;
    aoMudar?.(estadoGestao, { nome, erro });
  });
}

export function iniciarObservadoresGestao(aoMudar, acesso = {}) {
  const permissoes = acesso.permissoes || {};
  const permitido = (...nomes) => Boolean(acesso.admin || nomes.some(nome => permissoes[nome]));
  const cancelar = [];
  const adicionar = (...args) => cancelar.push(observarColecao(...args));

  // Produtos, cardápio e configuração pública são a base de quase todas as telas.
  adicionar("produtos", collection(db, "produtos"), aoMudar);
  adicionar("cardapios", collection(db, "cardapiosDiarios"), aoMudar);

  if (permitido("pedidos", "cozinha", "entregas", "clientes", "relatorios")) {
    adicionar("pedidosSite", collectionGroup(db, "pedidos"), aoMudar, item => item.ref.path.startsWith("pedidosSite/") ? ({
      id: item.id,
      caminho: item.ref.path,
      ...item.data()
    }) : null);
    adicionar("pedidosManuais", collection(db, "pedidosManuais"), aoMudar);
    adicionar("encomendas", collection(db, "encomendasFesta"), aoMudar);
  }
  if (permitido("empresas")) adicionar("solicitacoesEmpresas", collection(db, "solicitacoesEmpresas"), aoMudar);
  if (permitido("caixa", "financeiro", "relatorios")) adicionar("vendas", collection(db, "vendas"), aoMudar);
  if (permitido("clientes")) adicionar("usuarios", collection(db, "usuarios"), aoMudar);
  if (permitido("financeiro", "caixa", "relatorios")) adicionar("movimentosFinanceiros", collection(db, "movimentosFinanceiros"), aoMudar);
  if (permitido("financeiro", "estoque", "relatorios")) adicionar("custosProdutos", collection(db, "custosProdutos"), aoMudar);
  if (permitido("financeiro", "relatorios")) adicionar("fechamentosFinanceiros", collection(db, "fechamentosFinanceiros"), aoMudar);
  if (permitido("estoque", "compras", "relatorios")) {
    adicionar("insumos", collection(db, "estoqueInsumos"), aoMudar);
    adicionar("movimentacoesEstoque", collection(db, "movimentacoesEstoque"), aoMudar);
  }
  if (permitido("estoque", "compras", "financeiro", "relatorios")) adicionar("fichasTecnicas", collection(db, "fichasTecnicas"), aoMudar);
  if (permitido("compras", "financeiro")) adicionar("fornecedores", collection(db, "fornecedores"), aoMudar);
  if (permitido("compras", "financeiro", "relatorios")) adicionar("compras", collection(db, "compras"), aoMudar);
  if (permitido("caixa", "financeiro")) {
    adicionar("sessoesCaixa", collection(db, "sessoesCaixa"), aoMudar);
    adicionar("movimentosCaixa", collection(db, "movimentosCaixa"), aoMudar);
  }
  if (permitido("estoque", "financeiro", "relatorios")) adicionar("perdasEstoque", collection(db, "perdasEstoque"), aoMudar);
  if (acesso.admin) {
    adicionar("equipe", collection(db, "equipe"), aoMudar);
    adicionar("convitesEquipe", collection(db, "convitesEquipe"), aoMudar);
    adicionar("solicitacoesAcesso", collection(db, "solicitacoesAcesso"), aoMudar);
  }

  if (permitido("pedidos", "cozinha", "entregas", "empresas", "caixa", "estoque", "compras", "financeiro", "clientes", "relatorios", "configuracoes")) {
    cancelar.push(onSnapshot(doc(db, "configuracoes", "operacao"), snapshot => {
      estadoGestao.configuracaoOperacao = snapshot.exists() ? snapshot.data() : {};
      aoMudar?.(estadoGestao, { nome: "configuracaoOperacao" });
    }, erro => {
      estadoGestao.erros.configuracaoOperacao = erro;
      aoMudar?.(estadoGestao, { nome: "configuracaoOperacao", erro });
    }));
  }

  return () => cancelar.forEach(parar => parar?.());
}

function codigoAleatorio(tamanho = 5) {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const valores = new Uint32Array(tamanho);
  globalThis.crypto?.getRandomValues?.(valores);
  return Array.from(valores, valor => alfabeto[valor % alfabeto.length]).join("");
}

function referenciaPedido(pedido) {
  if (pedido.origemTipo === "site" && pedido.caminho) return doc(db, ...pedido.caminho.split("/"));
  if (pedido.origemTipo === "manual") return doc(db, "pedidosManuais", pedido.id);
  if (pedido.origemTipo === "festa") return doc(db, "encomendasFesta", pedido.id);
  throw new Error("Origem de pedido desconhecida.");
}

function itensAgrupados(itens = []) {
  const mapa = new Map();
  itens.forEach(item => {
    if (!item?.id) return;
    const chave = `${item.id}|${item.variacaoId || ""}`;
    const atual = mapa.get(chave) || { ...item, quantidade: 0 };
    atual.quantidade += Math.max(0, numeroSeguro(item.quantidade));
    mapa.set(chave, atual);
  });
  return [...mapa.values()].filter(item => item.quantidade > 0);
}

function aplicarQuantidadeProduto(produto, item, direcao) {
  const quantidade = Math.max(0, numeroSeguro(item.quantidade));
  if (!quantidade || produto.sobEncomenda) return null;

  if (item.variacaoId && Array.isArray(produto.variacoes)) {
    const variacoes = produto.variacoes.map(variacao => ({ ...variacao }));
    const indice = variacoes.findIndex(variacao => variacao.id === item.variacaoId);
    if (indice < 0 || variacoes[indice].sobEncomenda) return null;
    const atual = numeroSeguro(variacoes[indice].estoque);
    const proximo = atual + direcao * quantidade;
    if (proximo < 0) throw new Error(`Estoque insuficiente para ${produto.nome} — ${variacoes[indice].nome}.`);
    variacoes[indice].estoque = proximo;
    return { variacoes, atualizadoEm: serverTimestamp() };
  }

  const atual = numeroSeguro(produto.estoque);
  const proximo = atual + direcao * quantidade;
  if (proximo < 0) throw new Error(`Estoque insuficiente para ${produto.nome || item.nome}.`);
  return { estoque: proximo, atualizadoEm: serverTimestamp() };
}

async function atualizarPedidoEEstoque(pedido, status) {
  const pedidoRef = referenciaPedido(pedido);
  const baixaHabilitada = estadoGestao.configuracaoOperacao.baixaEstoque !== false;
  const deveBaixar = baixaHabilitada && ["confirmado", "producao", "pronto", "saiu_entrega", "entregue"].includes(status);
  const deveEstornar = ["cancelado", "cancelada"].includes(status);

  await runTransaction(db, async transaction => {
    const snapshotPedido = await transaction.get(pedidoRef);
    if (!snapshotPedido.exists()) throw new Error("Pedido não encontrado.");
    const atual = snapshotPedido.data();
    const itens = pedido.origemTipo === "festa" ? [] : itensAgrupados(atual.itens);
    const baixarAgora = deveBaixar && !atual.estoqueBaixado;
    const estornarAgora = deveEstornar && atual.estoqueBaixado && !atual.estoqueEstornado;
    const direcao = baixarAgora ? -1 : estornarAgora ? 1 : 0;

    if (direcao && itens.length) {
      const grupos = new Map();
      itens.forEach(item => grupos.set(item.id, [...(grupos.get(item.id) || []), item]));
      const gruposLista = [...grupos.entries()];
      const referencias = gruposLista.map(([produtoId]) => doc(db, "produtos", produtoId));
      const snapshots = await Promise.all(referencias.map(ref => transaction.get(ref)));
      snapshots.forEach((snapshotProduto, indice) => {
        if (!snapshotProduto.exists()) return;
        let produtoAtual = snapshotProduto.data();
        let alteracaoFinal = null;
        gruposLista[indice][1].forEach(item => {
          const alteracao = aplicarQuantidadeProduto(produtoAtual, item, direcao);
          if (!alteracao) return;
          produtoAtual = { ...produtoAtual, ...alteracao };
          alteracaoFinal = { ...(alteracaoFinal || {}), ...alteracao };
        });
        if (alteracaoFinal) transaction.update(referencias[indice], alteracaoFinal);
      });
    }

    transaction.update(pedidoRef, {
      status,
      ...(baixarAgora ? { estoqueBaixado: true, estoqueBaixadoEm: serverTimestamp(), estoqueEstornado: false } : {}),
      ...(estornarAgora ? { estoqueEstornado: true, estoqueEstornadoEm: serverTimestamp() } : {}),
      atualizadoEm: serverTimestamp()
    });
  });
}

async function sincronizarFinanceiroPedido(pedido, status) {
  // Encomendas já entram automaticamente nos relatórios pelo documento original.
  // Criar outro movimento aqui duplicaria a mesma receita.
  if (pedido.origemTipo === "festa") return;
  const idSeguro = `${pedido.origemTipo}-${pedido.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const ref = doc(db, "movimentosFinanceiros", `pedido-${idSeguro}`);
  if (["cancelado", "cancelada"].includes(status)) {
    if (!["entregue", "concluido", "concluida", "finalizado"].includes(pedido.status)) return;
    const existente = await getDoc(ref);
    if (existente.exists()) await deleteDoc(ref);
    return;
  }
  if (status !== "entregue") return;

  await setDoc(ref, {
    tipo: "entrada",
    descricao: `Pedido ${pedido.numeroExibicao || pedido.numero || pedido.id} — ${pedido.clienteNome || "Cliente"}`,
    categoria: pedido.origemTipo === "festa" ? "Encomendas" : "Pedidos",
    valor: numeroSeguro(pedido.valor || pedido.total || pedido.totalEstimado),
    pagamento: pedido.pagamento || "Não informado",
    pagamentos: Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [],
    dataISO: dataLojaISO(),
    hora: horaLoja(),
    observacao: "Entrada automática ao concluir o pedido no sistema de gestão.",
    origem: `pedido-${pedido.origemTipo}`,
    pedidoId: pedido.id,
    atualizadoEm: serverTimestamp(),
    criadoEm: serverTimestamp()
  }, { merge: true });
}

export async function atualizarStatusPedidoGestao(pedido, status) {
  await atualizarPedidoEEstoque(pedido, status);
  await sincronizarFinanceiroPedido(pedido, status);
}

export async function salvarPedidoManual(dados = {}) {
  const agora = Date.now();
  const referencia = doc(collection(db, "pedidosManuais"));
  const totalItens = (dados.itens || []).reduce((soma, item) => soma + numeroSeguro(item.preco) * numeroSeguro(item.quantidade), 0);
  const taxaEntrega = dados.tipo === "Entrega" ? numeroSeguro(dados.taxaEntrega) : 0;
  const total = Math.max(0, numeroSeguro(dados.total || totalItens + taxaEntrega));
  if (!dados.cliente?.nome) throw new Error("Informe o nome do cliente.");
  if (!(dados.itens || []).length) throw new Error("Adicione pelo menos um item.");
  if (dados.tipo === "Entrega" && !String(dados.endereco || "").trim()) throw new Error("Informe o endereço da entrega.");

  const pedido = {
    origem: dados.origem === "whatsapp" ? "whatsapp" : "atendimento",
    numero: `DV-M-${dataLojaISO().replaceAll("-", "").slice(2)}-${codigoAleatorio()}`,
    cliente: {
      nome: String(dados.cliente.nome || "").trim().slice(0, 120),
      telefone: String(dados.cliente.telefone || "").trim().slice(0, 30)
    },
    tipo: dados.tipo === "Entrega" ? "Entrega" : "Retirada na loja",
    endereco: String(dados.endereco || "").trim().slice(0, 500),
    pagamento: dados.pagamento || "Não informado",
    itens: dados.itens.map(item => ({
      id: String(item.id || "").slice(0, 120),
      variacaoId: String(item.variacaoId || "").slice(0, 120),
      nome: String(item.nome || "Item").slice(0, 160),
      sabor: String(item.sabor || "").slice(0, 120),
      quantidade: Math.max(0, numeroSeguro(item.quantidade)),
      preco: Math.max(0, numeroSeguro(item.preco)),
      observacao: String(item.observacao || "").slice(0, 300)
    })),
    subtotalProdutos: totalItens,
    taxaEntrega,
    total,
    observacao: String(dados.observacao || "").trim().slice(0, 500),
    status: "registrado",
    dataISO: dataLojaISO(),
    hora: horaLoja(),
    criadoEmMs: agora,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };
  await setDoc(referencia, pedido);
  return { id: referencia.id, ...pedido };
}

export async function atualizarPedidoManualGestao(id, dados = {}) {
  if (!id) throw new Error("Pedido inválido.");
  const referencia = doc(db, "pedidosManuais", id);
  const itens = itensAgrupados(dados.itens || []);
  if (!String(dados.cliente?.nome || "").trim()) throw new Error("Informe o nome do cliente.");
  if (!itens.length) throw new Error("Adicione pelo menos um item.");
  if (dados.tipo === "Entrega" && !String(dados.endereco || "").trim()) throw new Error("Informe o endereço da entrega.");
  const subtotalProdutos = itens.reduce((soma, item) => soma + numeroSeguro(item.preco) * numeroSeguro(item.quantidade), 0);
  const taxaEntrega = dados.tipo === "Entrega" ? Math.max(0, numeroSeguro(dados.taxaEntrega)) : 0;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(referencia);
    if (!snapshot.exists()) throw new Error("Pedido não encontrado.");
    const atual = snapshot.data();
    if (atual.estoqueBaixado || !["registrado", "aguardando_confirmacao"].includes(atual.status || "registrado")) {
      throw new Error("Só é possível editar pedidos novos, antes da confirmação.");
    }
    transaction.update(referencia, {
      cliente: {
        nome: String(dados.cliente.nome || "").trim().slice(0, 120),
        telefone: String(dados.cliente.telefone || "").trim().slice(0, 30)
      },
      tipo: dados.tipo === "Entrega" ? "Entrega" : "Retirada na loja",
      endereco: String(dados.endereco || "").trim().slice(0, 500),
      pagamento: dados.pagamento || "Não informado",
      itens: itens.map(item => ({
        id: String(item.id || "").slice(0, 120),
        variacaoId: String(item.variacaoId || "").slice(0, 120),
        nome: String(item.nome || "Item").slice(0, 160),
        sabor: String(item.sabor || "").slice(0, 120),
        quantidade: Math.max(0, numeroSeguro(item.quantidade)),
        preco: Math.max(0, numeroSeguro(item.preco)),
        observacao: String(item.observacao || "").slice(0, 300)
      })),
      subtotalProdutos,
      taxaEntrega,
      total: subtotalProdutos + taxaEntrega,
      observacao: String(dados.observacao || "").trim().slice(0, 500),
      atualizadoEm: serverTimestamp()
    });
  });
}

export async function salvarCardapioDia({ dataISO = dataLojaISO(), produtoIds = [], publicado = true, titulo = "", itens = [], observacao = "" } = {}) {
  const itensUnicos = deduplicarItensCardapio(itens);
  await setDoc(doc(db, "cardapiosDiarios", dataISO), {
    dataISO,
    produtoIds: [...new Set(produtoIds.map(String))],
    publicado: Boolean(publicado),
    titulo: String(titulo || "Cardápio de hoje").trim().slice(0, 120),
    itens: itensUnicos,
    observacao: String(observacao || "").trim().slice(0, 500),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function salvarInsumo(dados = {}) {
  const referencia = dados.id ? doc(db, "estoqueInsumos", dados.id) : doc(collection(db, "estoqueInsumos"));
  await setDoc(referencia, {
    nome: String(dados.nome || "").trim().slice(0, 140),
    categoria: String(dados.categoria || "Ingredientes").trim().slice(0, 80),
    unidade: String(dados.unidade || "un").trim().slice(0, 20),
    quantidade: Math.max(0, numeroSeguro(dados.quantidade)),
    minimo: Math.max(0, numeroSeguro(dados.minimo)),
    custoUnitario: Math.max(0, numeroSeguro(dados.custoUnitario)),
    validade: String(dados.validade || "").slice(0, 10),
    ativo: dados.ativo !== false,
    atualizadoEm: serverTimestamp(),
    ...(dados.id ? {} : { criadoEm: serverTimestamp(), criadoEmMs: Date.now() })
  }, { merge: true });
  return referencia.id;
}

export async function movimentarInsumo(id, { tipo = "entrada", quantidade = 0, motivo = "Ajuste manual" } = {}) {
  const valor = Math.max(0, numeroSeguro(quantidade));
  if (!valor) throw new Error("Informe uma quantidade maior que zero.");
  const insumoRef = doc(db, "estoqueInsumos", id);
  const movimentoRef = doc(collection(db, "movimentacoesEstoque"));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(insumoRef);
    if (!snapshot.exists()) throw new Error("Insumo não encontrado.");
    const atual = numeroSeguro(snapshot.data().quantidade);
    const direcao = tipo === "saida" ? -1 : 1;
    const proximo = atual + direcao * valor;
    if (proximo < 0) throw new Error("A saída é maior do que o estoque disponível.");
    transaction.update(insumoRef, { quantidade: proximo, atualizadoEm: serverTimestamp() });
    transaction.set(movimentoRef, {
      insumoId: id,
      insumoNome: snapshot.data().nome || "Insumo",
      tipo: direcao < 0 ? "saida" : "entrada",
      quantidade: valor,
      saldoAnterior: atual,
      saldoPosterior: proximo,
      motivo: String(motivo || "Ajuste manual").slice(0, 300),
      dataISO: dataLojaISO(),
      hora: horaLoja(),
      criadoEmMs: Date.now(),
      criadoEm: serverTimestamp()
    });
  });
}

export async function registrarPerda(dados = {}) {
  const id = await movimentarInsumo(dados.insumoId, {
    tipo: "saida",
    quantidade: dados.quantidade,
    motivo: `Perda: ${dados.motivo || "não informado"}`
  });
  const referencia = doc(collection(db, "perdasEstoque"));
  await setDoc(referencia, {
    insumoId: dados.insumoId,
    insumoNome: String(dados.insumoNome || "Insumo").slice(0, 140),
    quantidade: Math.max(0, numeroSeguro(dados.quantidade)),
    unidade: String(dados.unidade || "un").slice(0, 20),
    motivo: String(dados.motivo || "Não informado").slice(0, 300),
    valorEstimado: Math.max(0, numeroSeguro(dados.valorEstimado)),
    dataISO: dataLojaISO(),
    hora: horaLoja(),
    criadoEmMs: Date.now(),
    criadoEm: serverTimestamp()
  });
  return id || referencia.id;
}

export async function salvarFichaTecnica(dados = {}) {
  if (!dados.produtoId) throw new Error("Escolha o produto.");
  await setDoc(doc(db, "fichasTecnicas", dados.produtoId), {
    produtoId: dados.produtoId,
    produtoNome: String(dados.produtoNome || "Produto").slice(0, 140),
    rendimento: Math.max(1, numeroSeguro(dados.rendimento || 1)),
    ingredientes: (dados.ingredientes || []).map(item => ({
      insumoId: item.insumoId,
      nome: String(item.nome || "Insumo").slice(0, 140),
      quantidade: Math.max(0, numeroSeguro(item.quantidade)),
      unidade: String(item.unidade || "un").slice(0, 20)
    })).filter(item => item.insumoId && item.quantidade > 0),
    custoCalculado: Math.max(0, numeroSeguro(dados.custoCalculado)),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function salvarFornecedor(dados = {}) {
  const referencia = dados.id ? doc(db, "fornecedores", dados.id) : doc(collection(db, "fornecedores"));
  await setDoc(referencia, {
    nome: String(dados.nome || "").trim().slice(0, 160),
    contato: String(dados.contato || "").trim().slice(0, 80),
    telefone: String(dados.telefone || "").trim().slice(0, 30),
    observacao: String(dados.observacao || "").trim().slice(0, 500),
    ativo: dados.ativo !== false,
    atualizadoEm: serverTimestamp(),
    ...(dados.id ? {} : { criadoEm: serverTimestamp(), criadoEmMs: Date.now() })
  }, { merge: true });
  return referencia.id;
}

export async function registrarCompra(dados = {}) {
  const itens = (dados.itens || []).filter(item => item.insumoId && numeroSeguro(item.quantidade) > 0);
  if (!itens.length) throw new Error("Adicione pelo menos um item à compra.");
  const totalItens = itens.reduce((soma, item) => soma + numeroSeguro(item.valorTotal), 0);
  const desconto = Math.max(0, numeroSeguro(dados.desconto));
  const totalFinal = Math.max(0, numeroSeguro(dados.totalFinal || totalItens - desconto));
  const compraRef = doc(collection(db, "compras"));
  const movimentoRef = doc(db, "movimentosFinanceiros", `compra-${compraRef.id}`);

  await runTransaction(db, async transaction => {
    const referencias = itens.map(item => doc(db, "estoqueInsumos", item.insumoId));
    const snapshots = await Promise.all(referencias.map(ref => transaction.get(ref)));
    snapshots.forEach((snapshot, indice) => {
      if (!snapshot.exists()) throw new Error(`Insumo não encontrado: ${itens[indice].nome || itens[indice].insumoId}.`);
      const item = itens[indice];
      const quantidade = numeroSeguro(item.quantidade);
      transaction.update(referencias[indice], {
        quantidade: numeroSeguro(snapshot.data().quantidade) + quantidade,
        custoUnitario: quantidade > 0 ? numeroSeguro(item.valorTotal) / quantidade : numeroSeguro(snapshot.data().custoUnitario),
        atualizadoEm: serverTimestamp()
      });
    });

    transaction.set(compraRef, {
      fornecedorId: dados.fornecedorId || "",
      fornecedorNome: String(dados.fornecedorNome || "Fornecedor não informado").slice(0, 160),
      itens: itens.map(item => ({
        insumoId: item.insumoId,
        nome: String(item.nome || "Insumo").slice(0, 140),
        quantidade: numeroSeguro(item.quantidade),
        unidade: String(item.unidade || "un").slice(0, 20),
        valorTotal: Math.max(0, numeroSeguro(item.valorTotal))
      })),
      subtotal: totalItens,
      desconto,
      totalFinal,
      pagamento: dados.pagamento || "Não informado",
      statusPagamento: dados.statusPagamento === "pendente" ? "pendente" : "pago",
      vencimento: String(dados.vencimento || "").slice(0, 10),
      observacao: String(dados.observacao || "").slice(0, 500),
      dataISO: dados.dataISO || dataLojaISO(),
      hora: horaLoja(),
      criadoEmMs: Date.now(),
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    transaction.set(movimentoRef, {
      tipo: "saida",
      descricao: `Compra — ${dados.fornecedorNome || "Fornecedor"}`,
      categoria: "Compras",
      valor: totalFinal,
      pagamento: dados.pagamento || "Não informado",
      pagamentos: [],
      dataISO: dados.dataISO || dataLojaISO(),
      hora: horaLoja(),
      observacao: dados.statusPagamento === "pendente" ? `Conta pendente. Vencimento: ${dados.vencimento || "não informado"}` : "Compra registrada no estoque.",
      origem: "compra-gestao",
      compraId: compraRef.id,
      statusPagamento: dados.statusPagamento === "pendente" ? "pendente" : "pago",
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
  });
  return compraRef.id;
}

export async function marcarCompraComoPaga(compra = {}) {
  if (!compra.id) throw new Error("Compra inválida.");
  if (compra.statusPagamento === "pago") return;
  const compraRef = doc(db, "compras", compra.id);
  const movimentoRef = doc(db, "movimentosFinanceiros", `compra-${compra.id}`);
  await runTransaction(db, async transaction => {
    const compraSnapshot = await transaction.get(compraRef);
    if (!compraSnapshot.exists()) throw new Error("Compra não encontrada.");
    transaction.update(compraRef, {
      statusPagamento: "pago",
      pagoEmMs: Date.now(),
      pagoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    transaction.update(movimentoRef, {
      statusPagamento: "pago",
      observacao: "Compra paga e confirmada na Gestão.",
      atualizadoEm: serverTimestamp()
    });
  });
}

export async function abrirSessaoCaixa({ valorInicial = 0, responsavel = "" } = {}) {
  const aberta = estadoGestao.sessoesCaixa.find(item => item.status === "aberto");
  if (aberta) throw new Error("Já existe um caixa aberto.");
  const referencia = doc(collection(db, "sessoesCaixa"));
  await setDoc(referencia, {
    status: "aberto",
    valorInicial: Math.max(0, numeroSeguro(valorInicial)),
    responsavel: String(responsavel || "Administrador").slice(0, 120),
    dataISO: dataLojaISO(),
    horaAbertura: horaLoja(),
    abertoEmMs: Date.now(),
    abertoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  });
  return referencia.id;
}

export async function registrarMovimentoCaixa({ sessaoId, tipo = "sangria", valor = 0, motivo = "" } = {}) {
  if (!sessaoId) throw new Error("Abra o caixa primeiro.");
  const referencia = doc(collection(db, "movimentosCaixa"));
  await setDoc(referencia, {
    sessaoId,
    tipo: tipo === "suprimento" ? "suprimento" : "sangria",
    valor: Math.max(0, numeroSeguro(valor)),
    motivo: String(motivo || "Movimento de caixa").slice(0, 300),
    dataISO: dataLojaISO(),
    hora: horaLoja(),
    criadoEmMs: Date.now(),
    criadoEm: serverTimestamp()
  });
  return referencia.id;
}

export async function fecharSessaoCaixa(id, dados = {}) {
  await updateDoc(doc(db, "sessoesCaixa", id), {
    status: "fechado",
    valorEsperado: numeroSeguro(dados.valorEsperado),
    valorContado: numeroSeguro(dados.valorContado),
    diferenca: numeroSeguro(dados.valorContado) - numeroSeguro(dados.valorEsperado),
    observacao: String(dados.observacao || "").slice(0, 500),
    horaFechamento: horaLoja(),
    fechadoEmMs: Date.now(),
    fechadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  });
}

export async function salvarObservacaoCliente(uid, observacao = "") {
  if (!uid) throw new Error("Cliente sem identificação.");
  await setDoc(doc(db, "usuarios", uid), {
    observacaoGestao: String(observacao || "").trim().slice(0, 1000),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function salvarConfiguracaoOperacao(dados = {}) {
  await setDoc(doc(db, "configuracoes", "operacao"), {
    ...dados,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function solicitarAcessoGestao(user) {
  if (!user?.uid) throw new Error("Entre com Google primeiro.");
  await setDoc(doc(db, "solicitacoesAcesso", user.uid), {
    uid: user.uid,
    nome: String(user.displayName || "").slice(0, 120),
    email: String(user.email || "").slice(0, 200),
    foto: String(user.photoURL || "").slice(0, 2000),
    status: "pendente",
    criadoEmMs: Date.now(),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

function emailEquipeNormalizado(email = "") {
  return String(email || "").trim().toLowerCase().slice(0, 200);
}

function permissoesEquipe(dados = {}, padraoOperacao = false) {
  return {
    pedidos: padraoOperacao ? dados.pedidos !== false : Boolean(dados.pedidos),
    cozinha: padraoOperacao ? dados.cozinha !== false : Boolean(dados.cozinha),
    entregas: padraoOperacao ? dados.entregas !== false : Boolean(dados.entregas),
    caixa: Boolean(dados.caixa),
    estoque: Boolean(dados.estoque),
    compras: Boolean(dados.compras),
    financeiro: Boolean(dados.financeiro),
    clientes: Boolean(dados.clientes),
    relatorios: Boolean(dados.relatorios),
    configuracoes: Boolean(dados.configuracoes),
    site: Boolean(dados.site)
  };
}

export async function criarConviteEquipe(dados = {}) {
  const email = emailEquipeNormalizado(dados.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
  await setDoc(doc(db, "convitesEquipe", email), {
    email,
    nome: String(dados.nome || "").trim().slice(0, 120),
    cargo: String(dados.cargo || "Colaborador").trim().slice(0, 80),
    ativo: true,
    status: "pendente",
    permissoes: permissoesEquipe(dados.permissoes),
    criadoEmMs: Date.now(),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  });
  return email;
}

export async function cancelarConviteEquipe(email = "") {
  const normalizado = emailEquipeNormalizado(email);
  if (!normalizado) throw new Error("Convite inválido.");
  await deleteDoc(doc(db, "convitesEquipe", normalizado));
}

export async function buscarConviteEquipe(user) {
  const email = emailEquipeNormalizado(user?.email);
  if (!email) return null;
  const snapshot = await getDoc(doc(db, "convitesEquipe", email));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function ativarConviteEquipe(user) {
  const email = emailEquipeNormalizado(user?.email);
  if (!user?.uid || !email) throw new Error("Entre com a conta Google convidada.");
  const conviteRef = doc(db, "convitesEquipe", email);
  const membroRef = doc(db, "equipe", user.uid);
  let membroCriado = null;
  await runTransaction(db, async transaction => {
    const [conviteSnapshot, membroSnapshot] = await Promise.all([
      transaction.get(conviteRef),
      transaction.get(membroRef)
    ]);
    if (membroSnapshot.exists() && membroSnapshot.data().ativo === true) {
      membroCriado = { id: membroSnapshot.id, ...membroSnapshot.data() };
      return;
    }
    if (!conviteSnapshot.exists()) throw new Error("Este e-mail ainda não possui convite.");
    const convite = conviteSnapshot.data();
    if (convite.ativo !== true || convite.status !== "pendente" || emailEquipeNormalizado(convite.email) !== email) {
      throw new Error("Este convite não está mais disponível.");
    }
    const dadosMembro = {
      uid: user.uid,
      nome: String(convite.nome || user.displayName || "Colaborador").trim().slice(0, 120),
      email,
      foto: String(user.photoURL || "").slice(0, 2000),
      cargo: String(convite.cargo || "Colaborador").slice(0, 80),
      ativo: true,
      permissoes: permissoesEquipe(convite.permissoes),
      conviteEmail: email,
      origemAcesso: "convite",
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    };
    transaction.set(membroRef, dadosMembro);
    membroCriado = { id: user.uid, ...dadosMembro };
  });
  return membroCriado;
}

export async function aprovarAcessoGestao(solicitacao, dados = {}) {
  if (!solicitacao?.uid) throw new Error("Solicitação inválida.");
  const permissoes = permissoesEquipe(dados.permissoes, true);
  await setDoc(doc(db, "equipe", solicitacao.uid), {
    uid: solicitacao.uid,
    nome: solicitacao.nome || "Colaborador",
    email: solicitacao.email || "",
    foto: solicitacao.foto || "",
    cargo: String(dados.cargo || "Atendimento").slice(0, 80),
    ativo: true,
    permissoes,
    atualizadoEm: serverTimestamp(),
    criadoEm: serverTimestamp()
  }, { merge: true });
  await updateDoc(doc(db, "solicitacoesAcesso", solicitacao.uid), {
    status: "aprovado",
    atualizadoEm: serverTimestamp()
  });
}

export async function atualizarMembroEquipe(uid, dados = {}) {
  await updateDoc(doc(db, "equipe", uid), {
    cargo: String(dados.cargo || "Colaborador").slice(0, 80),
    ativo: dados.ativo !== false,
    permissoes: dados.permissoes || {},
    atualizadoEm: serverTimestamp()
  });
}
