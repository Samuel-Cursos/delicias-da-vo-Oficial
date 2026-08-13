import {
  auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  db, doc, getDoc, updateDoc, serverTimestamp
} from "../../js/core/firebase.js";
import { APP_CONFIG } from "../../js/core/config.js";
import { registrarVendaRapida } from "../../js/services/salesService.js";
import { salvarMovimentoFinanceiro, salvarCustoProduto, salvarFechamentoFinanceiro } from "../../js/services/financeService.js";
import { lerRegistroComIA } from "../../js/services/documentAiService.js";
import { gerarBackupCompleto, baixarBackupJson, restaurarBackupCompleto } from "../../js/services/backupService.js";
import {
  estadoGestao, limparEstadoGestao, iniciarObservadoresGestao, atualizarStatusPedidoGestao,
  salvarPedidoManual, atualizarPedidoManualGestao, salvarCardapioDia, salvarInsumo, movimentarInsumo,
  registrarPerda, salvarFichaTecnica, salvarFornecedor, registrarCompra,
  marcarCompraComoPaga,
  abrirSessaoCaixa, registrarMovimentoCaixa, fecharSessaoCaixa,
  salvarObservacaoCliente, salvarConfiguracaoOperacao, solicitarAcessoGestao,
  aprovarAcessoGestao, atualizarMembroEquipe, criarConviteEquipe,
  cancelarConviteEquipe, buscarConviteEquipe, ativarConviteEquipe
} from "../../js/services/managementService.js";
import {
  dataLojaISO, horaLoja, numeroSeguro, formatarMoedaGestao, infoStatus, statusFinal,
  consolidarPedidosGestao, gerarNecessidadesProducao, calcularAlertasEstoque,
  calcularResumoOperacao, resumirPagamentos, calcularRelatorioGestao,
  avaliarPrazoPedido, consolidarClientesGestao, avaliarJanelaEncomenda,
  filtrarPedidosOperacionais
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
  backup: ["Segurança dos dados", "Backup", "Baixe ou restaure todos os dados da loja."],
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
let arquivoBackupPendente = null;
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

function telefoneWhatsApp(valor = "") {
  let numero = String(valor || "").replace(/\D/g, "");
  if (numero.length >= 10 && numero.length <= 11) numero = `55${numero}`;
  return numero.length >= 12 ? numero : "";
}

function enderecoPedido(pedido = {}) {
  return pedido.endereco || [pedido.enderecoDetalhado?.rua, pedido.enderecoDetalhado?.numero, pedido.enderecoDetalhado?.bairro, pedido.enderecoDetalhado?.complemento].filter(Boolean).join(", ");
}

function classePrazo(prazo = {}) {
  return prazo.atrasado ? "late" : prazo.proximoDoLimite ? "attention" : "";
}

function imprimirPedido(pedido) {
  const janela = window.open("", "_blank", "width=520,height=760");
  if (!janela) return toast("O navegador bloqueou a impressão. Libere pop-ups e tente novamente.", "error");
  const endereco = enderecoPedido(pedido);
  const itens = (pedido.itens || []).map(item => `<li><b>${numeroSeguro(item.quantidade)}× ${escapar(item.nome)}</b>${item.sabor ? ` — ${escapar(item.sabor)}` : ""}${item.observacao ? `<small>Obs.: ${escapar(item.observacao)}</small>` : ""}</li>`).join("");
  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(pedido.numeroExibicao)}</title><style>body{font:16px/1.35 Arial,sans-serif;color:#111;margin:24px}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;border-block:2px dashed #111;padding:12px 0}p{margin:5px 0}ul{padding-left:22px}li{margin:10px 0}small{display:block;font-size:13px}.total{font-size:22px;font-weight:800;text-align:right;border-top:2px solid;padding-top:10px}.obs{border:2px solid;padding:10px;margin-top:12px}@media print{body{margin:0}.no-print{display:none}}</style></head><body><h1>Delícias da Vó</h1><p>${escapar(pedido.numeroExibicao)} • ${escapar(pedido.origemNome)}</p><h2>${escapar(pedido.clienteNome)}</h2><p><b>Atendimento:</b> ${escapar(pedido.tipoAtendimento)}</p><p><b>Horário:</b> ${escapar(pedido.horaOperacao || "Não informado")}</p>${endereco ? `<p><b>Endereço:</b> ${escapar(endereco)}</p>` : ""}<ul>${itens || "<li>Itens não informados</li>"}</ul>${pedido.observacao || pedido.observacoes ? `<div class="obs"><b>OBSERVAÇÃO</b><br>${escapar(pedido.observacao || pedido.observacoes)}</div>` : ""}<p class="total">${formatarMoedaGestao(pedido.valor)}</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)}<\/script></body></html>`);
  janela.document.close();
}

function pedidosConsolidados() {
  return consolidarPedidosGestao({
    site: estadoGestao.pedidosSite.filter(item => String(item.caminho || "").startsWith("pedidosSite/")),
    manuais: estadoGestao.pedidosManuais,
    encomendas: estadoGestao.encomendas
  });
}

function diasAntecedenciaEncomendas() {
  const configurado = numeroSeguro(estadoGestao.configuracaoOperacao.diasAntecedenciaEncomendas);
  return configurado >= 0 && estadoGestao.configuracaoOperacao.diasAntecedenciaEncomendas !== undefined ? Math.min(90, Math.round(configurado)) : 7;
}

function pedidosOperacionais() {
  return filtrarPedidosOperacionais(pedidosConsolidados(), diasAntecedenciaEncomendas(), dataLojaISO());
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
  if ($("editarSiteGestaoLink")) $("editarSiteGestaoLink").hidden = !(isAdmin || pode("site"));
}

function liberarSistema(user) {
  $("gestaoLogin").hidden = true;
  $("gestaoApp").hidden = false;
  $("usuarioGestaoIniciais").textContent = iniciais(user.displayName || user.email);
  $("alertaPermissao").hidden = isAdmin;
  if (!isAdmin) $("alertaPermissao").textContent = `Acesso de ${membroAtual?.cargo || "colaborador"}: o menu mostra somente as áreas liberadas pelo administrador.`;
  atualizarNavegacaoPermitida();
  $("digitalizarVendaGestao").hidden = !isAdmin;
  $("fecharMesGestao").hidden = !(isAdmin || pode("financeiro"));
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
      const convite = await buscarConviteEquipe(user).catch(() => null);
      if (convite?.ativo === true && convite.status === "pendente") {
        try {
          membroAtual = await ativarConviteEquipe(user);
          toast("Convite aceito. Seu acesso à equipe foi liberado.", "success");
        } catch (erro) {
          console.error("Não foi possível ativar o convite da equipe:", erro);
        }
      }
    }
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
  const acoesRapidas = {
    dashboard: ["＋ Novo pedido", "pedidos"], pedidos: ["＋ Novo pedido", "pedidos"], cozinha: ["＋ Novo pedido", "pedidos"],
    balcao: ["＋ Novo pedido", "pedidos"], entregas: ["＋ Novo pedido", "pedidos"], encomendas: ["＋ Novo pedido", "pedidos"],
    estoque: ["＋ Novo insumo", "estoque"], compras: ["＋ Registrar compra", "compras"], financeiro: ["＋ Lançamento", "financeiro"]
  };
  const acaoPagina = acoesRapidas[pagina];
  $("acaoRapida").hidden = !acaoPagina || !pode(acaoPagina[1]);
  if (acaoPagina) $("acaoRapida").textContent = acaoPagina[0];
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderPagina(pagina);
}

function proximoStatus(pedido) {
  if (["registrado", "aguardando_confirmacao"].includes(pedido.status)) return ["confirmado", "Confirmar pedido"];
  const janela = avaliarJanelaEncomenda(pedido, diasAntecedenciaEncomendas(), dataLojaISO());
  if (pedido.origemTipo === "festa" && !janela.preparoLiberado) return ["", ""];
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
  const prazo = avaliarPrazoPedido(pedido, estadoGestao.configuracaoOperacao.tempoPreparo);
  return `<article class="order-card ${["registrado", "aguardando_confirmacao"].includes(pedido.status) ? "new-order" : ""}" data-order="${escapar(pedido.chave)}">
    <div class="order-identification"><div class="order-code"><span class="origin-pill">${escapar(pedido.origemNome)}</span><span class="status-pill ${status.classe}">${status.nome}</span><span class="timer-pill ${classePrazo(prazo)}">${escapar(prazo.texto)}</span></div><h3>${escapar(pedido.numeroExibicao)}</h3><p><b>${escapar(pedido.clienteNome)}</b>${pedido.clienteTelefone ? ` • ${escapar(pedido.clienteTelefone)}` : ""}</p><div class="order-meta"><span class="soft-pill">${escapar(pedido.tipoAtendimento)}</span><span class="soft-pill">${escapar(pedido.horaOperacao || "Sem horário")}</span><span class="soft-pill">${formatarMoedaGestao(pedido.valor)}</span></div></div>
    <div class="order-items">${htmlItens(pedido)}${pedido.observacao || pedido.observacoes ? `<p class="note">${escapar(pedido.observacao || pedido.observacoes)}</p>` : ""}</div>
    <div class="order-actions"><select data-order-status>${["registrado", "confirmado", "producao", "pronto", "saiu_entrega", "entregue", "cancelado"].map(valor => `<option value="${valor}" ${pedido.status === valor ? "selected" : ""}>${infoStatus(valor).nome}</option>`).join("")}</select>${proximo ? `<button class="main-action" data-next="${proximo}">${acao}</button>` : ""}<button class="cancel-action" data-detail>Ver detalhes</button></div>
  </article>`;
}

