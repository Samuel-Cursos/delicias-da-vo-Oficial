const STATUS_FINAIS = new Set(["entregue", "concluida", "concluido", "finalizado", "cancelado", "cancelada"]);

export const FLUXO_PEDIDO = [
  "registrado",
  "confirmado",
  "producao",
  "pronto",
  "saiu_entrega",
  "entregue"
];

export const STATUS_INFO = {
  registrado: { nome: "Novo", classe: "novo", etapa: 0 },
  aguardando_confirmacao: { nome: "Aguardando", classe: "novo", etapa: 0 },
  confirmado: { nome: "Confirmado", classe: "confirmado", etapa: 1 },
  producao: { nome: "Em produção", classe: "producao", etapa: 2 },
  pronto: { nome: "Pronto", classe: "pronto", etapa: 3 },
  saiu_entrega: { nome: "Saiu para entrega", classe: "entrega", etapa: 4 },
  entregue: { nome: "Entregue", classe: "concluido", etapa: 5 },
  concluida: { nome: "Concluída", classe: "concluido", etapa: 5 },
  concluido: { nome: "Concluído", classe: "concluido", etapa: 5 },
  finalizado: { nome: "Finalizado", classe: "concluido", etapa: 5 },
  cancelado: { nome: "Cancelado", classe: "cancelado", etapa: -1 },
  cancelada: { nome: "Cancelada", classe: "cancelado", etapa: -1 }
};

export function dataLojaISO(data = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(data);
}

export function horaLoja(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(data);
}

