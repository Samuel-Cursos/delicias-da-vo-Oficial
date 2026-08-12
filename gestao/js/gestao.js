import {
  auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  db, doc, getDoc, updateDoc, serverTimestamp
} from "../../js/core/firebase.js";
import { APP_CONFIG } from "../../js/core/config.js";
import { registrarVendaRapida } from "../../js/services/salesService.js";
import { salvarMovimentoFinanceiro } from "../../js/services/financeService.js";
import { lerRegistroComIA } from "../../js/services/documentAiService.js";
import {
  estadoGestao, limparEstadoGestao, iniciarObservadoresGestao, atualizarStatusPedidoGestao,
  salvarPedidoManual, salvarCardapioDia, salvarInsumo, movimentarInsumo,
  registrarPerda, salvarFichaTecnica, salvarFornecedor, registrarCompra,
  abrirSessaoCaixa, registrarMovimentoCaixa, fecharSessaoCaixa,
  salvarObservacaoCliente, salvarConfiguracaoOperacao, solicitarAcessoGestao,
  aprovarAcessoGestao, atualizarMembroEquipe
} from "../../js/services/managementService.js";
import {
  dataLojaISO, horaLoja, numeroSeguro, formatarMoedaGestao, infoStatus, statusFinal,
  consolidarPedidosGestao, gerarNecessidadesProducao, calcularAlertasEstoque,
  calcularResumoOperacao, resumirPagamentos, calcularRelatorioGestao
} from "../../js/services/managementCore.js";

const $ = id => document.getElementById(id);
const adminEmails = APP_CONFIG.admins.map(email => email.toLowerCase());
const titulos = {
  dashboard: ["Operação em tempo real", "Hoje na loja", "Tudo que precisa de atenção agora."],
  pedidos: ["Central única", "Pedidos", "Site, WhatsApp, atendimento e encomendas em um lugar."],
  cozinha: ["Produção organizada", "Cozinha", "Fila clara e totais do que precisa ser preparado."],
  cardapio: ["Ligado ao site", "Cardápio do dia", "Escolha o que os clientes podem pedir hoje."],
  balcao: ["Atendimento presencial", "Balcão", "Venda rápida com baixa de estoque e entrada no caixa."],
  entregas: ["Logística", "Entregas", "Endereços, rotas e pedidos que precisam sair."],
  encomendas: ["Agenda futura", "Encomendas", "Prazos, produção e pagamentos das festas."],
  caixa: ["Conferência diária", "Caixa", "Abertura, sangrias, recebimentos e fechamento."],
  estoque: ["Controle de materiais", "Estoque", "Insumos, produtos prontos, fichas e perdas."],
  compras: ["Abastecimento", "Compras e fornecedores", "Entrada de mercadorias e custos atualizados."],
  financeiro: ["Saúde do negócio", "Financeiro", "Entradas, despesas, resultado e histórico."],
  clientes: ["Relacionamento", "Clientes", "Dados, histórico e observações importantes."],
  relatorios: ["Decisões com dados", "Relatórios", "Vendas, produtos, pagamentos e desempenho."],
  equipe: ["Acesso seguro", "Equipe", "Libere somente o necessário para cada pessoa."],
  configuracoes: ["Preferências internas", "Configurações", "Ajuste o funcionamento do sistema."],
};

let usuarioAtual = null;
let membroAtual = null;
let isAdmin = false;
let pararObservadoresGestao = null;
let paginaAtual = "dashboard";
let filtroEntregaAtual = "pendentes";
let abaEstoqueAtual = "insumos";
let carrinhoBalcao = [];
let itensPedidoModal = [];
let itensCompraModal = [];
let ingredientesFichaModal = [];
let ultimoTotalPedidos = 0;
let toastTimer = null;