function renderDashboard() {
  const pedidos = pedidosConsolidados();
  const operacionais = pedidosOperacionais();
  const antecedencia = diasAntecedenciaEncomendas();
  const resumo = calcularResumoOperacao({ pedidos, vendas: estadoGestao.vendas, movimentos: estadoGestao.movimentosFinanceiros, produtos: estadoGestao.produtos, insumos: estadoGestao.insumos, diasAntecedenciaEncomendas: antecedencia });
  $("kpiPedidosHoje").textContent = resumo.pedidosHoje;
  $("kpiPedidosAbertos").textContent = `${resumo.pedidosAbertos} em aberto`;
  $("kpiProducao").textContent = resumo.emProducao;
  $("kpiProntos").textContent = resumo.prontos;
  $("kpiEntregas").textContent = resumo.entregasPendentes;
  $("kpiReceita").textContent = formatarMoedaGestao(resumo.receita);
  $("kpiSaldo").textContent = `Saldo ${formatarMoedaGestao(resumo.saldo)}`;
  $("kpiEstoque").textContent = resumo.alertasEstoque;
  $("resumoDiaTexto").textContent = resumo.pedidosAbertos
    ? `${resumo.pedidosAbertos} pedido(s) ainda precisam avançar na operação.`
    : resumo.encomendasAgendadas
      ? `Operação livre agora. ${resumo.encomendasAgendadas} encomenda(s) futura(s) estão guardadas na agenda.`
      : "Nenhuma pendência crítica por enquanto.";

  const meta = numeroSeguro(estadoGestao.configuracaoOperacao.metaDiaria);
  const progressoMeta = meta > 0 ? Math.max(0, Math.min(100, (resumo.receita / meta) * 100)) : 0;
  $("metaDiariaTitulo").textContent = meta > 0 ? `${formatarMoedaGestao(resumo.receita)} de ${formatarMoedaGestao(meta)}` : "Configure uma meta";
  $("metaDiariaPercentual").textContent = meta > 0 ? `${Math.round(progressoMeta)}%` : "—";
  $("metaDiariaTexto").textContent = meta > 0 ? (resumo.receita >= meta ? "Meta alcançada. Excelente resultado hoje." : `Faltam ${formatarMoedaGestao(meta - resumo.receita)} para alcançar a meta.`) : "Defina a meta diária em Configurações para acompanhar o progresso.";
  $("metaDiariaBarra").style.width = `${progressoMeta}%`;
  $("metaDiariaCard").classList.toggle("goal-complete", meta > 0 && resumo.receita >= meta);

  const limite = Math.max(1, numeroSeguro(estadoGestao.configuracaoOperacao.limitePedidos) || 25);
  const progressoCapacidade = Math.max(0, Math.min(100, (resumo.pedidosAbertos / limite) * 100));
  $("capacidadePedidosPercentual").textContent = `${Math.round(progressoCapacidade)}%`;
  $("capacidadePedidosTitulo").textContent = `${resumo.pedidosAbertos} de ${limite} pedidos em aberto`;
  $("capacidadePedidosTexto").textContent = resumo.pedidosAbertos >= limite ? "Limite configurado atingido. Priorize a fila antes de aceitar novos pedidos." : resumo.pedidosAbertos >= limite * .75 ? "A operação está próxima do limite configurado." : "A operação está dentro da capacidade configurada.";
  $("capacidadePedidosBarra").style.width = `${progressoCapacidade}%`;
  $("capacidadePedidosCard").classList.toggle("capacity-warning", resumo.pedidosAbertos >= limite * .75);
  $("capacidadePedidosCard").classList.toggle("capacity-full", resumo.pedidosAbertos >= limite);

  const abertos = operacionais.filter(pedido => !statusFinal(pedido.status)).slice(0, 5);
  $("dashboardPedidos").className = `compact-list ${abertos.length ? "" : "empty-state"}`;
  $("dashboardPedidos").innerHTML = abertos.length ? abertos.map(pedido => `<div class="compact-row"><span class="status-pill ${infoStatus(pedido.status).classe}">${infoStatus(pedido.status).nome}</span><div class="row-main"><strong>${escapar(pedido.numeroExibicao)} — ${escapar(pedido.clienteNome)}</strong><small>${pedido.itens.map(item => `${item.quantidade}× ${item.nome}`).join(" • ")}</small></div><span class="row-value">${formatarMoedaGestao(pedido.valor)}</span></div>`).join("") : "Nenhum pedido aguardando.";

  const necessidades = gerarNecessidadesProducao(operacionais).slice(0, 8);
  $("dashboardProducao").className = `production-summary ${necessidades.length ? "" : "empty-state"}`;
  $("dashboardProducao").innerHTML = necessidades.length ? necessidades.map(item => `<div class="need-chip"><strong>${item.quantidade}</strong><span>${escapar(item.nome)}${item.detalhe ? ` — ${escapar(item.detalhe)}` : ""}</span></div>`).join("") : "Nada na fila.";

  const alertas = calcularAlertasEstoque(estadoGestao.produtos, estadoGestao.insumos).slice(0, 6);
  $("dashboardEstoque").className = `compact-list ${alertas.length ? "" : "empty-state"}`;
  $("dashboardEstoque").innerHTML = alertas.length ? alertas.map(item => `<div class="compact-row"><div class="row-main"><strong>${escapar(item.nome)}</strong><small>Mínimo: ${item.minimo} ${escapar(item.unidade || "un")}</small></div><span class="stock-low">${item.quantidade} ${escapar(item.unidade || "un")}</span></div>`).join("") : "Estoque tranquilo.";

  const hoje = dataLojaISO();
  const encomendas = pedidos.filter(item => item.origemTipo === "festa" && item.dataOperacao >= hoje && !statusFinal(item.status)).sort((a, b) => a.dataOperacao.localeCompare(b.dataOperacao)).slice(0, 5);
  $("dashboardEncomendas").className = `compact-list ${encomendas.length ? "" : "empty-state"}`;
  $("dashboardEncomendas").innerHTML = encomendas.length ? encomendas.map(item => { const janela = avaliarJanelaEncomenda(item, antecedencia, hoje); return `<div class="compact-row"><span class="appointment-date">${textoData(item.dataOperacao)}</span><div class="row-main"><strong>${escapar(item.clienteNome)} — ${escapar(item.numeroExibicao)}</strong><small>${item.itens.map(produto => `${produto.quantidade}× ${produto.nome}`).join(" • ")}</small><span class="schedule-window ${janela.preparoLiberado ? "available" : ""}">${escapar(janela.texto)}</span></div><span class="row-value">${formatarMoedaGestao(item.valor)}</span></div>`; }).join("") : "Nenhuma encomenda próxima.";
}

function renderPedidos() {
  const termo = String($("buscaPedidos")?.value || "").toLowerCase();
  const origem = $("filtroOrigemPedidos")?.value || "todos";
  const statusFiltro = $("filtroStatusPedidos")?.value || "abertos";
  const todos = pedidosOperacionais();
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
  const janela = avaliarJanelaEncomenda(pedido, diasAntecedenciaEncomendas(), dataLojaISO());
  if (pedido.origemTipo === "festa" && status === "producao" && !janela.preparoLiberado) {
    return toast(`O preparo desta encomenda será liberado em ${textoData(janela.dataLiberacao)}.`, "error");
  }
  if (["cancelado", "cancelada"].includes(status) && !["cancelado", "cancelada"].includes(pedido.status)) {
    if (!confirm(`Cancelar ${pedido.numeroExibicao}? O histórico será mantido e o estoque já baixado será devolvido.`)) return;
  }
  try {
    await atualizarStatusPedidoGestao(pedido, status);
    toast(`Pedido ${pedido.numeroExibicao} atualizado para ${infoStatus(status).nome}.`, "success");
  } catch (erro) { toast(erro.message || "Não foi possível atualizar o pedido.", "error"); }
}