export function numeroSeguro(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

export function formatarMoedaGestao(valor) {
  return numeroSeguro(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function infoStatus(status = "registrado") {
  return STATUS_INFO[status] || { nome: String(status || "Sem status"), classe: "neutro", etapa: 0 };
}

export function statusFinal(status = "") {
  return STATUS_FINAIS.has(status);
}

export function normalizarStatusGestao(status = "registrado") {
  const mapa = {
    aguardando_envio: "registrado",
    preparando: "producao",
    em_producao: "producao",
    concluida: "entregue",
    concluido: "entregue",
    finalizado: "entregue",
    cancelada: "cancelado"
  };
  return mapa[status] || status || "registrado";
}

function instante(registro = {}) {
  return registro.criadoEm?.toMillis?.()
    || numeroSeguro(registro.criadoEmMs)
    || Date.parse(`${registro.dataISO || registro.dataFesta || "1970-01-01"}T${registro.horaBR || registro.hora || "00:00"}`)
    || 0;
}

export function consolidarPedidosGestao({ site = [], manuais = [], encomendas = [] } = {}) {
  const normais = site.map(pedido => ({
    ...pedido,
    chave: `site:${pedido.caminho || pedido.id}`,
    origemTipo: "site",
    origemNome: "Site",
    numeroExibicao: pedido.numeroFormatado || pedido.numero || `SITE-${String(pedido.id || "").slice(-5).toUpperCase()}`,
    clienteNome: pedido.cliente?.nome || "Cliente",
    clienteTelefone: pedido.cliente?.telefone || "",
    valor: numeroSeguro(pedido.total),
    dataOperacao: pedido.dataISO || "",
    horaOperacao: pedido.horaBR || pedido.hora || "",
    status: normalizarStatusGestao(pedido.status),
    itens: Array.isArray(pedido.itens) ? pedido.itens : [],
    tipoAtendimento: pedido.tipo || "Retirada na loja",
    _instante: instante(pedido)
  }));

  const locais = manuais.map(pedido => ({
    ...pedido,
    chave: `manual:${pedido.id}`,
    origemTipo: "manual",
    origemNome: pedido.origem === "whatsapp" ? "WhatsApp" : "Atendimento",
    numeroExibicao: pedido.numero || `MAN-${String(pedido.id || "").slice(-5).toUpperCase()}`,
    clienteNome: pedido.cliente?.nome || "Cliente",
    clienteTelefone: pedido.cliente?.telefone || "",
    valor: numeroSeguro(pedido.total),
    dataOperacao: pedido.dataISO || "",
    horaOperacao: pedido.hora || "",
    status: normalizarStatusGestao(pedido.status),
    itens: Array.isArray(pedido.itens) ? pedido.itens : [],
    tipoAtendimento: pedido.tipo || "Retirada na loja",
    _instante: instante(pedido)
  }));

  const festas = encomendas.map(pedido => ({
    ...pedido,
    chave: `festa:${pedido.id}`,
    origemTipo: "festa",
    origemNome: "Encomenda",
    numeroExibicao: pedido.numero || `FESTA-${String(pedido.id || "").slice(-5).toUpperCase()}`,
    clienteNome: pedido.cliente?.nome || "Cliente",
    clienteTelefone: pedido.cliente?.telefone || "",
    valor: numeroSeguro(pedido.totalEstimado || pedido.total),
    dataOperacao: pedido.dataFesta || pedido.dataEntregaISO || "",
    horaOperacao: pedido.hora || pedido.horaEntrega || "",
    status: normalizarStatusGestao(pedido.status || "aguardando_confirmacao"),
    itens: Array.isArray(pedido.itens) ? pedido.itens : [],
    tipoAtendimento: pedido.tipoEntrega || "Retirada na loja",
    _instante: instante(pedido)
  }));

  return [...normais, ...locais, ...festas].sort((a, b) => b._instante - a._instante);
}

export function pedidosDaCozinha(pedidos = []) {
  return pedidos.filter(pedido => !["registrado", "aguardando_confirmacao", "saiu_entrega", "entregue", "concluida", "concluido", "cancelado", "cancelada"].includes(pedido.status));
}

export function gerarNecessidadesProducao(pedidos = []) {
  const mapa = new Map();
  pedidosDaCozinha(pedidos).forEach(pedido => {
    pedido.itens.forEach(item => {
      const nome = String(item.nome || "Item").trim();
      const detalhe = String(item.sabor || item.variacaoNome || item.variacao || "").trim();
      const chave = `${nome.toLowerCase()}|${detalhe.toLowerCase()}`;
      const atual = mapa.get(chave) || { nome, detalhe, quantidade: 0, pedidos: 0 };
      atual.quantidade += Math.max(0, numeroSeguro(item.quantidade));
      atual.pedidos += 1;
      mapa.set(chave, atual);
    });
  });
  return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function calcularAlertasEstoque(produtos = [], insumos = []) {
  const alertas = [];

  produtos.forEach(produto => {
    if (produto.ativo === false || produto.sobEncomenda) return;
    if (Array.isArray(produto.variacoes) && produto.variacoes.length) {
      produto.variacoes.filter(item => item.ativa !== false && !item.sobEncomenda).forEach(item => {
        const quantidade = numeroSeguro(item.estoque);
        const minimo = numeroSeguro(item.minimo);
        if (quantidade <= minimo) alertas.push({ id: `${produto.id}:${item.id}`, nome: `${produto.nome} — ${item.nome}`, quantidade, minimo, tipo: "produto" });
      });
      return;
    }
    const quantidade = numeroSeguro(produto.estoque);
    const minimo = numeroSeguro(produto.minimo);
    if (quantidade <= minimo) alertas.push({ id: produto.id, nome: produto.nome, quantidade, minimo, tipo: "produto" });
  });

  insumos.filter(item => item.ativo !== false).forEach(item => {
    const quantidade = numeroSeguro(item.quantidade);
    const minimo = numeroSeguro(item.minimo);
    if (quantidade <= minimo) alertas.push({ id: item.id, nome: item.nome, quantidade, minimo, unidade: item.unidade, tipo: "insumo" });
  });

  return alertas.sort((a, b) => a.quantidade - b.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

function vendaNaData(registro, dataISO) {
  return (registro.dataISO || registro.dataFesta || "") === dataISO;
}

export function calcularResumoOperacao({ pedidos = [], vendas = [], movimentos = [], produtos = [], insumos = [], dataISO = dataLojaISO() } = {}) {
  const pedidosHoje = pedidos.filter(pedido => pedido.dataOperacao === dataISO || (!pedido.dataOperacao && vendaNaData(pedido, dataISO)));
  const vendasHoje = vendas.filter(venda => vendaNaData(venda, dataISO) && !["cancelada", "cancelado"].includes(venda.status));
  const movimentosHoje = movimentos.filter(item => item.dataISO === dataISO);
  const receitaPedidos = pedidosHoje.filter(pedido => ["entregue", "concluido", "concluida", "finalizado"].includes(pedido.status)).reduce((soma, pedido) => soma + pedido.valor, 0);
  const receitaBalcao = vendasHoje.reduce((soma, venda) => soma + numeroSeguro(venda.total), 0);
  const entradasManuais = movimentosHoje.filter(item => item.tipo === "entrada" && !String(item.origem || "").startsWith("pedido-")).reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const saidas = movimentosHoje.filter(item => item.tipo === "saida").reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const abertos = pedidos.filter(pedido => !statusFinal(pedido.status));

  return {
    pedidosHoje: pedidosHoje.length,
    pedidosAbertos: abertos.length,
    emProducao: pedidos.filter(pedido => pedido.status === "producao").length,
    prontos: pedidos.filter(pedido => pedido.status === "pronto").length,
    entregasPendentes: pedidos.filter(pedido => pedido.tipoAtendimento === "Entrega" && ["confirmado", "producao", "pronto", "saiu_entrega"].includes(pedido.status)).length,
    receita: receitaPedidos + receitaBalcao + entradasManuais,
    despesas: saidas,
    saldo: receitaPedidos + receitaBalcao + entradasManuais - saidas,
    alertasEstoque: calcularAlertasEstoque(produtos, insumos).length
  };
}

export function resumirPagamentos(vendas = [], pedidos = [], dataISO = dataLojaISO()) {
  const mapa = new Map();
  const adicionar = (tipo, valor) => {
    const nome = String(tipo || "Não informado");
    mapa.set(nome, numeroSeguro(mapa.get(nome)) + numeroSeguro(valor));
  };

  vendas.filter(venda => venda.dataISO === dataISO && venda.status !== "cancelada").forEach(venda => {
    if (Array.isArray(venda.pagamentos) && venda.pagamentos.length) venda.pagamentos.forEach(item => adicionar(item.tipo, item.valor));
    else adicionar(venda.pagamento, venda.total);
  });
  pedidos.filter(pedido => pedido.dataOperacao === dataISO && ["entregue", "concluido", "finalizado"].includes(pedido.status)).forEach(pedido => adicionar(pedido.pagamento, pedido.valor));

  return [...mapa.entries()].map(([tipo, valor]) => ({ tipo, valor })).sort((a, b) => b.valor - a.valor);
}

export function calcularRelatorioGestao({ pedidos = [], vendas = [], movimentos = [], inicio = "", fim = "" } = {}) {
  const dentro = data => (!inicio || data >= inicio) && (!fim || data <= fim);
  const pedidosPeriodo = pedidos.filter(item => dentro(item.dataOperacao || "") && !["cancelado", "cancelada"].includes(item.status));
  const vendasPeriodo = vendas.filter(item => dentro(item.dataISO || "") && item.status !== "cancelada");
  const movimentosPeriodo = movimentos.filter(item => dentro(item.dataISO || ""));
  const produtos = new Map();
  const pagamentos = new Map();
  const dias = new Map();

  const somarDia = (data, valor) => dias.set(data, numeroSeguro(dias.get(data)) + numeroSeguro(valor));
  const somarPagamento = (tipo, valor) => pagamentos.set(tipo || "Não informado", numeroSeguro(pagamentos.get(tipo || "Não informado")) + numeroSeguro(valor));
  const somarItens = itens => (Array.isArray(itens) ? itens : []).forEach(item => {
    const chave = item.nome || "Item";
    produtos.set(chave, numeroSeguro(produtos.get(chave)) + numeroSeguro(item.quantidade));
  });

  pedidosPeriodo.filter(item => ["entregue", "concluido", "finalizado"].includes(item.status)).forEach(item => {
    somarDia(item.dataOperacao, item.valor);
    somarPagamento(item.pagamento, item.valor);
    somarItens(item.itens);
  });
  vendasPeriodo.forEach(item => {
    somarDia(item.dataISO, item.total);
    if (Array.isArray(item.pagamentos) && item.pagamentos.length) item.pagamentos.forEach(p => somarPagamento(p.tipo, p.valor));
    else somarPagamento(item.pagamento, item.total);
    somarItens(item.itens);
  });

  const entradas = movimentosPeriodo.filter(item => item.tipo === "entrada" && !String(item.origem || "").startsWith("pedido-")).reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const despesas = movimentosPeriodo.filter(item => item.tipo === "saida").reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const receitaOperacional = [...dias.values()].reduce((soma, valor) => soma + valor, 0);
  const concluidos = pedidosPeriodo.filter(item => ["entregue", "concluido", "finalizado"].includes(item.status));

  return {
    receita: receitaOperacional + entradas,
    despesas,
    resultado: receitaOperacional + entradas - despesas,
    pedidos: concluidos.length + vendasPeriodo.length,
    ticketMedio: (concluidos.length + vendasPeriodo.length) ? receitaOperacional / (concluidos.length + vendasPeriodo.length) : 0,
    produtos: [...produtos.entries()].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
    pagamentos: [...pagamentos.entries()].map(([tipo, valor]) => ({ tipo, valor })).sort((a, b) => b.valor - a.valor),
    dias: [...dias.entries()].map(([data, valor]) => ({ data, valor })).sort((a, b) => a.data.localeCompare(b.data))
  };
}