function escapar(valor = "") {
  return String(valor).replace(/[&<>'"]/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[caractere]);
}

async function prepararImagemParaIA(arquivo) {
  if (!arquivo?.type?.startsWith("image/")) throw new Error("Escolha uma foto válida.");
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = await new Promise((resolve, reject) => {
      const elemento = new Image();
      elemento.onload = () => resolve(elemento);
      elemento.onerror = () => reject(new Error("Não foi possível abrir a foto."));
      elemento.src = url;
    });
    const limite = 1600;
    const escala = Math.min(1, limite / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
    const contexto = canvas.getContext("2d", { alpha: false });
    contexto.fillStyle = "#fff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function iniciais(nome = "DV") {
  return String(nome).trim().split(/\s+/).slice(0, 2).map(parte => parte[0]).join("").toUpperCase() || "DV";
}

function textoData(dataISO = "") {
  if (!dataISO) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${dataISO}T12:00:00Z`));
}

function pedidosConsolidados() {
  return consolidarPedidosGestao({
    site: estadoGestao.pedidosSite.filter(item => String(item.caminho || "").startsWith("pedidosSite/")),
    manuais: estadoGestao.pedidosManuais,
    encomendas: estadoGestao.encomendas
  });
}

function permissoesAtuais() {
  if (isAdmin) return new Proxy({}, { get: () => true });
  return membroAtual?.permissoes || {};
}

function pode(permissao) {
  return isAdmin || permissao === "dashboard" || Boolean(permissoesAtuais()[permissao]);
}

function toast(mensagem, tipo = "") {
  const elemento = $("toastGestao");
  clearTimeout(toastTimer);
  elemento.textContent = mensagem;
  elemento.className = `toast ${tipo}`.trim();
  elemento.hidden = false;
  toastTimer = setTimeout(() => { elemento.hidden = true; }, 3800);
}

function abrirModal(titulo, conteudo, kicker = "Delícias da Vó") {
  $("modalTituloGestao").textContent = titulo;
  $("modalKickerGestao").textContent = kicker;
  $("modalConteudoGestao").innerHTML = conteudo;
  $("gestaoModal").hidden = false;
  $("gestaoModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("modalConteudoGestao").querySelector("input,select,textarea,button")?.focus(), 40);
}

function fecharModal() {
  $("gestaoModal").hidden = true;
  $("gestaoModal").setAttribute("aria-hidden", "true");
  $("modalConteudoGestao").innerHTML = "";
  document.body.style.overflow = "";
}

function carregarTelaLogin() {
  $("gestaoLogin").hidden = false;
  $("gestaoApp").hidden = true;
}

async function mostrarUsuarioNaoAutorizado(user) {
  const solicitacao = await getDoc(doc(db, "solicitacoesAcesso", user.uid)).catch(() => null);
  const status = solicitacao?.exists() ? solicitacao.data().status : "";
  $("gestaoUsuario").innerHTML = `<div class="login-denied"><strong>Acesso interno ainda não liberado</strong><p>${status === "pendente" ? "Sua solicitação está aguardando aprovação do administrador." : "Peça acesso e o administrador escolhe quais áreas você poderá usar."}</p>${status !== "pendente" ? '<button id="solicitarAcessoBotao" type="button">Solicitar acesso à gestão</button>' : ""}<button id="trocarContaGestao" type="button" style="margin-top:8px;background:#f3ddcf;color:#5d2118">Entrar com outra conta</button></div>`;
  $("solicitarAcessoBotao")?.addEventListener("click", async () => {
    try {
      await solicitarAcessoGestao(user);
      toast("Solicitação enviada ao administrador.", "success");
      mostrarUsuarioNaoAutorizado(user);
    } catch (erro) { toast(erro.message || "Não foi possível solicitar acesso.", "error"); }
  });
  $("trocarContaGestao")?.addEventListener("click", () => signOut(auth));
}

function atualizarNavegacaoPermitida() {
  document.querySelectorAll(".nav-item").forEach(botao => {
    const permitido = botao.dataset.adminOnly === "true" ? isAdmin : pode(botao.dataset.permission || "dashboard");
    botao.hidden = !permitido;
  });
}

function liberarSistema(user) {
  $("gestaoLogin").hidden = true;
  $("gestaoApp").hidden = false;
  $("usuarioGestaoIniciais").textContent = iniciais(user.displayName || user.email);
  $("alertaPermissao").hidden = isAdmin;
  if (!isAdmin) $("alertaPermissao").textContent = `Acesso de ${membroAtual?.cargo || "colaborador"}: o menu mostra somente as áreas liberadas pelo administrador.`;
  atualizarNavegacaoPermitida();
  pararObservadoresGestao?.();
  limparEstadoGestao();
  pararObservadoresGestao = iniciarObservadoresGestao((_, evento) => {
    if (evento?.erro) {
      $("conexaoGestao").classList.add("offline");
      $("conexaoGestao").lastChild.textContent = " Falha ao sincronizar";
    } else {
      $("conexaoGestao").classList.remove("offline");
      $("conexaoGestao").lastChild.textContent = " Sincronizado";
      renderTudo();
    }
  }, { admin: isAdmin, permissoes: permissoesAtuais() });
  navegar("dashboard");
}

async function processarUsuario(user) {
  usuarioAtual = user;
  if (!user) {
    pararObservadoresGestao?.();
    pararObservadoresGestao = null;
    limparEstadoGestao();
    membroAtual = null;
    isAdmin = false;
    carregarTelaLogin();
    $("gestaoUsuario").innerHTML = '<button id="loginGestaoGoogle" type="button">Entrar com Google</button>';
    $("loginGestaoGoogle").addEventListener("click", async () => {
      try { await signInWithPopup(auth, googleProvider); }
      catch (erro) { if (erro.code !== "auth/popup-closed-by-user") toast("Não foi possível entrar agora.", "error"); }
    });
    return;
  }

  isAdmin = adminEmails.includes(String(user.email || "").toLowerCase());
  if (!isAdmin) {
    const membro = await getDoc(doc(db, "equipe", user.uid)).catch(() => null);
    membroAtual = membro?.exists() ? { id: membro.id, ...membro.data() } : null;
    if (!membroAtual?.ativo) {
      carregarTelaLogin();
      await mostrarUsuarioNaoAutorizado(user);
      return;
    }
  }
  liberarSistema(user);
}

function navegar(pagina) {
  const botao = document.querySelector(`.nav-item[data-page="${pagina}"]`);
  if (!botao || botao.hidden) pagina = "dashboard";
  paginaAtual = pagina;
  document.querySelectorAll(".page").forEach(item => item.classList.toggle("active", item.dataset.page === pagina));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === pagina));
  const [kicker, titulo, descricao] = titulos[pagina];
  $("paginaKicker").textContent = kicker;
  $("paginaTitulo").textContent = titulo;
  $("paginaDescricao").textContent = descricao;
  const acaoPagina = pagina === "estoque"
    ? ["＋ Novo insumo", "estoque"]
    : pagina === "compras"
      ? ["＋ Registrar compra", "compras"]
      : pagina === "financeiro"
        ? ["＋ Lançamento", "financeiro"]
        : ["＋ Novo pedido", "pedidos"];
  $("acaoRapida").textContent = acaoPagina[0];
  $("acaoRapida").hidden = !pode(acaoPagina[1]);
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderPagina(pagina);
}

function proximoStatus(pedido) {
  if (["registrado", "aguardando_confirmacao"].includes(pedido.status)) return ["confirmado", "Confirmar pedido"];
  if (pedido.status === "confirmado") return ["producao", "Iniciar preparo"];
  if (pedido.status === "producao") return ["pronto", "Marcar pronto"];
  if (pedido.status === "pronto" && pedido.tipoAtendimento === "Entrega") return ["saiu_entrega", "Saiu para entrega"];
  if (pedido.status === "pronto") return ["entregue", "Finalizar retirada"];
  if (pedido.status === "saiu_entrega") return ["entregue", "Marcar entregue"];
  return ["", ""];
}

function htmlItens(pedido, limite = 4) {
  const itens = pedido.itens || [];
  const lista = itens.slice(0, limite).map(item => `<li><b>${numeroSeguro(item.quantidade)}×</b> ${escapar(item.nome)}${item.sabor ? ` — ${escapar(item.sabor)}` : ""}${item.observacao ? `<br><small>Obs.: ${escapar(item.observacao)}</small>` : ""}</li>`).join("");
  return `<ul>${lista || "<li>Itens não informados</li>"}${itens.length > limite ? `<li>+${itens.length - limite} itens</li>` : ""}</ul>`;
}

function htmlPedidoCard(pedido) {
  const status = infoStatus(pedido.status);
  const [proximo, acao] = proximoStatus(pedido);
  return `<article class="order-card ${["registrado", "aguardando_confirmacao"].includes(pedido.status) ? "new-order" : ""}" data-order="${escapar(pedido.chave)}">
    <div class="order-identification"><div class="order-code"><span class="origin-pill">${escapar(pedido.origemNome)}</span><span class="status-pill ${status.classe}">${status.nome}</span></div><h3>${escapar(pedido.numeroExibicao)}</h3><p><b>${escapar(pedido.clienteNome)}</b>${pedido.clienteTelefone ? ` • ${escapar(pedido.clienteTelefone)}` : ""}</p><div class="order-meta"><span class="soft-pill">${escapar(pedido.tipoAtendimento)}</span><span class="soft-pill">${escapar(pedido.horaOperacao || "Sem horário")}</span><span class="soft-pill">${formatarMoedaGestao(pedido.valor)}</span></div></div>
    <div class="order-items">${htmlItens(pedido)}${pedido.observacao || pedido.observacoes ? `<p class="note">${escapar(pedido.observacao || pedido.observacoes)}</p>` : ""}</div>
    <div class="order-actions"><select data-order-status>${["registrado", "confirmado", "producao", "pronto", "saiu_entrega", "entregue", "cancelado"].map(valor => `<option value="${valor}" ${pedido.status === valor ? "selected" : ""}>${infoStatus(valor).nome}</option>`).join("")}</select>${proximo ? `<button class="main-action" data-next="${proximo}">${acao}</button>` : ""}<button class="cancel-action" data-detail>Ver detalhes</button></div>
  </article>`;
}

function renderDashboard() {
  const pedidos = pedidosConsolidados();
  const resumo = calcularResumoOperacao({ pedidos, vendas: estadoGestao.vendas, movimentos: estadoGestao.movimentosFinanceiros, produtos: estadoGestao.produtos, insumos: estadoGestao.insumos });
  $("kpiPedidosHoje").textContent = resumo.pedidosHoje;
  $("kpiPedidosAbertos").textContent = `${resumo.pedidosAbertos} em aberto`;
  $("kpiProducao").textContent = resumo.emProducao;
  $("kpiProntos").textContent = resumo.prontos;
  $("kpiEntregas").textContent = resumo.entregasPendentes;
  $("kpiReceita").textContent = formatarMoedaGestao(resumo.receita);
  $("kpiSaldo").textContent = `Saldo ${formatarMoedaGestao(resumo.saldo)}`;
  $("kpiEstoque").textContent = resumo.alertasEstoque;
  $("resumoDiaTexto").textContent = resumo.pedidosAbertos ? `${resumo.pedidosAbertos} pedido(s) ainda precisam avançar na operação.` : "Nenhuma pendência crítica por enquanto.";

  const abertos = pedidos.filter(pedido => !statusFinal(pedido.status)).slice(0, 5);
  $("dashboardPedidos").className = `compact-list ${abertos.length ? "" : "empty-state"}`;
  $("dashboardPedidos").innerHTML = abertos.length ? abertos.map(pedido => `<div class="compact-row"><span class="status-pill ${infoStatus(pedido.status).classe}">${infoStatus(pedido.status).nome}</span><div class="row-main"><strong>${escapar(pedido.numeroExibicao)} — ${escapar(pedido.clienteNome)}</strong><small>${pedido.itens.map(item => `${item.quantidade}× ${item.nome}`).join(" • ")}</small></div><span class="row-value">${formatarMoedaGestao(pedido.valor)}</span></div>`).join("") : "Nenhum pedido aguardando.";

  const necessidades = gerarNecessidadesProducao(pedidos).slice(0, 8);
  $("dashboardProducao").className = `production-summary ${necessidades.length ? "" : "empty-state"}`;
  $("dashboardProducao").innerHTML = necessidades.length ? necessidades.map(item => `<div class="need-chip"><strong>${item.quantidade}</strong><span>${escapar(item.nome)}${item.detalhe ? ` — ${escapar(item.detalhe)}` : ""}</span></div>`).join("") : "Nada na fila.";

  const alertas = calcularAlertasEstoque(estadoGestao.produtos, estadoGestao.insumos).slice(0, 6);
  $("dashboardEstoque").className = `compact-list ${alertas.length ? "" : "empty-state"}`;
  $("dashboardEstoque").innerHTML = alertas.length ? alertas.map(item => `<div class="compact-row"><div class="row-main"><strong>${escapar(item.nome)}</strong><small>Mínimo: ${item.minimo} ${escapar(item.unidade || "un")}</small></div><span class="stock-low">${item.quantidade} ${escapar(item.unidade || "un")}</span></div>`).join("") : "Estoque tranquilo.";

  const hoje = dataLojaISO();
  const encomendas = pedidos.filter(item => item.origemTipo === "festa" && item.dataOperacao >= hoje && !statusFinal(item.status)).sort((a, b) => a.dataOperacao.localeCompare(b.dataOperacao)).slice(0, 5);
  $("dashboardEncomendas").className = `compact-list ${encomendas.length ? "" : "empty-state"}`;
  $("dashboardEncomendas").innerHTML = encomendas.length ? encomendas.map(item => `<div class="compact-row"><span class="appointment-date">${textoData(item.dataOperacao)}</span><div class="row-main"><strong>${escapar(item.clienteNome)} — ${escapar(item.numeroExibicao)}</strong><small>${item.itens.map(produto => `${produto.quantidade}× ${produto.nome}`).join(" • ")}</small></div><span class="row-value">${formatarMoedaGestao(item.valor)}</span></div>`).join("") : "Nenhuma encomenda próxima.";
}

function renderPedidos() {
  const termo = String($("buscaPedidos")?.value || "").toLowerCase();
  const origem = $("filtroOrigemPedidos")?.value || "todos";
  const statusFiltro = $("filtroStatusPedidos")?.value || "abertos";
  const todos = pedidosConsolidados();
  const lista = todos.filter(pedido => {
    const texto = `${pedido.numeroExibicao} ${pedido.clienteNome} ${pedido.clienteTelefone}`.toLowerCase();
    const origemOk = origem === "todos" || pedido.origemTipo === origem;
    const statusOk = statusFiltro === "todos" || (statusFiltro === "abertos" ? !statusFinal(pedido.status) : pedido.status === statusFiltro || (statusFiltro === "cancelado" && pedido.status === "cancelada"));
    return texto.includes(termo) && origemOk && statusOk;
  });
  const faixas = ["registrado", "confirmado", "producao", "pronto", "saiu_entrega", "entregue"];
  $("resumoPedidosFaixas").innerHTML = faixas.map(status => `<div class="summary-chip"><strong>${todos.filter(item => status === "registrado" ? ["registrado", "aguardando_confirmacao"].includes(item.status) : item.status === status).length}</strong><span>${infoStatus(status).nome}</span></div>`).join("");
  $("listaPedidosGestao").innerHTML = lista.length ? lista.map(htmlPedidoCard).join("") : '<div class="surface empty-state">Nenhum pedido encontrado com esses filtros.</div>';
  $("listaPedidosGestao").querySelectorAll(".order-card").forEach(card => bindCardPedido(card, todos.find(item => item.chave === card.dataset.order)));
}

function bindCardPedido(card, pedido) {
  if (!pedido) return;
  card.querySelector("[data-order-status]")?.addEventListener("change", async evento => alterarStatusComFeedback(pedido, evento.target.value));
  card.querySelector("[data-next]")?.addEventListener("click", evento => alterarStatusComFeedback(pedido, evento.currentTarget.dataset.next));
  card.querySelector("[data-detail]")?.addEventListener("click", () => abrirDetalhesPedido(pedido));
}

async function alterarStatusComFeedback(pedido, status) {
  try {
    await atualizarStatusPedidoGestao(pedido, status);
    toast(`Pedido ${pedido.numeroExibicao} atualizado para ${infoStatus(status).nome}.`, "success");
  } catch (erro) { toast(erro.message || "Não foi possível atualizar o pedido.", "error"); }
}

function abrirDetalhesPedido(pedido) {
  const endereco = pedido.endereco || [pedido.enderecoDetalhado?.rua, pedido.enderecoDetalhado?.numero, pedido.enderecoDetalhado?.bairro].filter(Boolean).join(", ");
  abrirModal(`Pedido ${pedido.numeroExibicao}`, `<div class="modal-form"><div class="form-grid"><label>Cliente<input readonly value="${escapar(pedido.clienteNome)}"></label><label>Telefone<input readonly value="${escapar(pedido.clienteTelefone)}"></label><label>Origem<input readonly value="${escapar(pedido.origemNome)}"></label><label>Pagamento<input readonly value="${escapar(pedido.pagamento || "Não informado")}"></label><label class="full">Endereço<textarea readonly rows="2">${escapar(endereco || "Retirada na loja")}</textarea></label></div><fieldset><legend>Itens</legend>${htmlItens(pedido, 100)}</fieldset><div class="form-grid"><label>Subtotal<input readonly value="${formatarMoedaGestao(pedido.subtotalProdutos || pedido.valor - numeroSeguro(pedido.taxaEntrega))}"></label><label>Taxa de entrega<input readonly value="${pedido.taxaEntrega == null ? "A confirmar" : formatarMoedaGestao(pedido.taxaEntrega)}"></label><label>Distância<input readonly value="${pedido.distanciaEntregaKm == null ? "Não calculada" : `${pedido.distanciaEntregaKm} km`}"></label><label>Total<input readonly value="${formatarMoedaGestao(pedido.valor)}"></label><label class="full">Observações<textarea readonly rows="3">${escapar(pedido.observacao || pedido.observacoes || "")}</textarea></label></div></div>`, pedido.origemNome);
}

function renderCozinha() {
  const pedidos = pedidosConsolidados();
  const necessidades = gerarNecessidadesProducao(pedidos);
  $("necessidadesCozinha").innerHTML = necessidades.length ? necessidades.map(item => `<div class="need-chip"><strong>${item.quantidade}</strong><span>${escapar(item.nome)}${item.detalhe ? ` — ${escapar(item.detalhe)}` : ""}</span></div>`).join("") : '<div class="empty-state">Nada para preparar agora.</div>';
  const grupos = { confirmado: pedidos.filter(item => item.status === "confirmado"), producao: pedidos.filter(item => item.status === "producao"), pronto: pedidos.filter(item => item.status === "pronto") };
  [["cozinhaConfirmados", "confirmado"], ["cozinhaProducao", "producao"], ["cozinhaProntos", "pronto"]].forEach(([id, status]) => {
    const container = $(id);
    container.innerHTML = grupos[status].length ? grupos[status].map(pedido => `<article class="kitchen-card" data-kitchen="${escapar(pedido.chave)}"><h4>${escapar(pedido.numeroExibicao)} — ${escapar(pedido.clienteNome)}</h4><p>${escapar(pedido.horaOperacao || "Sem horário")} • ${escapar(pedido.tipoAtendimento)}</p>${htmlItens(pedido, 100)}${pedido.observacao || pedido.observacoes ? `<div class="note">${escapar(pedido.observacao || pedido.observacoes)}</div>` : ""}<button data-kitchen-next="${proximoStatus(pedido)[0]}">${proximoStatus(pedido)[1]}</button></article>`).join("") : '<div class="empty-state">Nenhum pedido.</div>';
    container.querySelectorAll("[data-kitchen]").forEach(card => {
      const pedido = grupos[status].find(item => item.chave === card.dataset.kitchen);
      card.querySelector("button")?.addEventListener("click", evento => alterarStatusComFeedback(pedido, evento.currentTarget.dataset.kitchenNext));
    });
  });
  $("countConfirmados").textContent = grupos.confirmado.length;
  $("countProducao").textContent = grupos.producao.length;
  $("countProntos").textContent = grupos.pronto.length;
  $("cozinhaAtualizada").textContent = horaLoja();
}

function renderCardapio() {
  const data = $("dataCardapioGestao")?.value || dataLojaISO();
  const registro = estadoGestao.cardapios.find(item => item.id === data || item.dataISO === data);
  if ($("observacaoCardapioGestao")) $("observacaoCardapioGestao").value = registro?.observacao || "";
  if ($("publicarCardapioGestao")) $("publicarCardapioGestao").checked = registro?.publicado !== false;
  const selecionados = new Set(registro?.produtoIds || estadoGestao.produtos.filter(item => item.ativo !== false).map(item => item.id));
  $("produtosCardapioGestao").innerHTML = estadoGestao.produtos.filter(item => item.ativo !== false).map(produto => `<label class="menu-check"><input type="checkbox" value="${escapar(produto.id)}" ${selecionados.has(produto.id) ? "checked" : ""}><span class="emoji">${escapar(produto.emoji || "🍽️")}</span><span><strong>${escapar(produto.nome)}</strong><small>${formatarMoedaGestao(produto.preco)}</small></span></label>`).join("") || '<div class="empty-state">Cadastre produtos no painel.</div>';
}

function produtosDisponiveis() {
  return estadoGestao.produtos.filter(produto => produto.ativo !== false);
}

function opcoesProduto(produto) {
  if (Array.isArray(produto.variacoes) && produto.variacoes.length) return produto.variacoes.filter(item => item.ativa !== false).map(item => ({ id: produto.id, variacaoId: item.id, nome: `${produto.nome} — ${item.nome}`, emoji: produto.emoji, preco: numeroSeguro(item.preco || produto.preco), estoque: numeroSeguro(item.estoque), sobEncomenda: item.sobEncomenda || produto.sobEncomenda }));
  return [{ id: produto.id, variacaoId: "", nome: produto.nome, emoji: produto.emoji, preco: numeroSeguro(produto.preco), estoque: numeroSeguro(produto.estoque), sobEncomenda: produto.sobEncomenda }];
}

function todasOpcoesProdutos() {
  return produtosDisponiveis().flatMap(opcoesProduto);
}

function renderBalcao() {
  const termo = String($("buscaBalcao")?.value || "").toLowerCase();
  const opcoes = todasOpcoesProdutos().filter(item => item.nome.toLowerCase().includes(termo));
  $("produtosBalcao").innerHTML = opcoes.map(item => `<button class="pos-product" data-pos="${escapar(`${item.id}|${item.variacaoId}`)}" ${!item.sobEncomenda && item.estoque <= 0 ? "disabled" : ""}><span>${escapar(item.emoji || "🍽️")}</span><strong>${escapar(item.nome)}</strong><small>${formatarMoedaGestao(item.preco)}${item.sobEncomenda ? " • encomenda" : ` • ${item.estoque} disp.`}</small></button>`).join("");
  $("produtosBalcao").querySelectorAll("[data-pos]").forEach(botao => botao.addEventListener("click", () => {
    const [id, variacaoId] = botao.dataset.pos.split("|");
    const item = opcoes.find(opcao => opcao.id === id && opcao.variacaoId === variacaoId);
    const existente = carrinhoBalcao.find(opcao => opcao.id === id && opcao.variacaoId === variacaoId);
    if (existente) existente.quantidade += 1;
    else carrinhoBalcao.push({ ...item, quantidade: 1 });
    renderCarrinhoBalcao();
  }));
  renderCarrinhoBalcao();
}

function totaisBalcao() {
  const subtotal = carrinhoBalcao.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
  const desconto = Math.min(subtotal, Math.max(0, numeroSeguro($("descontoBalcao")?.value)));
  return { subtotal, desconto, total: subtotal - desconto };
}

function renderCarrinhoBalcao() {
  const container = $("itensVendaBalcao");
  if (!container) return;
  container.className = `pos-items ${carrinhoBalcao.length ? "" : "empty-state"}`;
  container.innerHTML = carrinhoBalcao.length ? carrinhoBalcao.map((item, indice) => `<div class="pos-item"><div><strong>${escapar(item.nome)}</strong><small>${formatarMoedaGestao(item.preco)} cada</small></div><div class="quantity-controls"><button data-pos-minus="${indice}">−</button><b>${item.quantidade}</b><button data-pos-plus="${indice}">＋</button></div></div>`).join("") : "Toque em um produto para começar.";
  container.querySelectorAll("[data-pos-minus]").forEach(botao => botao.addEventListener("click", () => { const item = carrinhoBalcao[Number(botao.dataset.posMinus)]; item.quantidade -= 1; if (item.quantidade <= 0) carrinhoBalcao.splice(Number(botao.dataset.posMinus), 1); renderCarrinhoBalcao(); }));
  container.querySelectorAll("[data-pos-plus]").forEach(botao => botao.addEventListener("click", () => { carrinhoBalcao[Number(botao.dataset.posPlus)].quantidade += 1; renderCarrinhoBalcao(); }));
  const total = totaisBalcao();
  $("subtotalBalcao").textContent = formatarMoedaGestao(total.subtotal);
  $("totalBalcao").textContent = formatarMoedaGestao(total.total);
  atualizarSomaMistaBalcao();
}

function atualizarSomaMistaBalcao() {
  if (!$("somaMistoBalcao")) return;
  const soma = [...document.querySelectorAll("#pagamentosMistosBalcao [data-pay]")].reduce((total, campo) => total + numeroSeguro(campo.value), 0);
  $("somaMistoBalcao").textContent = `Soma: ${formatarMoedaGestao(soma)} • Total: ${formatarMoedaGestao(totaisBalcao().total)}`;
}

async function finalizarBalcao() {
  const { subtotal, desconto, total } = totaisBalcao();
  if (!carrinhoBalcao.length || total <= 0) return toast("Adicione itens e confira o total.", "error");
  const pagamento = $("pagamentoBalcao").value;
  const pagamentos = pagamento === "Pagamento misto" ? [...document.querySelectorAll("#pagamentosMistosBalcao [data-pay]")].map(campo => ({ tipo: campo.dataset.pay, valor: numeroSeguro(campo.value) })).filter(item => item.valor > 0) : [{ tipo: pagamento, valor: total }];
  const soma = pagamentos.reduce((valor, item) => valor + item.valor, 0);
  if (Math.abs(soma - total) >= .01) return toast("A soma dos pagamentos precisa ser igual ao total.", "error");
  try {
    await registrarVendaRapida({ itens: carrinhoBalcao.map(item => ({ id: item.id, variacaoId: item.variacaoId, nome: item.nome, preco: item.preco, quantidade: item.quantidade })), pagamento, pagamentos, total, observacao: `${$("observacaoBalcao").value || "Venda de balcão"}${desconto ? ` • Desconto: ${formatarMoedaGestao(desconto)} sobre ${formatarMoedaGestao(subtotal)}` : ""}`, origem: "gestao-balcao" });
    carrinhoBalcao = [];
    $("descontoBalcao").value = "0";
    $("observacaoBalcao").value = "";
    document.querySelectorAll("#pagamentosMistosBalcao [data-pay]").forEach(campo => { campo.value = ""; });
    renderBalcao();
    toast("Venda finalizada e registrada no caixa.", "success");
  } catch (erro) { toast(erro.message || "Não foi possível finalizar a venda.", "error"); }
}

function renderEntregas() {
  const pedidos = pedidosConsolidados().filter(item => item.tipoAtendimento === "Entrega");
  const lista = pedidos.filter(item => filtroEntregaAtual === "pendentes" ? ["confirmado", "producao", "pronto"].includes(item.status) : filtroEntregaAtual === "rota" ? item.status === "saiu_entrega" : item.status === "entregue");
  $("listaEntregasGestao").innerHTML = lista.length ? lista.map(pedido => {
    const endereco = pedido.endereco || [pedido.enderecoDetalhado?.rua, pedido.enderecoDetalhado?.numero, pedido.enderecoDetalhado?.bairro].filter(Boolean).join(", ");
    const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
    const [proximo, acao] = proximoStatus(pedido);
    return `<article class="delivery-card" data-delivery="${escapar(pedido.chave)}"><span class="status-pill ${infoStatus(pedido.status).classe}">${infoStatus(pedido.status).nome}</span><h3>${escapar(pedido.numeroExibicao)} — ${escapar(pedido.clienteNome)}</h3><p>${escapar(pedido.clienteTelefone)}</p><div class="delivery-address">${escapar(endereco || "Endereço não informado")}</div><p>${pedido.distanciaEntregaKm != null ? `${pedido.distanciaEntregaKm} km • ` : ""}${pedido.taxaEntrega != null ? `Taxa ${formatarMoedaGestao(pedido.taxaEntrega)}` : "Taxa a confirmar"}</p><div class="card-actions"><a class="map-action" href="${mapa}" target="_blank" rel="noopener">Abrir no Maps</a>${proximo ? `<button class="status-action" data-delivery-next="${proximo}">${acao}</button>` : ""}</div></article>`;
  }).join("") : '<div class="surface empty-state">Nenhuma entrega nesta situação.</div>';
  $("listaEntregasGestao").querySelectorAll("[data-delivery]").forEach(card => { const pedido = pedidos.find(item => item.chave === card.dataset.delivery); card.querySelector("[data-delivery-next]")?.addEventListener("click", evento => alterarStatusComFeedback(pedido, evento.currentTarget.dataset.deliveryNext)); });
}

function renderEncomendas() {
  const termo = String($("buscaEncomendas")?.value || "").toLowerCase();
  const filtro = $("filtroEncomendas")?.value || "abertas";
  const hoje = dataLojaISO();
  const lista = pedidosConsolidados().filter(item => item.origemTipo === "festa").filter(item => `${item.numeroExibicao} ${item.clienteNome}`.toLowerCase().includes(termo)).filter(item => filtro === "todas" || (filtro === "abertas" ? item.dataOperacao >= hoje && !statusFinal(item.status) : item.status === filtro || (filtro === "cancelado" && item.status === "cancelada")));
  $("listaEncomendasGestao").innerHTML = lista.length ? lista.map(pedido => `<article class="appointment-card" data-appointment="${pedido.id}"><span class="appointment-date">${textoData(pedido.dataOperacao)}</span><span class="status-pill ${infoStatus(pedido.status).classe}">${infoStatus(pedido.status).nome}</span><h3>${escapar(pedido.clienteNome)} — ${escapar(pedido.numeroExibicao)}</h3><p>${pedido.itens.map(item => `${item.quantidade}× ${item.nome}`).join(" • ")}</p><p><b>${formatarMoedaGestao(pedido.valor)}</b> • ${escapar(pedido.tipoAtendimento)}</p><div class="card-actions"><button class="map-action" data-detail>Detalhes</button>${proximoStatus(pedido)[0] ? `<button class="status-action" data-next="${proximoStatus(pedido)[0]}">${proximoStatus(pedido)[1]}</button>` : ""}</div></article>`).join("") : '<div class="surface empty-state">Nenhuma encomenda encontrada.</div>';
  $("listaEncomendasGestao").querySelectorAll("[data-appointment]").forEach(card => { const pedido = lista.find(item => item.id === card.dataset.appointment); card.querySelector("[data-detail]").addEventListener("click", () => abrirDetalhesPedido(pedido)); card.querySelector("[data-next]")?.addEventListener("click", evento => alterarStatusComFeedback(pedido, evento.currentTarget.dataset.next)); });
}

function sessaoAberta() {
  return estadoGestao.sessoesCaixa.find(item => item.status === "aberto") || null;
}

function dadosCaixa() {
  const sessao = sessaoAberta();
  const pagamentos = resumirPagamentos(estadoGestao.vendas, pedidosConsolidados());
  const movimentos = sessao ? estadoGestao.movimentosCaixa.filter(item => item.sessaoId === sessao.id) : [];
  const dinheiro = numeroSeguro(pagamentos.find(item => item.tipo === "Dinheiro")?.valor);
  const sangrias = movimentos.filter(item => item.tipo === "sangria").reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const suprimentos = movimentos.filter(item => item.tipo === "suprimento").reduce((soma, item) => soma + numeroSeguro(item.valor), 0);
  const esperado = numeroSeguro(sessao?.valorInicial) + dinheiro + suprimentos - sangrias;
  return { sessao, pagamentos, movimentos, dinheiro, sangrias, suprimentos, esperado, vendas: pagamentos.reduce((soma, item) => soma + item.valor, 0) };
}

function renderCaixa() {
  const dados = dadosCaixa();
  $("caixaStatusCard").className = `cash-status-card ${dados.sessao ? "open" : ""}`;
  $("caixaStatusCard").innerHTML = dados.sessao ? `<div><p class="kicker">Caixa aberto</p><h3>${escapar(dados.sessao.responsavel || "Responsável")}</h3><p>Aberto às ${escapar(dados.sessao.horaAbertura || "--:--")} com ${formatarMoedaGestao(dados.sessao.valorInicial)}</p></div><div class="cash-status-actions"><button class="secondary-btn" data-action="movimento-caixa">Sangria/suprimento</button><button class="primary-btn" data-action="fechar-caixa">Fechar caixa</button></div>` : `<div><p class="kicker">Caixa fechado</p><h3>Abra o caixa para iniciar o dia</h3><p>Informe o dinheiro inicial que existe na gaveta.</p></div><button class="primary-btn" data-action="abrir-caixa">Abrir caixa</button>`;
  $("caixaDinheiroEsperado").textContent = formatarMoedaGestao(dados.esperado);
  $("caixaVendasDia").textContent = formatarMoedaGestao(dados.vendas);
  $("caixaSangrias").textContent = formatarMoedaGestao(dados.sangrias);
  $("caixaSuprimentos").textContent = formatarMoedaGestao(dados.suprimentos);
  $("resumoPagamentosCaixa").innerHTML = dados.pagamentos.length ? dados.pagamentos.map(item => `<div class="payment-row"><span>${escapar(item.tipo)}</span><strong>${formatarMoedaGestao(item.valor)}</strong></div>`).join("") : '<div class="empty-state">Nenhum recebimento hoje.</div>';
  const historico = estadoGestao.sessoesCaixa.filter(item => item.status === "fechado").slice(0, 8);
  $("historicoCaixa").innerHTML = historico.length ? historico.map(item => `<div class="compact-row"><div class="row-main"><strong>${textoData(item.dataISO)} — ${escapar(item.responsavel)}</strong><small>Esperado ${formatarMoedaGestao(item.valorEsperado)} • contado ${formatarMoedaGestao(item.valorContado)}</small></div><span class="row-value ${numeroSeguro(item.diferenca) ? "stock-low" : ""}">${formatarMoedaGestao(item.diferenca)}</span></div>`).join("") : '<div class="empty-state">Nenhum fechamento anterior.</div>';
}

function renderEstoque() {
  document.querySelectorAll("[data-stock-tab]").forEach(botao => botao.classList.toggle("active", botao.dataset.stockTab === abaEstoqueAtual));
  const container = $("conteudoEstoqueGestao");
  if (abaEstoqueAtual === "insumos") {
    container.innerHTML = `<div class="stock-table"><div class="stock-row header"><span>Insumo</span><span>Quantidade</span><span>Mínimo</span><span>Custo unit.</span><span>Validade</span><span>Ações</span></div>${estadoGestao.insumos.map(item => `<div class="stock-row"><div><strong>${escapar(item.nome)}</strong><small>${escapar(item.categoria || "Ingredientes")}</small></div><span class="${numeroSeguro(item.quantidade) <= numeroSeguro(item.minimo) ? "stock-low" : ""}">${item.quantidade} ${escapar(item.unidade)}</span><span>${item.minimo} ${escapar(item.unidade)}</span><span>${formatarMoedaGestao(item.custoUnitario)}</span><span>${item.validade ? textoData(item.validade) : "—"}</span><div class="stock-actions"><button data-stock-move="${item.id}">Movimentar</button><button data-stock-edit="${item.id}">Editar</button></div></div>`).join("") || '<div class="empty-state">Nenhum insumo cadastrado.</div>'}</div>`;
    container.querySelectorAll("[data-stock-move]").forEach(botao => botao.addEventListener("click", () => abrirMovimentoInsumo(estadoGestao.insumos.find(item => item.id === botao.dataset.stockMove))));
    container.querySelectorAll("[data-stock-edit]").forEach(botao => botao.addEventListener("click", () => abrirInsumo(estadoGestao.insumos.find(item => item.id === botao.dataset.stockEdit))));
  } else if (abaEstoqueAtual === "produtos") {
    container.innerHTML = `<div class="stock-table"><div class="stock-row header"><span>Produto</span><span>Disponível</span><span>Mínimo</span><span>Preço</span><span>Status</span><span></span></div>${todasOpcoesProdutos().map(item => `<div class="stock-row"><div><strong>${escapar(item.nome)}</strong><small>Produto pronto</small></div><span class="${!item.sobEncomenda && item.estoque <= 0 ? "stock-low" : ""}">${item.sobEncomenda ? "Sob encomenda" : `${item.estoque} un`}</span><span>—</span><span>${formatarMoedaGestao(item.preco)}</span><span>${item.sobEncomenda || item.estoque > 0 ? "Disponível" : "Esgotado"}</span><span></span></div>`).join("")}</div>`;
  } else if (abaEstoqueAtual === "fichas") {
    container.innerHTML = `<div class="page-toolbar"><button class="primary-btn" data-action="nova-ficha">＋ Nova ficha técnica</button></div><div class="data-list">${estadoGestao.fichasTecnicas.map(item => `<div class="data-row"><div class="row-main"><strong>${escapar(item.produtoNome)}</strong><small>${(item.ingredientes || []).map(ingrediente => `${ingrediente.quantidade} ${ingrediente.unidade} ${ingrediente.nome}`).join(" • ")}</small></div><span class="row-value">${formatarMoedaGestao(item.custoCalculado)}</span></div>`).join("") || '<div class="surface empty-state">Nenhuma ficha técnica cadastrada.</div>'}</div>`;
  } else {
    container.innerHTML = `<div class="page-toolbar"><button class="primary-btn" data-action="nova-perda">＋ Registrar perda</button></div><div class="data-list">${estadoGestao.perdasEstoque.map(item => `<div class="data-row"><div class="row-main"><strong>${escapar(item.insumoNome)}</strong><small>${item.quantidade} ${escapar(item.unidade)} • ${escapar(item.motivo)} • ${textoData(item.dataISO)}</small></div><span class="row-value">${formatarMoedaGestao(item.valorEstimado)}</span></div>`).join("") || '<div class="surface empty-state">Nenhuma perda registrada.</div>'}</div>`;
  }
}

function renderCompras() {
  const mes = dataLojaISO().slice(0, 7);
  const comprasMes = estadoGestao.compras.filter(item => String(item.dataISO || "").startsWith(mes));
  $("comprasMesValor").textContent = formatarMoedaGestao(comprasMes.reduce((soma, item) => soma + numeroSeguro(item.totalFinal), 0));
  $("comprasMesQtd").textContent = comprasMes.length;
  $("fornecedoresQtd").textContent = estadoGestao.fornecedores.filter(item => item.ativo !== false).length;
  $("comprasPendentes").textContent = estadoGestao.compras.filter(item => item.statusPagamento === "pendente").length;
  $("listaComprasGestao").innerHTML = estadoGestao.compras.length ? estadoGestao.compras.map(item => `<div class="data-row"><div class="row-main"><strong>${escapar(item.fornecedorNome)}</strong><small>${textoData(item.dataISO)} • ${(item.itens || []).length} item(ns) • ${escapar(item.pagamento)}</small></div><span class="status-pill ${item.statusPagamento === "pendente" ? "novo" : "concluido"}">${item.statusPagamento === "pendente" ? "Pendente" : "Pago"}</span><span class="row-value">${formatarMoedaGestao(item.totalFinal)}</span></div>`).join("") : '<div class="empty-state">Nenhuma compra registrada.</div>';
  $("listaFornecedoresGestao").innerHTML = estadoGestao.fornecedores.length ? estadoGestao.fornecedores.map(item => `<div class="compact-row"><div class="row-main"><strong>${escapar(item.nome)}</strong><small>${escapar(item.contato || item.telefone || "Sem contato")}</small></div><button class="text-btn" data-supplier="${item.id}">Editar</button></div>`).join("") : '<div class="empty-state">Nenhum fornecedor cadastrado.</div>';
  $("listaFornecedoresGestao").querySelectorAll("[data-supplier]").forEach(botao => botao.addEventListener("click", () => abrirFornecedor(estadoGestao.fornecedores.find(item => item.id === botao.dataset.supplier))));
}

function periodoPadrao() {
  const fim = dataLojaISO();
  return { inicio: `${fim.slice(0, 8)}01`, fim };
}

function renderFinanceiro() {
  const inicio = $("financeiroInicio")?.value || periodoPadrao().inicio;
  const fim = $("financeiroFim")?.value || periodoPadrao().fim;
  const relatorio = calcularRelatorioGestao({ pedidos: pedidosConsolidados(), vendas: estadoGestao.vendas, movimentos: estadoGestao.movimentosFinanceiros, inicio, fim });
  $("financeiroEntradas").textContent = formatarMoedaGestao(relatorio.receita);
  $("financeiroSaidas").textContent = formatarMoedaGestao(relatorio.despesas);
  $("financeiroResultado").textContent = formatarMoedaGestao(relatorio.resultado);
  $("financeiroTicket").textContent = formatarMoedaGestao(relatorio.ticketMedio);
  const termo = String($("buscaFinanceiro")?.value || "").toLowerCase();
  const lista = estadoGestao.movimentosFinanceiros.filter(item => (!inicio || item.dataISO >= inicio) && (!fim || item.dataISO <= fim)).filter(item => `${item.descricao} ${item.categoria} ${item.pagamento}`.toLowerCase().includes(termo));
  $("listaFinanceiroGestao").innerHTML = `<div class="finance-row header"><span>Data</span><span>Lançamento</span><span>Categoria</span><span>Pagamento</span><span>Valor</span></div>${lista.map(item => `<div class="finance-row"><span>${textoData(item.dataISO)}</span><div><strong>${escapar(item.descricao)}</strong><small>${escapar(item.origem || "Manual")}</small></div><span>${escapar(item.categoria)}</span><span>${escapar(item.pagamento)}</span><strong class="${item.tipo === "saida" ? "stock-low" : ""}">${item.tipo === "saida" ? "−" : "+"} ${formatarMoedaGestao(item.valor)}</strong></div>`).join("") || '<div class="empty-state">Nenhum lançamento no período.</div>'}`;
}

function dadosClientes() {
  const pedidos = pedidosConsolidados();
  return estadoGestao.usuarios.filter(item => item.tipo !== "admin").map(cliente => {
    const relacionados = pedidos.filter(pedido => pedido.usuarioId === cliente.uid || pedido.cliente?.uid === cliente.uid || (cliente.telefone && pedido.clienteTelefone === cliente.telefone));
    const total = relacionados.filter(pedido => !["cancelado", "cancelada"].includes(pedido.status)).reduce((soma, pedido) => soma + pedido.valor, 0);
    return { ...cliente, pedidos: relacionados, total, ultimo: relacionados[0] || null };
  });
}

function renderClientes() {
  const termo = String($("buscaClientes")?.value || "").toLowerCase();
  const clientes = dadosClientes();
  const lista = clientes.filter(item => `${item.nome} ${item.email} ${item.telefone}`.toLowerCase().includes(termo));
  const mes = dataLojaISO().slice(0, 7);
  const pedidosIdentificados = clientes.reduce((soma, item) => soma + item.pedidos.length, 0);
  const total = clientes.reduce((soma, item) => soma + item.total, 0);
  $("clientesTotal").textContent = clientes.length;
  $("clientesAtivosMes").textContent = clientes.filter(item => item.pedidos.some(pedido => String(pedido.dataOperacao).startsWith(mes))).length;
  $("clientesPedidos").textContent = pedidosIdentificados;
  $("clientesTicket").textContent = formatarMoedaGestao(pedidosIdentificados ? total / pedidosIdentificados : 0);
  $("listaClientesGestao").innerHTML = lista.length ? lista.map(cliente => `<article class="customer-card" data-customer="${cliente.uid}"><div class="customer-head"><span class="customer-avatar">${iniciais(cliente.nome)}</span><div><h3>${escapar(cliente.nome || "Cliente")}</h3><p>${escapar(cliente.telefone || cliente.email || "Sem contato")}</p></div></div><p>${escapar([cliente.endereco?.rua, cliente.endereco?.numero, cliente.endereco?.bairro].filter(Boolean).join(", ") || "Endereço não informado")}</p><div class="customer-metrics"><span>Pedidos<b>${cliente.pedidos.length}</b></span><span>Total comprado<b>${formatarMoedaGestao(cliente.total)}</b></span></div><div class="card-actions"><button class="map-action" data-customer-detail>Histórico</button><button class="status-action" data-customer-note>Observação</button></div></article>`).join("") : '<div class="surface empty-state">Nenhum cliente encontrado.</div>';
  $("listaClientesGestao").querySelectorAll("[data-customer]").forEach(card => { const cliente = clientes.find(item => item.uid === card.dataset.customer); card.querySelector("[data-customer-detail]").addEventListener("click", () => abrirCliente(cliente)); card.querySelector("[data-customer-note]").addEventListener("click", () => abrirObservacaoCliente(cliente)); });
}

function renderRelatorios() {
  const inicio = $("relatorioInicio")?.value || periodoPadrao().inicio;
  const fim = $("relatorioFim")?.value || periodoPadrao().fim;
  const relatorio = calcularRelatorioGestao({ pedidos: pedidosConsolidados(), vendas: estadoGestao.vendas, movimentos: estadoGestao.movimentosFinanceiros, inicio, fim });
  $("relatorioReceita").textContent = formatarMoedaGestao(relatorio.receita);
  $("relatorioDespesas").textContent = formatarMoedaGestao(relatorio.despesas);
  $("relatorioResultado").textContent = formatarMoedaGestao(relatorio.resultado);
  $("relatorioPedidos").textContent = relatorio.pedidos;
  const maximo = Math.max(...relatorio.dias.map(item => item.valor), 1);
  $("graficoVendasDias").innerHTML = relatorio.dias.length ? relatorio.dias.map(item => `<div class="bar-column" title="${textoData(item.data)} — ${formatarMoedaGestao(item.valor)}"><b>${formatarMoedaGestao(item.valor).replace("R$ ", "")}</b><i style="height:${Math.max(3, (item.valor / maximo) * 170)}px"></i><span>${item.data.slice(8, 10)}/${item.data.slice(5, 7)}</span></div>`).join("") : '<div class="empty-state">Sem dados neste período.</div>';
  $("rankingProdutos").innerHTML = relatorio.produtos.slice(0, 10).map((item, indice) => `<div class="ranking-row"><span>${indice + 1}. ${escapar(item.nome)}</span><strong>${item.quantidade} un</strong></div>`).join("") || '<div class="empty-state">Sem produtos vendidos.</div>';
  $("rankingPagamentos").innerHTML = relatorio.pagamentos.map(item => `<div class="ranking-row"><span>${escapar(item.tipo)}</span><strong>${formatarMoedaGestao(item.valor)}</strong></div>`).join("") || '<div class="empty-state">Sem pagamentos registrados.</div>';
}

function renderEquipe() {
  if (!isAdmin) return;
  const solicitacoes = estadoGestao.solicitacoesAcesso.filter(item => item.status === "pendente");
  $("solicitacoesEquipe").innerHTML = solicitacoes.length ? solicitacoes.map(item => `<div class="compact-row"><div class="customer-avatar">${iniciais(item.nome)}</div><div class="row-main"><strong>${escapar(item.nome || "Pessoa")}</strong><small>${escapar(item.email)}</small></div><button class="primary-btn" data-approve="${item.uid}">Analisar</button></div>`).join("") : '<div class="empty-state">Nenhuma solicitação aguardando.</div>';
  $("membrosEquipe").innerHTML = estadoGestao.equipe.length ? estadoGestao.equipe.map(item => `<div class="team-row"><div class="customer-avatar">${iniciais(item.nome)}</div><div class="row-main"><strong>${escapar(item.nome)}</strong><small>${escapar(item.cargo)} • ${item.ativo ? "Ativo" : "Bloqueado"}</small></div><button class="text-btn" data-member="${item.uid}">Editar</button></div>`).join("") : '<div class="empty-state">Nenhum colaborador cadastrado.</div>';
  $("solicitacoesEquipe").querySelectorAll("[data-approve]").forEach(botao => botao.addEventListener("click", () => abrirAprovacaoEquipe(solicitacoes.find(item => item.uid === botao.dataset.approve))));
  $("membrosEquipe").querySelectorAll("[data-member]").forEach(botao => botao.addEventListener("click", () => abrirEdicaoEquipe(estadoGestao.equipe.find(item => item.uid === botao.dataset.member))));
}

function renderConfiguracoes() {
  const config = estadoGestao.configuracaoOperacao || {};
  $("configMetaDiaria").value = numeroSeguro(config.metaDiaria) || "";
  $("configTempoPreparo").value = numeroSeguro(config.tempoPreparo) || 40;
  $("configLimitePedidos").value = numeroSeguro(config.limitePedidos) || 25;
  $("configResponsavel").value = config.responsavel || usuarioAtual?.displayName || "";
  $("configSomPedidos").checked = config.somPedidos !== false;
  $("configBaixaEstoque").checked = config.baixaEstoque !== false;
}

function renderPagina(pagina = paginaAtual) {
  const mapa = { dashboard: renderDashboard, pedidos: renderPedidos, cozinha: renderCozinha, cardapio: renderCardapio, balcao: renderBalcao, entregas: renderEntregas, encomendas: renderEncomendas, caixa: renderCaixa, estoque: renderEstoque, compras: renderCompras, financeiro: renderFinanceiro, clientes: renderClientes, relatorios: renderRelatorios, equipe: renderEquipe, configuracoes: renderConfiguracoes };
  mapa[pagina]?.();
}

function renderTudo() {
  const pedidos = pedidosConsolidados();
  const abertos = pedidos.filter(item => !statusFinal(item.status));
  const cozinha = pedidos.filter(item => ["confirmado", "producao", "pronto"].includes(item.status));
  const entregas = pedidos.filter(item => item.tipoAtendimento === "Entrega" && ["confirmado", "producao", "pronto", "saiu_entrega"].includes(item.status));
  const estoque = calcularAlertasEstoque(estadoGestao.produtos, estadoGestao.insumos);
  [["badgePedidos", abertos.length], ["badgeCozinha", cozinha.length], ["badgeEntregas", entregas.length], ["badgeEstoque", estoque.length], ["badgeEquipe", estadoGestao.solicitacoesAcesso.filter(item => item.status === "pendente").length]].forEach(([id, valor]) => { if (!$(id)) return; $(id).textContent = valor; $(id).hidden = !valor; });
  if (ultimoTotalPedidos && pedidos.length > ultimoTotalPedidos && estadoGestao.configuracaoOperacao.somPedidos !== false) tocarAviso();
  ultimoTotalPedidos = pedidos.length;
  renderDashboard();
  if (paginaAtual !== "dashboard") renderPagina();
}

function tocarAviso() {
  try {
    const contexto = new AudioContext();
    const oscilador = contexto.createOscillator();
    const ganho = contexto.createGain();
    oscilador.frequency.setValueAtTime(680, contexto.currentTime);
    ganho.gain.setValueAtTime(.0001, contexto.currentTime);
    ganho.gain.exponentialRampToValueAtTime(.12, contexto.currentTime + .02);
    ganho.gain.exponentialRampToValueAtTime(.0001, contexto.currentTime + .24);
    oscilador.connect(ganho).connect(contexto.destination);
    oscilador.start(); oscilador.stop(contexto.currentTime + .25);
  } catch {}
}

function selectProdutosHtml() {
  return todasOpcoesProdutos().map(item => `<option value="${escapar(`${item.id}|${item.variacaoId}`)}">${escapar(item.nome)} — ${formatarMoedaGestao(item.preco)}</option>`).join("");
}

function abrirNovoPedido() {
  itensPedidoModal = [];
  abrirModal("Novo pedido", `<form id="formNovoPedido" class="modal-form"><div class="form-grid"><label>Origem<select id="pedidoOrigem"><option value="whatsapp">WhatsApp</option><option value="atendimento">Telefone/balcão</option></select></label><label>Nome do cliente<input id="pedidoClienteNome" required maxlength="120"></label><label>WhatsApp<input id="pedidoClienteTelefone" maxlength="30"></label><label>Atendimento<select id="pedidoTipo"><option>Retirada na loja</option><option>Entrega</option></select></label><label class="full">Endereço<input id="pedidoEndereco" maxlength="500" placeholder="Obrigatório para entrega"></label><label>Pagamento<select id="pedidoPagamento"><option>Pix</option><option>Dinheiro</option><option>Cartão débito</option><option>Cartão crédito</option><option>Não informado</option></select></label><label>Taxa de entrega (R$)<input id="pedidoTaxa" type="number" min="0" step="0.01" value="0"></label></div><fieldset><legend>Itens do pedido</legend><div class="modal-item-row"><select id="pedidoProdutoSelect">${selectProdutosHtml()}</select><input id="pedidoQuantidade" type="number" min="1" value="1"><input id="pedidoPreco" type="number" min="0" step="0.01"><button id="adicionarItemPedido" type="button">＋</button></div><div id="pedidoItensModal" class="modal-items"></div></fieldset><label>Observações<textarea id="pedidoObservacao" rows="3"></textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Criar pedido</button></div></form>`, "Atendimento");
  const preencherPreco = () => { const [id, variacaoId] = $("pedidoProdutoSelect").value.split("|"); const item = todasOpcoesProdutos().find(opcao => opcao.id === id && opcao.variacaoId === variacaoId); $("pedidoPreco").value = item?.preco || 0; };
  preencherPreco();
  $("pedidoProdutoSelect").addEventListener("change", preencherPreco);
  $("adicionarItemPedido").addEventListener("click", adicionarItemPedidoModal);
  $("formNovoPedido").addEventListener("submit", salvarNovoPedidoModal);
}

function adicionarItemPedidoModal() {
  const [id, variacaoId] = $("pedidoProdutoSelect").value.split("|");
  const produto = todasOpcoesProdutos().find(item => item.id === id && item.variacaoId === variacaoId);
  if (!produto) return;
  itensPedidoModal.push({ ...produto, quantidade: Math.max(1, numeroSeguro($("pedidoQuantidade").value)), preco: Math.max(0, numeroSeguro($("pedidoPreco").value)) });
  renderItensPedidoModal();
}

function renderItensPedidoModal() {
  $("pedidoItensModal").innerHTML = itensPedidoModal.map((item, indice) => `<div class="data-row"><div class="row-main"><strong>${item.quantidade}× ${escapar(item.nome)}</strong><small>${formatarMoedaGestao(item.preco)} cada</small></div><span class="row-value">${formatarMoedaGestao(item.preco * item.quantidade)}</span><button class="text-btn danger" data-remove-order-item="${indice}" type="button">Remover</button></div>`).join("") || '<div class="empty-state">Nenhum item adicionado.</div>';
  $("pedidoItensModal").querySelectorAll("[data-remove-order-item]").forEach(botao => botao.addEventListener("click", () => { itensPedidoModal.splice(Number(botao.dataset.removeOrderItem), 1); renderItensPedidoModal(); }));
}

async function salvarNovoPedidoModal(evento) {
  evento.preventDefault();
  try {
    await salvarPedidoManual({ origem: $("pedidoOrigem").value, cliente: { nome: $("pedidoClienteNome").value, telefone: $("pedidoClienteTelefone").value }, tipo: $("pedidoTipo").value, endereco: $("pedidoEndereco").value, pagamento: $("pedidoPagamento").value, taxaEntrega: $("pedidoTaxa").value, itens: itensPedidoModal, observacao: $("pedidoObservacao").value });
    fecharModal(); toast("Pedido criado e enviado para a central.", "success"); navegar("pedidos");
  } catch (erro) { toast(erro.message || "Não foi possível criar o pedido.", "error"); }
}

function abrirInsumo(item = {}) {
  abrirModal(item.id ? "Editar insumo" : "Novo insumo", `<form id="formInsumo" class="modal-form"><div class="form-grid"><label>Nome<input id="insumoNome" value="${escapar(item.nome || "")}" required></label><label>Categoria<select id="insumoCategoria">${["Ingredientes", "Bebidas", "Embalagens", "Limpeza", "Outros"].map(valor => `<option ${item.categoria === valor ? "selected" : ""}>${valor}</option>`).join("")}</select></label><label>Unidade<select id="insumoUnidade">${["un", "kg", "g", "L", "ml", "pacote", "caixa"].map(valor => `<option ${item.unidade === valor ? "selected" : ""}>${valor}</option>`).join("")}</select></label><label>Quantidade atual<input id="insumoQuantidade" type="number" min="0" step="0.001" value="${numeroSeguro(item.quantidade)}"></label><label>Estoque mínimo<input id="insumoMinimo" type="number" min="0" step="0.001" value="${numeroSeguro(item.minimo)}"></label><label>Custo unitário<input id="insumoCusto" type="number" min="0" step="0.01" value="${numeroSeguro(item.custoUnitario)}"></label><label>Validade<input id="insumoValidade" type="date" value="${escapar(item.validade || "")}"></label><label class="toggle-row"><input id="insumoAtivo" type="checkbox" ${item.ativo !== false ? "checked" : ""}><span><b>Insumo ativo</b></span></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Estoque");
  $("formInsumo").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarInsumo({ id: item.id, nome: $("insumoNome").value, categoria: $("insumoCategoria").value, unidade: $("insumoUnidade").value, quantidade: $("insumoQuantidade").value, minimo: $("insumoMinimo").value, custoUnitario: $("insumoCusto").value, validade: $("insumoValidade").value, ativo: $("insumoAtivo").checked }); fecharModal(); toast("Insumo salvo.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirMovimentoInsumo(item) {
  abrirModal(`Movimentar ${item.nome}`, `<form id="formMovimentoInsumo" class="modal-form"><div class="form-grid"><label>Tipo<select id="movInsumoTipo"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label><label>Quantidade (${escapar(item.unidade)})<input id="movInsumoQtd" type="number" min="0.001" step="0.001" required></label><label class="full">Motivo<input id="movInsumoMotivo" placeholder="Compra, uso, ajuste..."></label></div><p>Saldo atual: <b>${item.quantidade} ${escapar(item.unidade)}</b></p><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Confirmar</button></div></form>`, "Estoque");
  $("formMovimentoInsumo").addEventListener("submit", async evento => { evento.preventDefault(); try { await movimentarInsumo(item.id, { tipo: $("movInsumoTipo").value, quantidade: $("movInsumoQtd").value, motivo: $("movInsumoMotivo").value }); fecharModal(); toast("Estoque movimentado.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirPerda() {
  abrirModal("Registrar perda", `<form id="formPerda" class="modal-form"><div class="form-grid"><label>Insumo<select id="perdaInsumo">${estadoGestao.insumos.map(item => `<option value="${item.id}">${escapar(item.nome)} — ${item.quantidade} ${escapar(item.unidade)}</option>`).join("")}</select></label><label>Quantidade<input id="perdaQuantidade" type="number" min="0.001" step="0.001" required></label><label class="full">Motivo<input id="perdaMotivo" required placeholder="Vencimento, dano, sobra..."></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Registrar perda</button></div></form>`, "Estoque");
  $("formPerda").addEventListener("submit", async evento => { evento.preventDefault(); const item = estadoGestao.insumos.find(insumo => insumo.id === $("perdaInsumo").value); try { await registrarPerda({ insumoId: item.id, insumoNome: item.nome, unidade: item.unidade, quantidade: $("perdaQuantidade").value, motivo: $("perdaMotivo").value, valorEstimado: numeroSeguro($("perdaQuantidade").value) * numeroSeguro(item.custoUnitario) }); fecharModal(); toast("Perda registrada e retirada do estoque.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirFicha() {
  ingredientesFichaModal = [];
  abrirModal("Nova ficha técnica", `<form id="formFicha" class="modal-form"><div class="form-grid"><label>Produto<select id="fichaProduto">${estadoGestao.produtos.map(item => `<option value="${item.id}">${escapar(item.nome)}</option>`).join("")}</select></label><label>Rendimento da receita<input id="fichaRendimento" type="number" min="1" value="1"></label></div><fieldset><legend>Ingredientes</legend><div class="modal-item-row"><select id="fichaInsumo">${estadoGestao.insumos.map(item => `<option value="${item.id}">${escapar(item.nome)} (${escapar(item.unidade)})</option>`).join("")}</select><input id="fichaQuantidade" type="number" min="0.001" step="0.001"><span></span><button id="adicionarFichaItem" type="button">＋</button></div><div id="fichaIngredientesLista" class="modal-items"></div></fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar ficha</button></div></form>`, "Custo e produção");
  $("adicionarFichaItem").addEventListener("click", () => { const item = estadoGestao.insumos.find(insumo => insumo.id === $("fichaInsumo").value); ingredientesFichaModal.push({ insumoId: item.id, nome: item.nome, unidade: item.unidade, quantidade: numeroSeguro($("fichaQuantidade").value), custoUnitario: numeroSeguro(item.custoUnitario) }); renderFichaItens(); });
  $("formFicha").addEventListener("submit", async evento => { evento.preventDefault(); const produto = estadoGestao.produtos.find(item => item.id === $("fichaProduto").value); const custo = ingredientesFichaModal.reduce((soma, item) => soma + item.quantidade * item.custoUnitario, 0) / Math.max(1, numeroSeguro($("fichaRendimento").value)); try { await salvarFichaTecnica({ produtoId: produto.id, produtoNome: produto.nome, rendimento: $("fichaRendimento").value, ingredientes: ingredientesFichaModal, custoCalculado: custo }); fecharModal(); toast("Ficha técnica salva.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function renderFichaItens() { $("fichaIngredientesLista").innerHTML = ingredientesFichaModal.map((item, indice) => `<div class="data-row"><div class="row-main"><strong>${item.quantidade} ${escapar(item.unidade)} — ${escapar(item.nome)}</strong></div><span>${formatarMoedaGestao(item.quantidade * item.custoUnitario)}</span><button class="text-btn danger" type="button" data-remove-ficha="${indice}">Remover</button></div>`).join("") || '<div class="empty-state">Adicione os ingredientes usados.</div>'; $("fichaIngredientesLista").querySelectorAll("[data-remove-ficha]").forEach(botao => botao.addEventListener("click", () => { ingredientesFichaModal.splice(Number(botao.dataset.removeFicha), 1); renderFichaItens(); })); }

function abrirFornecedor(item = {}) {
  abrirModal(item.id ? "Editar fornecedor" : "Novo fornecedor", `<form id="formFornecedor" class="modal-form"><div class="form-grid"><label>Nome<input id="fornecedorNome" value="${escapar(item.nome || "")}" required></label><label>Contato<input id="fornecedorContato" value="${escapar(item.contato || "")}"></label><label>Telefone<input id="fornecedorTelefone" value="${escapar(item.telefone || "")}"></label><label class="full">Observação<textarea id="fornecedorObservacao">${escapar(item.observacao || "")}</textarea></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Compras");
  $("formFornecedor").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarFornecedor({ id: item.id, nome: $("fornecedorNome").value, contato: $("fornecedorContato").value, telefone: $("fornecedorTelefone").value, observacao: $("fornecedorObservacao").value }); fecharModal(); toast("Fornecedor salvo.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirCompra() {
  itensCompraModal = [];
  const leituraNota = isAdmin ? '<fieldset class="smart-scan"><legend>📷 Leitura inteligente da nota</legend><p>Tire uma foto nítida. A IA tenta preencher total final, desconto e pagamento; você confirma antes de salvar.</p><label class="scan-upload">Selecionar ou tirar foto<input id="compraNotaArquivo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label><small id="compraNotaStatus">Nenhuma foto analisada.</small></fieldset>' : "";
  abrirModal("Registrar compra", `<form id="formCompra" class="modal-form">${leituraNota}<div class="form-grid"><label>Fornecedor<select id="compraFornecedor"><option value="">Não informado</option>${estadoGestao.fornecedores.map(item => `<option value="${item.id}">${escapar(item.nome)}</option>`).join("")}</select></label><label>Data<input id="compraData" type="date" value="${dataLojaISO()}"></label><label>Pagamento<select id="compraPagamento"><option>Pix</option><option>Dinheiro</option><option>Cartão débito</option><option>Cartão crédito</option><option>Boleto</option><option>Não informado</option></select></label><label>Status<select id="compraStatus"><option value="pago">Pago</option><option value="pendente">Pendente</option></select></label><label>Vencimento<input id="compraVencimento" type="date"></label><label>Desconto (R$)<input id="compraDesconto" type="number" min="0" step="0.01" value="0"></label><label>Total final da nota (R$)<input id="compraTotalFinal" type="number" min="0" step="0.01" placeholder="Calculado pelos itens"></label></div><fieldset><legend>Itens comprados</legend><div class="modal-item-row"><select id="compraInsumo">${estadoGestao.insumos.map(item => `<option value="${item.id}">${escapar(item.nome)}</option>`).join("")}</select><input id="compraQtd" type="number" min="0.001" step="0.001" placeholder="Qtd"><input id="compraValorItem" type="number" min="0" step="0.01" placeholder="Total R$"><button id="adicionarCompraItem" type="button">＋</button></div><div id="compraItensLista" class="modal-items"></div></fieldset><label>Observação<textarea id="compraObservacao"></textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Registrar compra</button></div></form>`, "Compras e estoque");
  $("compraNotaArquivo")?.addEventListener("change", async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    const status = $("compraNotaStatus");
    status.textContent = "Analisando a nota…";
    try {
      const dados = await lerRegistroComIA(await prepararImagemParaIA(arquivo), "compra");
      if (dados.valor > 0) $("compraTotalFinal").value = dados.valor.toFixed(2);
      if (dados.desconto > 0) $("compraDesconto").value = dados.desconto.toFixed(2);
      if ([...$("compraPagamento").options].some(opcao => opcao.value === dados.pagamento)) $("compraPagamento").value = dados.pagamento;
      if (dados.textoReconhecido) $("compraObservacao").value = `Leitura da nota: ${dados.textoReconhecido}`;
      status.textContent = dados.valor > 0 ? `Leitura concluída com ${dados.confianca}% de confiança. Confira os campos.` : "A IA não encontrou o total. Preencha manualmente.";
    } catch (erro) {
      status.textContent = erro.message || "Não foi possível analisar esta foto.";
    }
  });
  $("adicionarCompraItem").addEventListener("click", () => { const item = estadoGestao.insumos.find(insumo => insumo.id === $("compraInsumo").value); itensCompraModal.push({ insumoId: item.id, nome: item.nome, unidade: item.unidade, quantidade: numeroSeguro($("compraQtd").value), valorTotal: numeroSeguro($("compraValorItem").value) }); renderCompraItens(); });
  $("formCompra").addEventListener("submit", async evento => { evento.preventDefault(); const fornecedor = estadoGestao.fornecedores.find(item => item.id === $("compraFornecedor").value); try { await registrarCompra({ fornecedorId: fornecedor?.id || "", fornecedorNome: fornecedor?.nome || "Fornecedor não informado", dataISO: $("compraData").value, pagamento: $("compraPagamento").value, statusPagamento: $("compraStatus").value, vencimento: $("compraVencimento").value, desconto: $("compraDesconto").value, totalFinal: $("compraTotalFinal").value, itens: itensCompraModal, observacao: $("compraObservacao").value }); fecharModal(); toast("Compra registrada, estoque e financeiro atualizados.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function renderCompraItens() { const subtotal = itensCompraModal.reduce((soma, item) => soma + item.valorTotal, 0); $("compraItensLista").innerHTML = itensCompraModal.map((item, indice) => `<div class="data-row"><div class="row-main"><strong>${item.quantidade} ${escapar(item.unidade)} — ${escapar(item.nome)}</strong></div><span>${formatarMoedaGestao(item.valorTotal)}</span><button class="text-btn danger" type="button" data-remove-compra="${indice}">Remover</button></div>`).join("") + `<div class="data-row"><strong>Subtotal</strong><span class="row-value">${formatarMoedaGestao(subtotal)}</span></div>`; $("compraItensLista").querySelectorAll("[data-remove-compra]").forEach(botao => botao.addEventListener("click", () => { itensCompraModal.splice(Number(botao.dataset.removeCompra), 1); renderCompraItens(); })); }

function abrirMovimentoFinanceiro() {
  abrirModal("Novo lançamento", `<form id="formMovimentoFinanceiroGestao" class="modal-form"><div class="form-grid"><label>Tipo<select id="movFinanceiroTipo"><option value="saida">Despesa</option><option value="entrada">Entrada</option></select></label><label>Descrição<input id="movFinanceiroDescricao" required></label><label>Categoria<input id="movFinanceiroCategoria" value="Outros"></label><label>Valor (R$)<input id="movFinanceiroValor" type="number" min="0.01" step="0.01" required></label><label>Pagamento<select id="movFinanceiroPagamento"><option>Pix</option><option>Dinheiro</option><option>Cartão débito</option><option>Cartão crédito</option><option>Boleto</option><option>Não informado</option></select></label><label>Data<input id="movFinanceiroData" type="date" value="${dataLojaISO()}"></label><label class="full">Observação<textarea id="movFinanceiroObs"></textarea></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Financeiro");
  $("formMovimentoFinanceiroGestao").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarMovimentoFinanceiro({ tipo: $("movFinanceiroTipo").value, descricao: $("movFinanceiroDescricao").value, categoria: $("movFinanceiroCategoria").value, valor: $("movFinanceiroValor").value, pagamento: $("movFinanceiroPagamento").value, dataISO: $("movFinanceiroData").value, observacao: $("movFinanceiroObs").value, origem: "gestao-manual" }); fecharModal(); toast("Lançamento salvo.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirCaixa() { abrirModal("Abrir caixa", `<form id="formAbrirCaixa" class="modal-form"><label>Valor inicial em dinheiro (R$)<input id="caixaValorInicial" type="number" min="0" step="0.01" value="0"></label><label>Responsável<input id="caixaResponsavel" value="${escapar(usuarioAtual?.displayName || estadoGestao.configuracaoOperacao.responsavel || "Administrador")}"></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Abrir caixa</button></div></form>`, "Caixa"); $("formAbrirCaixa").addEventListener("submit", async evento => { evento.preventDefault(); try { await abrirSessaoCaixa({ valorInicial: $("caixaValorInicial").value, responsavel: $("caixaResponsavel").value }); fecharModal(); toast("Caixa aberto.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

function abrirMovimentoCaixa() { const sessao = sessaoAberta(); abrirModal("Movimento de caixa", `<form id="formMovimentoCaixa" class="modal-form"><div class="form-grid"><label>Tipo<select id="caixaMovTipo"><option value="sangria">Sangria/retirada</option><option value="suprimento">Suprimento/entrada</option></select></label><label>Valor (R$)<input id="caixaMovValor" type="number" min="0.01" step="0.01" required></label><label class="full">Motivo<input id="caixaMovMotivo" required></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Registrar</button></div></form>`, "Caixa"); $("formMovimentoCaixa").addEventListener("submit", async evento => { evento.preventDefault(); try { await registrarMovimentoCaixa({ sessaoId: sessao.id, tipo: $("caixaMovTipo").value, valor: $("caixaMovValor").value, motivo: $("caixaMovMotivo").value }); fecharModal(); toast("Movimento registrado.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

function abrirFechamentoCaixa() { const dados = dadosCaixa(); abrirModal("Fechar caixa", `<form id="formFecharCaixa" class="modal-form"><p>Dinheiro esperado: <b>${formatarMoedaGestao(dados.esperado)}</b></p><label>Dinheiro contado na gaveta (R$)<input id="caixaValorContado" type="number" min="0" step="0.01" required></label><label>Observação<textarea id="caixaFechamentoObs"></textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Confirmar fechamento</button></div></form>`, "Conferência"); $("formFecharCaixa").addEventListener("submit", async evento => { evento.preventDefault(); try { await fecharSessaoCaixa(dados.sessao.id, { valorEsperado: dados.esperado, valorContado: $("caixaValorContado").value, observacao: $("caixaFechamentoObs").value }); fecharModal(); toast("Caixa fechado e diferença calculada.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

function abrirCliente(cliente) { abrirModal(cliente.nome || "Cliente", `<div class="modal-form"><div class="form-grid"><label>Telefone<input readonly value="${escapar(cliente.telefone || "")}"></label><label>E-mail<input readonly value="${escapar(cliente.email || "")}"></label><label class="full">Endereço<input readonly value="${escapar([cliente.endereco?.rua, cliente.endereco?.numero, cliente.endereco?.bairro, cliente.endereco?.complemento].filter(Boolean).join(", "))}"></label><label>Pedidos<input readonly value="${cliente.pedidos.length}"></label><label>Total comprado<input readonly value="${formatarMoedaGestao(cliente.total)}"></label><label class="full">Observação interna<textarea readonly>${escapar(cliente.observacaoGestao || "")}</textarea></label></div><fieldset><legend>Histórico</legend><div class="compact-list">${cliente.pedidos.map(pedido => `<div class="compact-row"><div class="row-main"><strong>${escapar(pedido.numeroExibicao)}</strong><small>${textoData(pedido.dataOperacao)} • ${infoStatus(pedido.status).nome}</small></div><span>${formatarMoedaGestao(pedido.valor)}</span></div>`).join("") || '<div class="empty-state">Nenhum pedido identificado.</div>'}</div></fieldset></div>`, "Cliente"); }

function abrirObservacaoCliente(cliente) { abrirModal("Observação do cliente", `<form id="formObservacaoCliente" class="modal-form"><p>${escapar(cliente.nome)}</p><label>Observação interna<textarea id="clienteObservacao" rows="5" placeholder="Preferências, cuidados ou informações úteis">${escapar(cliente.observacaoGestao || "")}</textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Clientes"); $("formObservacaoCliente").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarObservacaoCliente(cliente.uid, $("clienteObservacao").value); fecharModal(); toast("Observação salva.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

const permissoesLista = ["pedidos", "cozinha", "entregas", "caixa", "estoque", "compras", "financeiro", "clientes", "relatorios", "configuracoes"];
function htmlPermissoes(atuais = {}) { return `<div class="permission-grid">${permissoesLista.map(nome => `<label><input type="checkbox" data-permission-input="${nome}" ${atuais[nome] ? "checked" : ""}> ${nome[0].toUpperCase()}${nome.slice(1)}</label>`).join("")}</div>`; }
function lerPermissoesModal() { return Object.fromEntries(permissoesLista.map(nome => [nome, Boolean(document.querySelector(`[data-permission-input="${nome}"]`)?.checked)])); }
function abrirAprovacaoEquipe(item) { abrirModal(`Liberar ${item.nome || "acesso"}`, `<form id="formAprovarEquipe" class="modal-form"><label>Cargo<select id="equipeCargo"><option>Atendimento</option><option>Cozinha</option><option>Caixa</option><option>Entregador</option><option>Gerente</option></select></label><fieldset><legend>Áreas permitidas</legend>${htmlPermissoes({ pedidos: true, cozinha: true, entregas: true })}</fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Liberar acesso</button></div></form>`, "Equipe"); $("formAprovarEquipe").addEventListener("submit", async evento => { evento.preventDefault(); try { await aprovarAcessoGestao(item, { cargo: $("equipeCargo").value, permissoes: lerPermissoesModal() }); fecharModal(); toast("Acesso liberado.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }
function abrirEdicaoEquipe(item) { abrirModal(`Editar ${item.nome}`, `<form id="formEditarEquipe" class="modal-form"><label>Cargo<input id="equipeCargoEdit" value="${escapar(item.cargo || "Colaborador")}"></label><label class="toggle-row"><input id="equipeAtivoEdit" type="checkbox" ${item.ativo !== false ? "checked" : ""}><span><b>Acesso ativo</b></span></label><fieldset><legend>Áreas permitidas</legend>${htmlPermissoes(item.permissoes || {})}</fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar acesso</button></div></form>`, "Equipe"); $("formEditarEquipe").addEventListener("submit", async evento => { evento.preventDefault(); try { await atualizarMembroEquipe(item.uid, { cargo: $("equipeCargoEdit").value, ativo: $("equipeAtivoEdit").checked, permissoes: lerPermissoesModal() }); fecharModal(); toast("Acesso atualizado.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

function lidarAcao(acao) {
  const permissaoAcao = {
    "novo-pedido": "pedidos",
    "novo-insumo": "estoque",
    "nova-ficha": "estoque",
    "nova-perda": "estoque",
    "novo-fornecedor": "compras",
    "nova-compra": "compras",
    "novo-movimento": "financeiro",
    "abrir-caixa": "caixa",
    "movimento-caixa": "caixa",
    "fechar-caixa": "caixa"
  };
  if (permissaoAcao[acao] && !pode(permissaoAcao[acao])) return toast("Seu acesso não permite esta ação.", "error");
  const mapa = { "novo-pedido": abrirNovoPedido, "novo-insumo": () => abrirInsumo(), "nova-ficha": abrirFicha, "nova-perda": abrirPerda, "novo-fornecedor": () => abrirFornecedor(), "nova-compra": abrirCompra, "novo-movimento": abrirMovimentoFinanceiro, "abrir-caixa": abrirCaixa, "movimento-caixa": abrirMovimentoCaixa, "fechar-caixa": abrirFechamentoCaixa };
  mapa[acao]?.();
}

document.addEventListener("click", evento => {
  const fechar = evento.target.closest("[data-modal-close]");
  if (fechar) return fecharModal();
  const destino = evento.target.closest("[data-go]")?.dataset.go;
  if (destino) return navegar(destino);
  const acao = evento.target.closest("[data-action]")?.dataset.action;
  if (acao) lidarAcao(acao);
});

document.querySelectorAll(".nav-item").forEach(botao => botao.addEventListener("click", () => navegar(botao.dataset.page)));
$("abrirMenuGestao").addEventListener("click", () => document.body.classList.add("menu-open"));
$("fecharMenuGestao").addEventListener("click", () => document.body.classList.remove("menu-open"));
$("gestaoBackdrop").addEventListener("click", () => document.body.classList.remove("menu-open"));
$("sairGestao").addEventListener("click", () => signOut(auth));
$("usuarioGestaoBotao").addEventListener("click", () => {
  abrirModal("Conta atual", `<div class="modal-form"><div class="customer-head"><span class="customer-avatar">${iniciais(usuarioAtual?.displayName || usuarioAtual?.email)}</span><div><strong>${escapar(usuarioAtual?.displayName || "Usuário")}</strong><p>${escapar(usuarioAtual?.email || "")}</p></div></div><p>${isAdmin ? "Administrador principal" : escapar(membroAtual?.cargo || "Colaborador")}</p><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Voltar</button><button id="sairContaModal" type="button">Sair da conta</button></div></div>`, "Acesso seguro");
  $("sairContaModal").addEventListener("click", () => signOut(auth));
});
$("acaoRapida").addEventListener("click", () => lidarAcao(paginaAtual === "estoque" ? "novo-insumo" : paginaAtual === "compras" ? "nova-compra" : paginaAtual === "financeiro" ? "novo-movimento" : "novo-pedido"));
[["buscaPedidos", renderPedidos], ["filtroOrigemPedidos", renderPedidos], ["filtroStatusPedidos", renderPedidos], ["buscaBalcao", renderBalcao], ["buscaEncomendas", renderEncomendas], ["filtroEncomendas", renderEncomendas], ["buscaFinanceiro", renderFinanceiro], ["buscaClientes", renderClientes]].forEach(([id, funcao]) => $(id)?.addEventListener(id.startsWith("busca") ? "input" : "change", funcao));
$("descontoBalcao").addEventListener("input", renderCarrinhoBalcao);
$("pagamentoBalcao").addEventListener("change", () => { $("pagamentosMistosBalcao").hidden = $("pagamentoBalcao").value !== "Pagamento misto"; atualizarSomaMistaBalcao(); });
document.querySelectorAll("#pagamentosMistosBalcao [data-pay]").forEach(campo => campo.addEventListener("input", atualizarSomaMistaBalcao));
$("limparVendaBalcao").addEventListener("click", () => { carrinhoBalcao = []; renderBalcao(); });
$("finalizarVendaBalcao").addEventListener("click", finalizarBalcao);
document.querySelectorAll("[data-delivery-filter]").forEach(botao => botao.addEventListener("click", () => { filtroEntregaAtual = botao.dataset.deliveryFilter; document.querySelectorAll("[data-delivery-filter]").forEach(item => item.classList.toggle("active", item === botao)); renderEntregas(); }));
document.querySelectorAll("[data-stock-tab]").forEach(botao => botao.addEventListener("click", () => { abaEstoqueAtual = botao.dataset.stockTab; renderEstoque(); }));
$("dataCardapioGestao").value = dataLojaISO();
$("dataCardapioGestao").addEventListener("change", renderCardapio);
$("selecionarTodosCardapio").addEventListener("click", () => document.querySelectorAll("#produtosCardapioGestao input").forEach(campo => { campo.checked = true; }));
$("salvarCardapioGestao").addEventListener("click", async () => { const produtoIds = [...document.querySelectorAll("#produtosCardapioGestao input:checked")].map(campo => campo.value); if ($("publicarCardapioGestao").checked && !produtoIds.length) return toast("Escolha pelo menos um produto ou desative a publicação.", "error"); try { await salvarCardapioDia({ dataISO: $("dataCardapioGestao").value, produtoIds, publicado: $("publicarCardapioGestao").checked, observacao: $("observacaoCardapioGestao").value }); toast("Cardápio atualizado no site.", "success"); } catch (erro) { toast(erro.message, "error"); } });
const periodo = periodoPadrao();
[["financeiroInicio", periodo.inicio], ["financeiroFim", periodo.fim], ["relatorioInicio", periodo.inicio], ["relatorioFim", periodo.fim]].forEach(([id, valor]) => { $(id).value = valor; });
$("aplicarPeriodoFinanceiro").addEventListener("click", renderFinanceiro);
$("gerarRelatorioGestao").addEventListener("click", renderRelatorios);
$("formConfiguracaoOperacao").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarConfiguracaoOperacao({ metaDiaria: numeroSeguro($("configMetaDiaria").value), tempoPreparo: numeroSeguro($("configTempoPreparo").value), limitePedidos: numeroSeguro($("configLimitePedidos").value), responsavel: $("configResponsavel").value, somPedidos: $("configSomPedidos").checked, baixaEstoque: $("configBaixaEstoque").checked }); toast("Preferências salvas.", "success"); } catch (erro) { toast(erro.message, "error"); } });
window.addEventListener("online", () => { $("conexaoGestao").classList.remove("offline"); $("conexaoGestao").lastChild.textContent = " Sincronizado"; renderTudo(); });
window.addEventListener("offline", () => { $("conexaoGestao").classList.add("offline"); $("conexaoGestao").lastChild.textContent = " Sem conexão"; });
window.addEventListener("keydown", evento => { if (evento.key === "Escape" && !$("gestaoModal").hidden) fecharModal(); });
window.setInterval(() => { $("relogioGestao").textContent = horaLoja(); $("dataGestao").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }).format(new Date()); }, 1000);
onAuthStateChanged(auth, processarUsuario);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js", { scope: "/" }).catch(() => {});