function abrirDetalhesPedido(pedido) {
  const endereco = enderecoPedido(pedido);
  const whatsapp = telefoneWhatsApp(pedido.clienteTelefone);
  const podeEditar = pedido.origemTipo === "manual" && ["registrado", "aguardando_confirmacao"].includes(pedido.status) && !pedido.estoqueBaixado;
  abrirModal(`Pedido ${pedido.numeroExibicao}`, `<div class="modal-form"><div class="form-grid"><label>Cliente<input readonly value="${escapar(pedido.clienteNome)}"></label><label>Telefone<input readonly value="${escapar(pedido.clienteTelefone)}"></label><label>Origem<input readonly value="${escapar(pedido.origemNome)}"></label><label>Pagamento<input readonly value="${escapar(pedido.pagamento || "Não informado")}"></label><label class="full">Endereço<textarea readonly rows="2">${escapar(endereco || "Retirada na loja")}</textarea></label></div><fieldset><legend>Itens</legend>${htmlItens(pedido, 100)}</fieldset><div class="form-grid"><label>Subtotal<input readonly value="${formatarMoedaGestao(pedido.subtotalProdutos || pedido.valor - numeroSeguro(pedido.taxaEntrega))}"></label><label>Taxa de entrega<input readonly value="${pedido.taxaEntrega == null ? "A confirmar" : formatarMoedaGestao(pedido.taxaEntrega)}"></label><label>Distância<input readonly value="${pedido.distanciaEntregaKm == null ? "Não calculada" : `${pedido.distanciaEntregaKm} km`}"></label><label>Total<input readonly value="${formatarMoedaGestao(pedido.valor)}"></label><label class="full">Observações<textarea readonly rows="3">${escapar(pedido.observacao || pedido.observacoes || "")}</textarea></label></div><div class="modal-actions order-detail-actions">${podeEditar ? '<button id="editarPedidoManualGestao" class="cancel" type="button">Editar pedido</button>' : ""}<button id="imprimirPedidoGestao" class="cancel" type="button">Imprimir cozinha</button>${endereco && pedido.tipoAtendimento === "Entrega" ? `<a class="secondary-btn link-button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}" target="_blank" rel="noopener">Abrir Maps</a>` : ""}${whatsapp ? `<a class="primary-btn link-button" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Estamos falando sobre o pedido ${pedido.numeroExibicao} da Delícias da Vó.`)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div></div>`, pedido.origemNome);
  $("imprimirPedidoGestao")?.addEventListener("click", () => imprimirPedido(pedido));
  $("editarPedidoManualGestao")?.addEventListener("click", () => abrirEdicaoPedidoManual(pedido));
}

function renderCozinha() {
  const pedidos = pedidosOperacionais();
  const necessidades = gerarNecessidadesProducao(pedidos);
  $("necessidadesCozinha").innerHTML = necessidades.length ? necessidades.map(item => `<div class="need-chip"><strong>${item.quantidade}</strong><span>${escapar(item.nome)}${item.detalhe ? ` — ${escapar(item.detalhe)}` : ""}</span></div>`).join("") : '<div class="empty-state">Nada para preparar agora.</div>';
  const grupos = { confirmado: pedidos.filter(item => item.status === "confirmado"), producao: pedidos.filter(item => item.status === "producao"), pronto: pedidos.filter(item => item.status === "pronto") };
  [["cozinhaConfirmados", "confirmado"], ["cozinhaProducao", "producao"], ["cozinhaProntos", "pronto"]].forEach(([id, status]) => {
    const container = $(id);
    container.innerHTML = grupos[status].length ? grupos[status].map(pedido => { const prazo = avaliarPrazoPedido(pedido, estadoGestao.configuracaoOperacao.tempoPreparo); return `<article class="kitchen-card ${prazo.atrasado ? "late-order" : ""}" data-kitchen="${escapar(pedido.chave)}"><div class="kitchen-card-head"><h4>${escapar(pedido.numeroExibicao)} — ${escapar(pedido.clienteNome)}</h4><span class="timer-pill ${classePrazo(prazo)}">${escapar(prazo.texto)}</span></div><p>${escapar(pedido.horaOperacao || "Sem horário")} • ${escapar(pedido.tipoAtendimento)}</p>${htmlItens(pedido, 100)}${pedido.observacao || pedido.observacoes ? `<div class="note">${escapar(pedido.observacao || pedido.observacoes)}</div>` : ""}<button data-kitchen-next="${proximoStatus(pedido)[0]}">${proximoStatus(pedido)[1]}</button></article>`; }).join("") : '<div class="empty-state">Nenhum pedido.</div>';
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
  if ($("tituloCardapioGestao")) $("tituloCardapioGestao").value = registro?.titulo || "Cardápio de hoje";
  if ($("itensTextoCardapioGestao")) $("itensTextoCardapioGestao").value = Array.isArray(registro?.itens) ? registro.itens.join("\n") : "";
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

function abrirDigitalizacaoVenda() {
  if (!isAdmin) return toast("A leitura inteligente está liberada somente ao administrador.", "error");
  abrirModal("Ler venda manuscrita", `<form id="formVendaDigitalizada" class="modal-form"><fieldset class="smart-scan"><legend>📷 Foto da anotação</legend><p>Tire uma foto próxima e nítida. Não precisa recortar: a IA lê letra cursiva, valor e pagamento; você sempre confere antes de salvar.</p><label class="scan-upload">Tirar ou escolher foto<input id="vendaDigitalizadaArquivo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label><img id="vendaDigitalizadaPreview" class="scan-preview" alt="Prévia da anotação" hidden><small id="vendaDigitalizadaStatus">Você também pode preencher os campos manualmente.</small></fieldset><div class="form-grid"><label>Valor total (R$)<input id="vendaDigitalizadaValor" type="number" min="0.01" step="0.01" required></label><label>Pagamento<select id="vendaDigitalizadaPagamento"><option>Pix</option><option>Dinheiro</option><option>Cartão débito</option><option>Cartão crédito</option><option>Pagamento misto</option><option>Não informado</option></select></label></div><div id="vendaDigitalizadaMistos" class="mixed-box" hidden><label>Pix<input data-scan-pay="Pix" type="number" min="0" step="0.01"></label><label>Dinheiro<input data-scan-pay="Dinheiro" type="number" min="0" step="0.01"></label><label>Débito<input data-scan-pay="Cartão débito" type="number" min="0" step="0.01"></label><label>Crédito<input data-scan-pay="Cartão crédito" type="number" min="0" step="0.01"></label><small id="vendaDigitalizadaSoma">Soma: R$ 0,00</small></div><label>Texto reconhecido / observação<textarea id="vendaDigitalizadaTexto" rows="4" placeholder="O que estava escrito na anotação"></textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Confirmar venda</button></div></form>`, "Balcão e caixa");

  const atualizarMistos = () => {
    const misto = $("vendaDigitalizadaPagamento").value === "Pagamento misto";
    $("vendaDigitalizadaMistos").hidden = !misto;
    const soma = [...document.querySelectorAll("[data-scan-pay]")].reduce((total, campo) => total + numeroSeguro(campo.value), 0);
    $("vendaDigitalizadaSoma").textContent = `Soma: ${formatarMoedaGestao(soma)}`;
  };
  $("vendaDigitalizadaPagamento").addEventListener("change", atualizarMistos);
  document.querySelectorAll("[data-scan-pay]").forEach(campo => campo.addEventListener("input", atualizarMistos));

  $("vendaDigitalizadaArquivo").addEventListener("change", async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    const status = $("vendaDigitalizadaStatus");
    status.textContent = "Preparando e lendo a foto…";
    try {
      const imagem = await prepararImagemParaIA(arquivo);
      $("vendaDigitalizadaPreview").src = imagem;
      $("vendaDigitalizadaPreview").hidden = false;
      const dados = await lerRegistroComIA(imagem, "venda");
      if (dados.valor > 0) $("vendaDigitalizadaValor").value = dados.valor.toFixed(2);
      if ([...$("vendaDigitalizadaPagamento").options].some(opcao => opcao.value === dados.pagamento)) $("vendaDigitalizadaPagamento").value = dados.pagamento;
      document.querySelectorAll("[data-scan-pay]").forEach(campo => { campo.value = ""; });
      (dados.pagamentos || []).forEach(item => { const campo = [...document.querySelectorAll("[data-scan-pay]")].find(entrada => entrada.dataset.scanPay === item.tipo); if (campo) campo.value = numeroSeguro(item.valor).toFixed(2); });
      $("vendaDigitalizadaTexto").value = [dados.textoReconhecido, dados.observacao, dados.desconto > 0 ? `Desconto identificado: ${formatarMoedaGestao(dados.desconto)}` : ""].filter(Boolean).join(" • ");
      atualizarMistos();
      status.textContent = dados.valor > 0 ? `Leitura concluída com ${dados.confianca}% de confiança. Confira os campos.` : "A IA não encontrou o total. Preencha o valor manualmente.";
    } catch (erro) {
      status.textContent = `${erro.message || "Não foi possível ler a foto."} Você pode preencher os campos manualmente.`;
    }
  });

  $("formVendaDigitalizada").addEventListener("submit", async evento => {
    evento.preventDefault();
    const total = numeroSeguro($("vendaDigitalizadaValor").value);
    const pagamento = $("vendaDigitalizadaPagamento").value;
    const pagamentos = pagamento === "Pagamento misto" ? [...document.querySelectorAll("[data-scan-pay]")].map(campo => ({ tipo: campo.dataset.scanPay, valor: numeroSeguro(campo.value) })).filter(item => item.valor > 0) : [{ tipo: pagamento, valor: total }];
    try {
      await registrarVendaRapida({ total, pagamento, pagamentos, permitirSemItens: true, origem: "gestao-digitalizacao", observacao: $("vendaDigitalizadaTexto").value || "Venda lida de anotação manuscrita" });
      fecharModal();
      toast("Venda digitalizada e registrada no caixa.", "success");
    } catch (erro) { toast(erro.message || "Não foi possível registrar a venda.", "error"); }
  });
}

function renderEntregas() {
  const pedidos = pedidosOperacionais().filter(item => item.tipoAtendimento === "Entrega");
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
  const antecedencia = diasAntecedenciaEncomendas();
  const lista = pedidosConsolidados()
    .filter(item => item.origemTipo === "festa")
    .filter(item => `${item.numeroExibicao} ${item.clienteNome}`.toLowerCase().includes(termo))
    .filter(item => {
      const janela = avaliarJanelaEncomenda(item, antecedencia, hoje);
      if (filtro === "todas") return true;
      if (filtro === "abertas") return item.dataOperacao >= hoje && !statusFinal(item.status);
      if (filtro === "preparo") return !statusFinal(item.status) && janela.preparoLiberado;
      if (filtro === "agendadas") return item.dataOperacao >= hoje && !statusFinal(item.status) && !janela.preparoLiberado;
      return item.status === filtro || (filtro === "cancelado" && item.status === "cancelada");
    })
    .sort((a, b) => String(a.dataOperacao || "9999-12-31").localeCompare(String(b.dataOperacao || "9999-12-31")));
  $("listaEncomendasGestao").innerHTML = lista.length ? lista.map(pedido => {
    const janela = avaliarJanelaEncomenda(pedido, antecedencia, hoje);
    const [proximo, acao] = proximoStatus(pedido);
    const classeJanela = janela.preparoJaIniciado && pedido.dataOperacao > hoje ? "early" : janela.preparoLiberado ? "available" : "";
    const detalheLiberacao = !janela.preparoLiberado && janela.dataLiberacao ? ` • entra na operação em ${textoData(janela.dataLiberacao)}` : "";
    return `<article class="appointment-card ${janela.preparoLiberado ? "" : "future-appointment"}" data-appointment="${pedido.id}"><span class="appointment-date">${textoData(pedido.dataOperacao)}</span><span class="status-pill ${infoStatus(pedido.status).classe}">${infoStatus(pedido.status).nome}</span><h3>${escapar(pedido.clienteNome)} — ${escapar(pedido.numeroExibicao)}</h3><p>${pedido.itens.map(item => `${numeroSeguro(item.quantidade)}× ${escapar(item.nome)}`).join(" • ")}</p><p><b>${formatarMoedaGestao(pedido.valor)}</b> • ${escapar(pedido.tipoAtendimento)}</p><span class="schedule-window ${classeJanela}">${escapar(janela.texto)}${detalheLiberacao}</span><div class="card-actions"><button class="map-action" type="button" data-detail>Detalhes</button>${proximo ? `<button class="status-action" type="button" data-next="${proximo}">${acao}</button>` : ""}</div></article>`;
  }).join("") : '<div class="surface empty-state">Nenhuma encomenda encontrada.</div>';
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
    container.innerHTML = `<div class="stock-table"><div class="stock-row header"><span>Produto</span><span>Disponível</span><span>Custo unit.</span><span>Preço</span><span>Status</span><span>Ação</span></div>${todasOpcoesProdutos().map(item => { const custo = estadoGestao.custosProdutos.find(registro => registro.id === item.id || registro.produtoId === item.id); return `<div class="stock-row"><div><strong>${escapar(item.nome)}</strong><small>Produto pronto</small></div><span class="${!item.sobEncomenda && item.estoque <= 0 ? "stock-low" : ""}">${item.sobEncomenda ? "Sob encomenda" : `${item.estoque} un`}</span><span>${formatarMoedaGestao(custo?.custoUnitario || 0)}</span><span>${formatarMoedaGestao(item.preco)}</span><span>${item.sobEncomenda || item.estoque > 0 ? "Disponível" : "Esgotado"}</span><span>${isAdmin || pode("financeiro") ? `<button class="text-btn" data-product-cost="${escapar(item.id)}">Editar custo</button>` : "—"}</span></div>`; }).join("")}</div>`;
    container.querySelectorAll("[data-product-cost]").forEach(botao => botao.addEventListener("click", () => abrirCustoProduto(estadoGestao.produtos.find(item => item.id === botao.dataset.productCost))));
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
  $("listaComprasGestao").innerHTML = estadoGestao.compras.length ? estadoGestao.compras.map(item => { const vencida = item.statusPagamento === "pendente" && item.vencimento && item.vencimento < dataLojaISO(); return `<div class="data-row payable-row ${vencida ? "overdue" : ""}"><div class="row-main"><strong>${escapar(item.fornecedorNome)}</strong><small>${textoData(item.dataISO)} • ${(item.itens || []).length} item(ns) • ${escapar(item.pagamento)}${item.statusPagamento === "pendente" && item.vencimento ? ` • vence ${textoData(item.vencimento)}` : ""}</small></div><span class="status-pill ${item.statusPagamento === "pendente" ? "novo" : "concluido"}">${vencida ? "Vencida" : item.statusPagamento === "pendente" ? "Pendente" : "Pago"}</span><span class="row-value">${formatarMoedaGestao(item.totalFinal)}</span>${item.statusPagamento === "pendente" ? `<button class="text-btn" data-pay-purchase="${item.id}">Marcar paga</button>` : ""}</div>`; }).join("") : '<div class="empty-state">Nenhuma compra registrada.</div>';
  $("listaComprasGestao").querySelectorAll("[data-pay-purchase]").forEach(botao => botao.addEventListener("click", async () => {
    const compra = estadoGestao.compras.find(item => item.id === botao.dataset.payPurchase);
    if (!compra || !confirm(`Confirmar o pagamento de ${formatarMoedaGestao(compra.totalFinal)} para ${compra.fornecedorNome}?`)) return;
    botao.disabled = true;
    try { await marcarCompraComoPaga(compra); toast("Compra marcada como paga.", "success"); }
    catch (erro) { botao.disabled = false; toast(erro.message || "Não foi possível confirmar o pagamento.", "error"); }
  }));
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
  return consolidarClientesGestao({ usuarios: estadoGestao.usuarios, pedidos: pedidosConsolidados() });
}

function renderClientes() {
  const termo = String($("buscaClientes")?.value || "").toLowerCase();
  const clientes = dadosClientes();
  const lista = clientes.filter(item => `${item.nome} ${item.email} ${item.telefone}`.toLowerCase().includes(termo));
  const mes = dataLojaISO().slice(0, 7);
  const pedidosIdentificados = clientes.reduce((soma, item) => soma + item.pedidos.filter(pedido => !["cancelado", "cancelada"].includes(pedido.status)).length, 0);
  const total = clientes.reduce((soma, item) => soma + item.total, 0);
  $("clientesTotal").textContent = clientes.length;
  $("clientesAtivosMes").textContent = clientes.filter(item => item.pedidos.some(pedido => String(pedido.dataOperacao).startsWith(mes))).length;
  $("clientesPedidos").textContent = pedidosIdentificados;
  $("clientesTicket").textContent = formatarMoedaGestao(pedidosIdentificados ? total / pedidosIdentificados : 0);
  $("listaClientesGestao").innerHTML = lista.length ? lista.map((cliente, indice) => { const whatsapp = telefoneWhatsApp(cliente.telefone); return `<article class="customer-card" data-customer-index="${indice}"><div class="customer-head"><span class="customer-avatar">${iniciais(cliente.nome)}</span><div><h3>${escapar(cliente.nome || "Cliente")}</h3><p>${escapar(cliente.telefone || cliente.email || "Sem contato")}</p><small class="profile-origin">${cliente.origemPerfil === "google" ? "Perfil Google" : "Cliente do atendimento"}</small></div></div><p>${escapar(cliente.enderecoTexto || "Endereço não informado")}</p><div class="customer-metrics"><span>Pedidos<b>${cliente.pedidos.length}</b></span><span>Total comprado<b>${formatarMoedaGestao(cliente.total)}</b></span></div><div class="card-actions"><button class="map-action" data-customer-detail>Histórico</button>${cliente.uid ? '<button class="status-action" data-customer-note>Observação</button>' : whatsapp ? `<a class="status-action link-button" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div></article>`; }).join("") : '<div class="surface empty-state">Nenhum cliente encontrado.</div>';
  $("listaClientesGestao").querySelectorAll("[data-customer-index]").forEach(card => { const cliente = lista[Number(card.dataset.customerIndex)]; card.querySelector("[data-customer-detail]").addEventListener("click", () => abrirCliente(cliente)); card.querySelector("[data-customer-note]")?.addEventListener("click", () => abrirObservacaoCliente(cliente)); });
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
  renderFechamentosGestao();
}

function renderFechamentosGestao() {
  const container = $("listaFechamentosGestao");
  if (!container) return;
  container.innerHTML = estadoGestao.fechamentosFinanceiros.length ? estadoGestao.fechamentosFinanceiros.map(item => `<div class="data-row"><div class="row-main"><strong>${escapar(item.mesId || item.id)}</strong><small>${numeroSeguro(item.pedidos)} pedido(s) • Receita ${formatarMoedaGestao(item.receita)}</small></div><span class="row-value ${numeroSeguro(item.resultado) < 0 ? "stock-low" : ""}">${formatarMoedaGestao(item.resultado)}</span></div>`).join("") : '<div class="empty-state">Nenhum mês fechado ainda.</div>';
}

function relatorioSelecionado() {
  const inicio = $("relatorioInicio").value || periodoPadrao().inicio;
  const fim = $("relatorioFim").value || periodoPadrao().fim;
  return { inicio, fim, relatorio: calcularRelatorioGestao({ pedidos: pedidosConsolidados(), vendas: estadoGestao.vendas, movimentos: estadoGestao.movimentosFinanceiros, inicio, fim }) };
}

function campoCsv(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function exportarRelatorioCsv() {
  const { inicio, fim, relatorio } = relatorioSelecionado();
  const linhas = [
    ["Relatório Delícias da Vó", `${inicio} a ${fim}`],
    ["Receita", relatorio.receita.toFixed(2)],
    ["Despesas", relatorio.despesas.toFixed(2)],
    ["Resultado", relatorio.resultado.toFixed(2)],
    ["Pedidos e vendas", relatorio.pedidos],
    [],
    ["Vendas por dia"], ["Data", "Valor"],
    ...relatorio.dias.map(item => [item.data, numeroSeguro(item.valor).toFixed(2)]),
    [],
    ["Produtos mais vendidos"], ["Produto", "Quantidade"],
    ...relatorio.produtos.map(item => [item.nome, item.quantidade]),
    [],
    ["Formas de pagamento"], ["Pagamento", "Valor"],
    ...relatorio.pagamentos.map(item => [item.tipo, numeroSeguro(item.valor).toFixed(2)])
  ];
  const csv = `\uFEFF${linhas.map(linha => linha.map(campoCsv).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-delicias-da-vo-${inicio}-${fim}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Relatório exportado para abrir no Excel.", "success");
}

function imprimirRelatorioGestao() {
  renderRelatorios();
  document.body.classList.add("printing-report");
  const limpar = () => document.body.classList.remove("printing-report");
  window.addEventListener("afterprint", limpar, { once: true });
  window.print();
  window.setTimeout(limpar, 1500);
}

async function fecharMesRelatorio() {
  if (!(isAdmin || pode("financeiro"))) return toast("Seu acesso não permite fechar o mês.", "error");
  const { inicio, fim, relatorio } = relatorioSelecionado();
  if (inicio.slice(0, 7) !== fim.slice(0, 7)) return toast("Para fechar, escolha o primeiro e o último dia do mesmo mês.", "error");
  const mesId = inicio.slice(0, 7);
  if (!confirm(`Fechar o resultado de ${mesId}? Um novo fechamento do mesmo mês atualizará o anterior.`)) return;
  try {
    await salvarFechamentoFinanceiro(mesId, { inicio, fim, receita: relatorio.receita, despesas: relatorio.despesas, resultado: relatorio.resultado, pedidos: relatorio.pedidos, ticketMedio: relatorio.ticketMedio, produtos: relatorio.produtos, pagamentos: relatorio.pagamentos, fechadoPor: usuarioAtual?.email || "Administrador" });
    toast(`Mês ${mesId} fechado com segurança.`, "success");
  } catch (erro) { toast(erro.message || "Não foi possível fechar o mês.", "error"); }
}

async function exportarBackupGestao() {
  const botao = $("exportarBackupGestao");
  botao.disabled = true;
  botao.textContent = "Preparando backup…";
  try {
    const backup = await gerarBackupCompleto();
    baixarBackupJson(backup);
    toast(`${backup.totalDocumentos} documento(s) protegidos no arquivo.`, "success");
  } catch (erro) { toast(erro.message || "Não foi possível gerar o backup.", "error"); }
  finally { botao.disabled = false; botao.textContent = "Baixar backup agora"; }
}

async function selecionarBackupGestao(evento) {
  arquivoBackupPendente = null;
  $("restaurarBackupGestao").disabled = true;
  const arquivo = evento.target.files?.[0];
  if (!arquivo) return $("arquivoBackupGestaoStatus").textContent = "Nenhum arquivo selecionado.";
  try {
    const dados = JSON.parse(await arquivo.text());
    if (!Array.isArray(dados.documentos)) throw new Error("Arquivo incompatível.");
    arquivoBackupPendente = dados;
    $("arquivoBackupGestaoStatus").textContent = `${arquivo.name} • ${dados.documentos.length} documento(s)`;
    $("restaurarBackupGestao").disabled = false;
  } catch (erro) {
    $("arquivoBackupGestaoStatus").textContent = "Este arquivo não é um backup válido da Delícias da Vó.";
  }
}

async function restaurarBackupGestao() {
  if (!arquivoBackupPendente) return;
  if (!confirm(`Restaurar ${arquivoBackupPendente.documentos.length} documento(s)? Os documentos existentes com o mesmo caminho serão atualizados.`)) return;
  const botao = $("restaurarBackupGestao");
  botao.disabled = true;
  try {
    const total = await restaurarBackupCompleto(arquivoBackupPendente, (feito, quantidade) => {
      botao.textContent = `Restaurando ${feito}/${quantidade}…`;
    });
    toast(`${total} documento(s) restaurados.`, "success");
    arquivoBackupPendente = null;
    $("arquivoBackupGestao").value = "";
    $("arquivoBackupGestaoStatus").textContent = "Restauração concluída com sucesso.";
  } catch (erro) { toast(erro.message || "Não foi possível restaurar o backup.", "error"); }
  finally { botao.textContent = "Restaurar dados"; botao.disabled = !arquivoBackupPendente; }
}

function renderEquipe() {
  if (!isAdmin) return;
  const solicitacoes = estadoGestao.solicitacoesAcesso.filter(item => item.status === "pendente");
  const emailsAtivos = new Set(estadoGestao.equipe.map(item => String(item.email || "").toLowerCase()));
  const convites = estadoGestao.convitesEquipe.filter(item => item.ativo !== false && item.status === "pendente" && !emailsAtivos.has(String(item.email || "").toLowerCase()));
  $("convitesEquipe").innerHTML = convites.length ? convites.map(item => `<div class="compact-row invite-row"><div class="customer-avatar">${iniciais(item.nome || item.email)}</div><div class="row-main"><strong>${escapar(item.nome || "Convite por e-mail")}</strong><small>${escapar(item.email)} • ${escapar(item.cargo || "Colaborador")}</small><div class="permission-summary">${resumoPermissoesEquipe(item.permissoes)}</div></div><div class="invite-actions"><span class="invite-state">Aguardando login</span><button class="text-btn danger" type="button" data-cancel-invite="${escapar(item.email)}">Cancelar</button></div></div>`).join("") : '<div class="empty-state">Nenhum convite por e-mail aguardando.</div>';
  $("solicitacoesEquipe").innerHTML = solicitacoes.length ? `<p class="kicker">Pedidos de acesso recebidos</p>${solicitacoes.map(item => `<div class="compact-row"><div class="customer-avatar">${iniciais(item.nome)}</div><div class="row-main"><strong>${escapar(item.nome || "Pessoa")}</strong><small>${escapar(item.email)}</small></div><button class="primary-btn" type="button" data-approve="${item.uid}">Analisar</button></div>`).join("")}` : "";
  $("membrosEquipe").innerHTML = estadoGestao.equipe.length ? estadoGestao.equipe.map(item => `<div class="team-row"><div class="customer-avatar">${iniciais(item.nome)}</div><div class="row-main"><strong>${escapar(item.nome)}</strong><small>${escapar(item.email || "Sem e-mail")} • ${escapar(item.cargo)} • ${item.ativo ? "Ativo" : "Bloqueado"}</small><div class="permission-summary">${resumoPermissoesEquipe(item.permissoes)}</div></div><button class="text-btn" type="button" data-member="${item.uid}">Editar</button></div>`).join("") : '<div class="empty-state">Nenhum colaborador cadastrado.</div>';
  $("solicitacoesEquipe").querySelectorAll("[data-approve]").forEach(botao => botao.addEventListener("click", () => abrirAprovacaoEquipe(solicitacoes.find(item => item.uid === botao.dataset.approve))));
  $("membrosEquipe").querySelectorAll("[data-member]").forEach(botao => botao.addEventListener("click", () => abrirEdicaoEquipe(estadoGestao.equipe.find(item => item.uid === botao.dataset.member))));
  $("convitesEquipe").querySelectorAll("[data-cancel-invite]").forEach(botao => botao.addEventListener("click", async () => {
    if (!confirm(`Cancelar o convite de ${botao.dataset.cancelInvite}?`)) return;
    try { await cancelarConviteEquipe(botao.dataset.cancelInvite); toast("Convite cancelado.", "success"); }
    catch (erro) { toast(erro.message || "Não foi possível cancelar o convite.", "error"); }
  }));
}

function renderConfiguracoes() {
  const config = estadoGestao.configuracaoOperacao || {};
  $("configMetaDiaria").value = numeroSeguro(config.metaDiaria) || "";
  $("configTempoPreparo").value = numeroSeguro(config.tempoPreparo) || 40;
  $("configDiasEncomendas").value = config.diasAntecedenciaEncomendas === undefined ? 7 : Math.max(0, Math.min(90, numeroSeguro(config.diasAntecedenciaEncomendas)));
  $("configLimitePedidos").value = numeroSeguro(config.limitePedidos) || 25;
  $("configResponsavel").value = config.responsavel || usuarioAtual?.displayName || "";
  $("configSomPedidos").checked = config.somPedidos !== false;
  $("configBaixaEstoque").checked = config.baixaEstoque !== false;
}

function renderPagina(pagina = paginaAtual) {
  const mapa = { dashboard: renderDashboard, pedidos: renderPedidos, cozinha: renderCozinha, cardapio: renderCardapio, balcao: renderBalcao, entregas: renderEntregas, encomendas: renderEncomendas, caixa: renderCaixa, estoque: renderEstoque, compras: renderCompras, financeiro: renderFinanceiro, clientes: renderClientes, relatorios: renderRelatorios, backup: () => {}, equipe: renderEquipe, configuracoes: renderConfiguracoes };
  mapa[pagina]?.();
}

function renderTudo() {
  const todosPedidos = pedidosConsolidados();
  const pedidos = pedidosOperacionais();
  const abertos = pedidos.filter(item => !statusFinal(item.status));
  const cozinha = pedidos.filter(item => ["confirmado", "producao", "pronto"].includes(item.status));
  const entregas = pedidos.filter(item => item.tipoAtendimento === "Entrega" && ["confirmado", "producao", "pronto", "saiu_entrega"].includes(item.status));
  const estoque = calcularAlertasEstoque(estadoGestao.produtos, estadoGestao.insumos);
  const convitesPendentes = estadoGestao.convitesEquipe.filter(item => item.ativo !== false && item.status === "pendente" && !estadoGestao.equipe.some(membro => String(membro.email || "").toLowerCase() === String(item.email || "").toLowerCase())).length;
  [["badgePedidos", abertos.length], ["badgeCozinha", cozinha.length], ["badgeEntregas", entregas.length], ["badgeEstoque", estoque.length], ["badgeEquipe", estadoGestao.solicitacoesAcesso.filter(item => item.status === "pendente").length + convitesPendentes]].forEach(([id, valor]) => { if (!$(id)) return; $(id).textContent = valor; $(id).hidden = !valor; });
  if (ultimoTotalPedidos && todosPedidos.length > ultimoTotalPedidos && estadoGestao.configuracaoOperacao.somPedidos !== false) tocarAviso();
  ultimoTotalPedidos = todosPedidos.length;
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

function opcoesPagamentoPedido(selecionado = "Não informado") {
  return ["Pix", "Dinheiro", "Cartão débito", "Cartão crédito", "Não informado"].map(valor => `<option ${valor === selecionado ? "selected" : ""}>${valor}</option>`).join("");
}

function abrirEdicaoPedidoManual(pedido) {
  itensPedidoModal = (pedido.itens || []).map(item => ({
    id: item.id || "", variacaoId: item.variacaoId || "", nome: item.nome || "Item",
    preco: numeroSeguro(item.preco), quantidade: numeroSeguro(item.quantidade), sabor: item.sabor || "", observacao: item.observacao || ""
  }));
  abrirModal(`Editar ${pedido.numeroExibicao}`, `<form id="formEditarPedidoManual" class="modal-form"><p class="editing-notice">A edição fica disponível somente antes de confirmar o pedido.</p><div class="form-grid"><label>Nome do cliente<input id="editarPedidoClienteNome" value="${escapar(pedido.clienteNome)}" required maxlength="120"></label><label>WhatsApp<input id="editarPedidoClienteTelefone" value="${escapar(pedido.clienteTelefone)}" maxlength="30"></label><label>Atendimento<select id="editarPedidoTipo"><option ${pedido.tipoAtendimento !== "Entrega" ? "selected" : ""}>Retirada na loja</option><option ${pedido.tipoAtendimento === "Entrega" ? "selected" : ""}>Entrega</option></select></label><label>Pagamento<select id="editarPedidoPagamento">${opcoesPagamentoPedido(pedido.pagamento)}</select></label><label class="full">Endereço<input id="editarPedidoEndereco" value="${escapar(enderecoPedido(pedido))}" maxlength="500"></label><label>Taxa de entrega (R$)<input id="editarPedidoTaxa" type="number" min="0" step="0.01" value="${numeroSeguro(pedido.taxaEntrega)}"></label></div><fieldset><legend>Itens do pedido</legend><div class="modal-item-row"><select id="pedidoProdutoSelect">${selectProdutosHtml()}</select><input id="pedidoQuantidade" type="number" min="1" value="1"><input id="pedidoPreco" type="number" min="0" step="0.01"><button id="adicionarItemPedido" type="button">＋</button></div><div id="pedidoItensModal" class="modal-items"></div></fieldset><label>Observações<textarea id="editarPedidoObservacao" rows="3">${escapar(pedido.observacao || "")}</textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar correções</button></div></form>`, "Correção antes do preparo");
  const preencherPreco = () => { const [id, variacaoId] = $("pedidoProdutoSelect").value.split("|"); const item = todasOpcoesProdutos().find(opcao => opcao.id === id && opcao.variacaoId === variacaoId); $("pedidoPreco").value = item?.preco || 0; };
  preencherPreco();
  $("pedidoProdutoSelect").addEventListener("change", preencherPreco);
  $("adicionarItemPedido").addEventListener("click", adicionarItemPedidoModal);
  renderItensPedidoModal();
  $("formEditarPedidoManual").addEventListener("submit", async evento => {
    evento.preventDefault();
    try {
      await atualizarPedidoManualGestao(pedido.id, {
        cliente: { nome: $("editarPedidoClienteNome").value, telefone: $("editarPedidoClienteTelefone").value },
        tipo: $("editarPedidoTipo").value,
        endereco: $("editarPedidoEndereco").value,
        pagamento: $("editarPedidoPagamento").value,
        taxaEntrega: $("editarPedidoTaxa").value,
        itens: itensPedidoModal,
        observacao: $("editarPedidoObservacao").value
      });
      fecharModal();
      toast("Pedido corrigido antes do preparo.", "success");
    } catch (erro) { toast(erro.message || "Não foi possível editar o pedido.", "error"); }
  });
}

function abrirInsumo(item = {}) {
  abrirModal(item.id ? "Editar insumo" : "Novo insumo", `<form id="formInsumo" class="modal-form"><div class="form-grid"><label>Nome<input id="insumoNome" value="${escapar(item.nome || "")}" required></label><label>Categoria<select id="insumoCategoria">${["Ingredientes", "Bebidas", "Embalagens", "Limpeza", "Outros"].map(valor => `<option ${item.categoria === valor ? "selected" : ""}>${valor}</option>`).join("")}</select></label><label>Unidade<select id="insumoUnidade">${["un", "kg", "g", "L", "ml", "pacote", "caixa"].map(valor => `<option ${item.unidade === valor ? "selected" : ""}>${valor}</option>`).join("")}</select></label><label>Quantidade atual<input id="insumoQuantidade" type="number" min="0" step="0.001" value="${numeroSeguro(item.quantidade)}"></label><label>Estoque mínimo<input id="insumoMinimo" type="number" min="0" step="0.001" value="${numeroSeguro(item.minimo)}"></label><label>Custo unitário<input id="insumoCusto" type="number" min="0" step="0.01" value="${numeroSeguro(item.custoUnitario)}"></label><label>Validade<input id="insumoValidade" type="date" value="${escapar(item.validade || "")}"></label><label class="toggle-row"><input id="insumoAtivo" type="checkbox" ${item.ativo !== false ? "checked" : ""}><span><b>Insumo ativo</b></span></label></div><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Estoque");
  $("formInsumo").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarInsumo({ id: item.id, nome: $("insumoNome").value, categoria: $("insumoCategoria").value, unidade: $("insumoUnidade").value, quantidade: $("insumoQuantidade").value, minimo: $("insumoMinimo").value, custoUnitario: $("insumoCusto").value, validade: $("insumoValidade").value, ativo: $("insumoAtivo").checked }); fecharModal(); toast("Insumo salvo.", "success"); } catch (erro) { toast(erro.message, "error"); } });
}

function abrirCustoProduto(item) {
  if (!item) return;
  const custoAtual = estadoGestao.custosProdutos.find(registro => registro.id === item.id || registro.produtoId === item.id);
  abrirModal(`Custo de ${item.nome}`, `<form id="formCustoProdutoGestao" class="modal-form"><p>Use o custo médio de uma unidade pronta. Se existir uma ficha técnica, confira os dois valores antes de alterar.</p><label>Custo unitário (R$)<input id="custoProdutoGestao" type="number" min="0" step="0.01" value="${numeroSeguro(custoAtual?.custoUnitario)}" required></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar custo</button></div></form>`, "Estoque e custos");
  $("formCustoProdutoGestao").addEventListener("submit", async evento => {
    evento.preventDefault();
    try {
      await salvarCustoProduto(item.id, { nome: item.nome, custoUnitario: $("custoProdutoGestao").value });
      fecharModal();
      toast("Custo do produto atualizado.", "success");
    } catch (erro) { toast(erro.message || "Não foi possível salvar o custo.", "error"); }
  });
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

function abrirCliente(cliente) { abrirModal(cliente.nome || "Cliente", `<div class="modal-form"><div class="form-grid"><label>Telefone<input readonly value="${escapar(cliente.telefone || "")}"></label><label>E-mail<input readonly value="${escapar(cliente.email || "Não cadastrado")}"></label><label class="full">Endereço<input readonly value="${escapar(cliente.enderecoTexto || "Não informado")}"></label><label>Origem do cadastro<input readonly value="${cliente.origemPerfil === "google" ? "Perfil Google" : "WhatsApp/atendimento"}"></label><label>Pedidos<input readonly value="${cliente.pedidos.length}"></label><label>Total comprado<input readonly value="${formatarMoedaGestao(cliente.total)}"></label>${cliente.uid ? `<label class="full">Observação interna<textarea readonly>${escapar(cliente.observacaoGestao || "")}</textarea></label>` : ""}</div><fieldset><legend>Histórico</legend><div class="compact-list">${cliente.pedidos.map(pedido => `<div class="compact-row"><div class="row-main"><strong>${escapar(pedido.numeroExibicao)}</strong><small>${textoData(pedido.dataOperacao)} • ${infoStatus(pedido.status).nome}</small></div><span>${formatarMoedaGestao(pedido.valor)}</span></div>`).join("") || '<div class="empty-state">Nenhum pedido identificado.</div>'}</div></fieldset></div>`, "Cliente"); }

function abrirObservacaoCliente(cliente) { if (!cliente.uid) return toast("Este cliente ainda não possui perfil Google para salvar uma observação.", "error"); abrirModal("Observação do cliente", `<form id="formObservacaoCliente" class="modal-form"><p>${escapar(cliente.nome)}</p><label>Observação interna<textarea id="clienteObservacao" rows="5" placeholder="Preferências, cuidados ou informações úteis">${escapar(cliente.observacaoGestao || "")}</textarea></label><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar</button></div></form>`, "Clientes"); $("formObservacaoCliente").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarObservacaoCliente(cliente.uid, $("clienteObservacao").value); fecharModal(); toast("Observação salva.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

const permissoesLista = ["pedidos", "cozinha", "entregas", "caixa", "estoque", "compras", "financeiro", "clientes", "relatorios", "configuracoes", "site"];
const permissoesDetalhes = {
  pedidos: ["Pedidos", "Pedidos do site, WhatsApp e atendimento"],
  cozinha: ["Cozinha", "Fila e andamento do preparo"],
  entregas: ["Entregas", "Endereços, rotas e conclusão"],
  caixa: ["Caixa e balcão", "Vendas rápidas e conferência diária"],
  estoque: ["Estoque", "Insumos, fichas e perdas"],
  compras: ["Compras", "Fornecedores e entrada de mercadorias"],
  financeiro: ["Financeiro", "Entradas, despesas e fechamento"],
  clientes: ["Clientes", "Dados, histórico e observações"],
  relatorios: ["Relatórios", "Resultados, rankings e exportações"],
  configuracoes: ["Configuração da gestão", "Meta, capacidade e funcionamento interno"],
  site: ["Editor do site", "Produtos, promoções, contatos e aparência pública"]
};
const cargosEquipe = ["Atendimento", "Operação", "Cozinha", "Caixa", "Entregador", "Estoque e compras", "Gerente", "Editor do site"];
const presetsEquipe = {
  Atendimento: { pedidos: true, clientes: true },
  Operação: { pedidos: true, cozinha: true, entregas: true, clientes: true },
  Cozinha: { cozinha: true },
  Caixa: { pedidos: true, caixa: true, clientes: true },
  Entregador: { entregas: true },
  "Estoque e compras": { estoque: true, compras: true },
  Gerente: { pedidos: true, cozinha: true, entregas: true, caixa: true, estoque: true, compras: true, financeiro: true, clientes: true, relatorios: true, configuracoes: true },
  "Editor do site": { site: true }
};
function permissoesDoCargo(cargo = "Atendimento") { const preset = presetsEquipe[cargo] || {}; return Object.fromEntries(permissoesLista.map(nome => [nome, Boolean(preset[nome])])); }
function resumoPermissoesEquipe(atuais = {}) { const ativas = permissoesLista.filter(nome => atuais?.[nome]); return ativas.length ? ativas.map(nome => `<span>${escapar(permissoesDetalhes[nome][0])}</span>`).join("") : "<span>Sem áreas liberadas</span>"; }
function htmlCargosEquipe(id, selecionado = "Atendimento") { return `<select id="${id}">${cargosEquipe.map(cargo => `<option ${cargo === selecionado ? "selected" : ""}>${cargo}</option>`).join("")}</select>`; }
function htmlPermissoes(atuais = {}) { return `<div class="permission-grid">${permissoesLista.map(nome => `<label><input type="checkbox" data-permission-input="${nome}" ${atuais[nome] ? "checked" : ""}><span><b>${permissoesDetalhes[nome][0]}</b><small>${permissoesDetalhes[nome][1]}</small></span></label>`).join("")}</div>`; }
function lerPermissoesModal() { return Object.fromEntries(permissoesLista.map(nome => [nome, Boolean(document.querySelector(`[data-permission-input="${nome}"]`)?.checked)])); }
function aplicarPresetEquipe(cargo) { const permissoes = permissoesDoCargo(cargo); permissoesLista.forEach(nome => { const campo = document.querySelector(`[data-permission-input="${nome}"]`); if (campo) campo.checked = permissoes[nome]; }); }
function abrirConviteEquipe() {
  const cargoInicial = "Atendimento";
  abrirModal("Adicionar à equipe", `<form id="formConviteEquipe" class="modal-form"><div class="form-grid"><label>Nome da pessoa<input id="conviteEquipeNome" maxlength="120" placeholder="Como ela aparecerá na equipe"></label><label>E-mail da conta Google<input id="conviteEquipeEmail" type="email" maxlength="200" required placeholder="pessoa@gmail.com"></label><label class="full">Função sugerida${htmlCargosEquipe("conviteEquipeCargo", cargoInicial)}</label></div><p class="permission-preset">A função marca um conjunto inicial. Você ainda pode ligar ou desligar qualquer área abaixo.</p><fieldset><legend>O que esta pessoa poderá acessar</legend>${htmlPermissoes(permissoesDoCargo(cargoInicial))}</fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Criar convite</button></div></form>`, "Acesso seguro");
  $("conviteEquipeCargo").addEventListener("change", evento => aplicarPresetEquipe(evento.target.value));
  $("formConviteEquipe").addEventListener("submit", async evento => {
    evento.preventDefault();
    try {
      await criarConviteEquipe({ nome: $("conviteEquipeNome").value, email: $("conviteEquipeEmail").value, cargo: $("conviteEquipeCargo").value, permissoes: lerPermissoesModal() });
      fecharModal(); toast("Convite criado. A pessoa deve entrar na Gestão com esse mesmo e-mail Google.", "success");
    } catch (erro) { toast(erro.message || "Não foi possível criar o convite.", "error"); }
  });
}
function abrirAprovacaoEquipe(item) { const cargoInicial = "Operação"; abrirModal(`Liberar ${item.nome || "acesso"}`, `<form id="formAprovarEquipe" class="modal-form"><label>Cargo${htmlCargosEquipe("equipeCargo", cargoInicial)}</label><p class="permission-preset">Confira cada área antes de liberar.</p><fieldset><legend>Áreas permitidas</legend>${htmlPermissoes(permissoesDoCargo(cargoInicial))}</fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Liberar acesso</button></div></form>`, "Equipe"); $("equipeCargo").addEventListener("change", evento => aplicarPresetEquipe(evento.target.value)); $("formAprovarEquipe").addEventListener("submit", async evento => { evento.preventDefault(); try { await aprovarAcessoGestao(item, { cargo: $("equipeCargo").value, permissoes: lerPermissoesModal() }); fecharModal(); toast("Acesso liberado.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }
function abrirEdicaoEquipe(item) { abrirModal(`Editar ${item.nome}`, `<form id="formEditarEquipe" class="modal-form"><label>Cargo<input id="equipeCargoEdit" value="${escapar(item.cargo || "Colaborador")}"></label><label class="toggle-row"><input id="equipeAtivoEdit" type="checkbox" ${item.ativo !== false ? "checked" : ""}><span><b>Acesso ativo</b></span></label><fieldset><legend>Áreas permitidas</legend>${htmlPermissoes(item.permissoes || {})}</fieldset><div class="modal-actions"><button class="cancel" type="button" data-modal-close>Cancelar</button><button type="submit">Salvar acesso</button></div></form>`, "Equipe"); $("formEditarEquipe").addEventListener("submit", async evento => { evento.preventDefault(); try { await atualizarMembroEquipe(item.uid, { cargo: $("equipeCargoEdit").value, ativo: $("equipeAtivoEdit").checked, permissoes: lerPermissoesModal() }); fecharModal(); toast("Acesso atualizado.", "success"); } catch (erro) { toast(erro.message, "error"); } }); }

function lidarAcao(acao) {
  if (acao === "convidar-equipe" && !isAdmin) return toast("Somente o administrador principal pode convidar pessoas.", "error");
  const permissaoAcao = {
    "novo-pedido": "pedidos",
    "novo-insumo": "estoque",
    "nova-ficha": "estoque",
    "nova-perda": "estoque",
    "novo-fornecedor": "compras",
    "nova-compra": "compras",
    "novo-movimento": "financeiro",
    "digitalizar-venda": "caixa",
    "abrir-caixa": "caixa",
    "movimento-caixa": "caixa",
    "fechar-caixa": "caixa"
  };
  if (permissaoAcao[acao] && !pode(permissaoAcao[acao])) return toast("Seu acesso não permite esta ação.", "error");
  const mapa = { "novo-pedido": abrirNovoPedido, "novo-insumo": () => abrirInsumo(), "nova-ficha": abrirFicha, "nova-perda": abrirPerda, "novo-fornecedor": () => abrirFornecedor(), "nova-compra": abrirCompra, "novo-movimento": abrirMovimentoFinanceiro, "digitalizar-venda": abrirDigitalizacaoVenda, "abrir-caixa": abrirCaixa, "movimento-caixa": abrirMovimentoCaixa, "fechar-caixa": abrirFechamentoCaixa, "convidar-equipe": abrirConviteEquipe };
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
$("salvarCardapioGestao").addEventListener("click", async () => { const produtoIds = [...document.querySelectorAll("#produtosCardapioGestao input:checked")].map(campo => campo.value); if ($("publicarCardapioGestao").checked && !produtoIds.length) return toast("Escolha pelo menos um produto ou desative a publicação.", "error"); try { await salvarCardapioDia({ dataISO: $("dataCardapioGestao").value, produtoIds, publicado: $("publicarCardapioGestao").checked, titulo: $("tituloCardapioGestao").value, itens: $("itensTextoCardapioGestao").value.split("\n"), observacao: $("observacaoCardapioGestao").value }); toast("Cardápio atualizado no site.", "success"); } catch (erro) { toast(erro.message, "error"); } });
const periodo = periodoPadrao();
[["financeiroInicio", periodo.inicio], ["financeiroFim", periodo.fim], ["relatorioInicio", periodo.inicio], ["relatorioFim", periodo.fim]].forEach(([id, valor]) => { $(id).value = valor; });
$("aplicarPeriodoFinanceiro").addEventListener("click", renderFinanceiro);
$("gerarRelatorioGestao").addEventListener("click", renderRelatorios);
$("exportarRelatorioGestao").addEventListener("click", exportarRelatorioCsv);
$("imprimirRelatorioGestao").addEventListener("click", imprimirRelatorioGestao);
$("fecharMesGestao").addEventListener("click", fecharMesRelatorio);
$("exportarBackupGestao").addEventListener("click", exportarBackupGestao);
$("arquivoBackupGestao").addEventListener("change", selecionarBackupGestao);
$("restaurarBackupGestao").addEventListener("click", restaurarBackupGestao);
$("formConfiguracaoOperacao").addEventListener("submit", async evento => { evento.preventDefault(); try { await salvarConfiguracaoOperacao({ metaDiaria: numeroSeguro($("configMetaDiaria").value), tempoPreparo: numeroSeguro($("configTempoPreparo").value), diasAntecedenciaEncomendas: Math.max(0, Math.min(90, numeroSeguro($("configDiasEncomendas").value))), limitePedidos: numeroSeguro($("configLimitePedidos").value), responsavel: $("configResponsavel").value, somPedidos: $("configSomPedidos").checked, baixaEstoque: $("configBaixaEstoque").checked }); toast("Preferências salvas. A agenda e a produção já foram atualizadas.", "success"); } catch (erro) { toast(erro.message, "error"); } });
window.addEventListener("online", () => { $("conexaoGestao").classList.remove("offline"); $("conexaoGestao").lastChild.textContent = " Sincronizado"; renderTudo(); });
window.addEventListener("offline", () => { $("conexaoGestao").classList.add("offline"); $("conexaoGestao").lastChild.textContent = " Sem conexão"; });
window.addEventListener("keydown", evento => { if (evento.key === "Escape" && !$("gestaoModal").hidden) fecharModal(); });
window.setInterval(() => { $("relogioGestao").textContent = horaLoja(); $("dataGestao").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }).format(new Date()); }, 1000);
window.setInterval(() => {
  if ($("gestaoApp").hidden) return;
  renderDashboard();
  if (paginaAtual === "pedidos") renderPedidos();
  if (paginaAtual === "cozinha") renderCozinha();
}, 60000);
onAuthStateChanged(auth, processarUsuario);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js", { scope: "/" }).catch(() => {});
