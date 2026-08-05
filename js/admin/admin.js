import { iniciarAuth } from "../core/auth.js";
import { formatarMoeda, limparTexto, gerarId } from "../core/utils.js";
import { produtos, observarProdutos, criarProdutosBase, salvarProduto, atualizarProduto, excluirProduto, statusEstoque } from "../services/productService.js";
import { categorias, categoriasBase, observarCategorias, normalizarCategorias, categoriaPorId } from "../services/categoryService.js";
import { registrarVendaRapida, observarVendasHoje, vendasHoje, resumoCaixa, excluirVendaComEstorno } from "../services/salesService.js";
import { lojaConfig, observarConfiguracoesLoja, salvarConfiguracoes } from "../services/configService.js";
import { promocoes, observarPromocoes, salvarPromocao, atualizarPromocao, excluirPromocao } from "../services/promotionService.js";
import { sugerirProdutoComIA } from "../services/aiProductService.js";
import { iniciarCategoriasAdmin, abrirModalCategoria, fecharModalCategoria, salvarCategoriaAdmin } from "./categoryAdmin.js";
import { createProductAdminRow, createPromoAdminCard } from "../core/templates.js";
import { storage, storageRef, uploadBytes, getDownloadURL, deleteObject } from "../core/firebase.js";
import { observarResumoPedidosSiteHoje, resumoPedidosSiteHoje } from "../services/orderService.js";
import { salgadosFesta, observarSalgadosFesta, salvarSalgadoFesta, excluirSalgadoFesta, enviarProdutosBaseParaFirestore, descreverErroFirestore, normalizarPrecoFesta, textoPrecoFesta } from "../services/partyProductService.js";
import { encomendasFesta, observarEncomendasFesta, atualizarStatusEncomendaFesta, marcarEncomendaVisualizada, excluirEncomendaFesta } from "../services/partyOrderService.js";
import {
  movimentosFinanceiros, vendasFinanceiras, encomendasFinanceiras, custosProdutos, fechamentosFinanceiros,
  observarMovimentosFinanceiros, observarVendasFinanceiras, observarEncomendasFinanceiras,
  observarCustosProdutos, observarFechamentosFinanceiros, salvarMovimentoFinanceiro,
  excluirMovimentoFinanceiro, salvarCustoProduto, salvarFechamentoFinanceiro,
  consolidarFinanceiro, calcularCustoItens
} from "../services/financeService.js";
import {
  pedidosNormaisCentral, vendasCentral, encomendasCentral,
  observarPedidosNormaisCentral, observarVendasCentral, observarEncomendasCentral,
  consolidarCentralPedidos, atualizarStatusPedidoNormal, atualizarStatusVenda
} from "../services/centralOrderService.js";
import { gerarBackupCompleto, baixarBackupJson, restaurarBackupCompleto } from "../services/backupService.js";

// API pública será exposta no final do arquivo para reduzir poluição global

let produtoEditando = null;
let vendaAtual = [];
let promocaoEditando = null;
let festaEditando = null;
let periodoFinanceiroAtual = "mes";
let movimentoEditando = null;
let arquivoBackupPendente = null;
let erroCentralPedidos = null;

iniciarAuth();

function iniciarAdminDepoisLogin() {
  observarProdutos(() => {
    renderDashboard();
    renderProdutosAdmin();
    renderVendaRapida();
    renderPromocoesAdmin();
    renderCustosProdutos();
  });

  iniciarCategoriasAdmin();
  observarSalgadosFesta((_, erro) => renderFestasAdmin(erro));
  observarEncomendasFesta((_, erro) => { renderAgendaEncomendas(erro); renderNotificacoesEncomendas(); });

  observarMovimentosFinanceiros(() => { renderFinanceiro(); renderDashboardFinanceiro(); });
  observarVendasFinanceiras(() => { renderFinanceiro(); renderDashboardFinanceiro(); });
  observarEncomendasFinanceiras(() => { renderFinanceiro(); renderDashboardFinanceiro(); });
  observarCustosProdutos(() => { renderFinanceiro(); renderCustosProdutos(); });
  observarFechamentosFinanceiros(() => renderFechamentosFinanceiros());

  observarPedidosNormaisCentral((_,erro) => { erroCentralPedidos=erro; renderCentralPedidos(); });
  observarVendasCentral((_,erro) => { erroCentralPedidos=erro; renderCentralPedidos(); });
  observarEncomendasCentral((_,erro) => { erroCentralPedidos=erro; renderCentralPedidos(); });

  observarVendasHoje(() => {
    renderDashboard();
    renderCaixa();
  });

  observarResumoPedidosSiteHoje(() => {
    renderPedidosSiteDashboard();
  });

 observarConfiguracoesLoja(() => {
  const abaConfigAberta = document.getElementById("aba-config")?.classList.contains("active");

  if (!abaConfigAberta) {
    preencherConfiguracoesLoja();
  }
});

  observarPromocoes(() => {
    renderPromocoesAdmin();
  });
}

function abrirAba(nome, botao) {
  document.querySelectorAll(".aba").forEach(a => a.classList.remove("active"));
  const aba = document.getElementById(`aba-${nome}`);
  if (!aba) return;
  aba.classList.add("active");

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  if (botao) botao.classList.add("active");

  const titulos = {
    dashboard: "Dashboard",
    produtos: "Produtos",
    venda: "Venda rápida",
    caixa: "Caixa",
    financeiro: "Financeiro",
    promocoes: "Promoções",
    categorias: "Categorias",
    festas: "Salgados para festas",
    encomendas: "Agenda de encomendas",
    central: "Central de pedidos",
    backup: "Backup dos dados",
    digitalizacao: "Digitalizar registros",
    config: "Configurações"
  };

  const descricoes = {
    dashboard: "Resumo da loja, vendas, produtos e estoque em tempo real.",
    produtos: "Organize o cardápio sem complicação.",
    venda: "Registre uma venda da loja física.",
    caixa: "Acompanhe vendas e formas de pagamento.",
    financeiro: "Veja entradas, despesas e resultado.",
    promocoes: "Crie ofertas para destacar no site.",
    categorias: "Organize os produtos por categoria.",
    festas: "Gerencie o catálogo de encomendas.",
    encomendas: "Acompanhe as próximas festas.",
    central: "Encontre todos os pedidos em um só lugar.",
    backup: "Proteja e restaure os dados da loja.",
    digitalizacao: "Fotografe, confira e salve uma compra ou venda.",
    config: "Atualize as informações e horários da loja."
  };

  document.getElementById("tituloAba").textContent = titulos[nome] || "Painel";
  const descricao = document.getElementById("descricaoAba");
  if (descricao) descricao.textContent = descricoes[nome] || "Gerencie a Delícias da Vó.";
  fecharMenuAdmin();
}

function abrirAbaPorNome(nome) {
  const botao = [...document.querySelectorAll('.tab-btn')].find(btn => btn.getAttribute('onclick')?.includes(`'${nome}'`));
  abrirAba(nome, botao);
}

function atualizarEstadoMenuAdmin(aberto) {
  document.body.classList.toggle("admin-menu-open", aberto);
  const botao = document.querySelector(".sidebar-toggle");
  if (botao) botao.setAttribute("aria-expanded", String(aberto));
}

function alternarMenuAdmin() {
  atualizarEstadoMenuAdmin(!document.body.classList.contains("admin-menu-open"));
}

function fecharMenuAdmin() {
  atualizarEstadoMenuAdmin(false);
}

window.addEventListener("keydown", evento => {
  if (evento.key === "Escape") fecharMenuAdmin();
});

function produtoMaisVendidoHoje() {
  const mapa = {};

  vendasHoje.forEach(venda => {
    (venda.itens || []).forEach(item => {
      if (!mapa[item.nome]) mapa[item.nome] = 0;
      mapa[item.nome] += Number(item.quantidade || 0);
    });
  });

  const ordenado = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  return ordenado[0] || null;
}


function renderPedidosSiteDashboard() {
  const totalEl = document.getElementById("statPedidosSiteHoje");
  const ultimoEl = document.getElementById("statUltimoPedidoSite");

  if (!totalEl || !ultimoEl) return;

  totalEl.textContent = resumoPedidosSiteHoje.totalPedidos || 0;

  const ultimo = resumoPedidosSiteHoje.ultimoPedido;

  if (ultimo?.numeroFormatado) {
    ultimoEl.textContent = `${ultimo.numeroFormatado} às ${ultimo.horaBR || "--:--"}`;
  } else {
    ultimoEl.textContent = "Nenhum pedido enviado hoje";
  }
}


function renderDashboard() {
  renderPedidosSiteDashboard();

  const ativos = produtos.filter(p => p.ativo !== false).length;

  const baixos = produtos.filter(p => {
    const status = statusEstoque(p);
    return (status.classe === "baixo" || status.classe === "off") && !p.sobEncomenda;
  });

  const totalHoje = vendasHoje.reduce((soma, venda) => soma + Number(venda.total || 0), 0);
  const maisVendido = produtoMaisVendidoHoje();

  const statProdutos = document.getElementById("statProdutos");
  if (!statProdutos) return;

  document.getElementById("statProdutos").textContent = produtos.length;
  document.getElementById("statAtivosTexto").textContent = `${ativos} ativos`;
  document.getElementById("statBaixo").textContent = baixos.length;
  document.getElementById("statVendasHoje").textContent = formatarMoeda(totalHoje);
  document.getElementById("statQtdVendas").textContent = `${vendasHoje.length} venda(s) registrada(s)`;
  document.getElementById("statMaisVendido").textContent = maisVendido ? maisVendido[0] : "—";
  document.getElementById("statMaisVendidoQtd").textContent = maisVendido ? `${maisVendido[1]} unidade(s)` : "Sem vendas hoje";

  const avisos = document.getElementById("avisosDashboard");
  if (avisos) {
    avisos.innerHTML = "";

    if (!baixos.length) {
      const p = document.createElement('p'); p.textContent = 'Nenhum produto em atenção no momento.'; avisos.appendChild(p);
    }

    baixos.forEach(p => {
      const el = document.createElement('p'); el.textContent = `⚠ ${p.nome}: estoque ${p.estoque || 0}`; avisos.appendChild(el);
    });
  }

  const ultimas = document.getElementById("ultimasVendasDashboard");
  if (ultimas) {
    ultimas.innerHTML = "";

    if (!vendasHoje.length) {
      const p = document.createElement('p'); p.textContent = 'Nenhuma venda registrada hoje.'; ultimas.appendChild(p);
    }

    vendasHoje.slice(0, 5).forEach(venda => {
      const itens = (venda.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(", ");
      const wrapper = document.createElement('div'); wrapper.className = 'venda-historico';
      const strong = document.createElement('strong'); strong.textContent = `${venda.hora || '--:--'} - ${formatarMoeda(venda.total)}`; wrapper.appendChild(strong);
      const small1 = document.createElement('small'); small1.textContent = itens; wrapper.appendChild(small1);
      const small2 = document.createElement('small'); small2.textContent = venda.pagamento; wrapper.appendChild(small2);
      ultimas.appendChild(wrapper);
    });
  }
}

function renderProdutosAdmin() {
  const box = document.getElementById("listaProdutosAdmin");
  if (!box) return;

  const busca = (document.getElementById("buscaAdminProduto")?.value || "").toLowerCase();

  box.innerHTML = "";

  produtos
    .filter(p => p.nome.toLowerCase().includes(busca) || p.categoria.includes(busca))
    .forEach(p => {
      const row = createProductAdminRow(p);
      box.appendChild(row);
    });
}

function preencherSelectCategorias() {
  const select = document.getElementById("produtoCategoria");
  if (!select) return;

  select.innerHTML = "";

  const ordenadas = normalizarCategorias(categorias.length ? categorias : categoriasBase).filter(categoria => categoria.ativa !== false);

  ordenadas.forEach(categoria => {
    const option = document.createElement("option");
    option.value = categoria.id;
    option.textContent = `${categoria.emoji || "🏷️"} ${categoria.nome}`;
    select.appendChild(option);
  });
}

function atualizarCampoSelecaoProduto() {
  const select = document.getElementById("produtoCategoria");
  const label = document.getElementById("produtoSaboresLabel");
  if (!select || !label) return;

  const categoria = categoriaPorId(select.value);
  const titulo = categoria?.tituloSelecao || "Escolha uma opção";
  const textoCurto = titulo
    .replace(/^escolha\s+(o|a|um|uma)\s+/i, "")
    .replace(/^selecione\s+(o|a|um|uma)\s+/i, "")
    .trim();

  const nomeCampo = textoCurto ? textoCurto.charAt(0).toUpperCase() + textoCurto.slice(1) : "Opções";

  const input = label.querySelector("input");
  label.firstChild.textContent = `${nomeCampo} `;
  label.querySelector("small").textContent = "separe por vírgula";
  label.appendChild(input);
}

function criarVariacaoAdminItem(variacao = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'variacao-item';
  wrapper.dataset.variacaoId = variacao.id || gerarId(variacao.nome || 'variacao');

  const nomeLabel = document.createElement('label');
  nomeLabel.textContent = 'Nome da variação';
  const nomeInput = document.createElement('input');
  nomeInput.type = 'text';
  nomeInput.dataset.key = 'nome';
  nomeInput.value = variacao.nome || '';
  nomeLabel.appendChild(nomeInput);

  const ingredientesLabel = document.createElement('label');
  ingredientesLabel.className = 'full variacao-ingredientes-label';
  ingredientesLabel.textContent = 'Ingredientes desta opção';

  const ingredientesInput = document.createElement('textarea');
  ingredientesInput.dataset.key = 'ingredientes';
  ingredientesInput.placeholder = 'Ex: frango, milho, temperos';
  ingredientesInput.value = Array.isArray(variacao.ingredientes)
    ? variacao.ingredientes.join(', ')
    : (variacao.ingredientes || '');

  ingredientesLabel.appendChild(ingredientesInput);

  const precoLabel = document.createElement('label');
  precoLabel.textContent = 'Preço';
  const precoInput = document.createElement('input');
  precoInput.type = 'number';
  precoInput.step = '0.01';
  precoInput.dataset.key = 'preco';
  precoInput.value = variacao.preco != null ? variacao.preco : '';
  precoLabel.appendChild(precoInput);

  const estoqueLabel = document.createElement('label');
  estoqueLabel.textContent = 'Estoque';
  const estoqueInput = document.createElement('input');
  estoqueInput.type = 'number';
  estoqueInput.dataset.key = 'estoque';
  estoqueInput.placeholder = 'Opcional';
  estoqueInput.value = variacao.estoque != null ? variacao.estoque : '';
  estoqueLabel.appendChild(estoqueInput);

  const minLabel = document.createElement('label');
  minLabel.textContent = 'Mínimo';
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.dataset.key = 'minimo';
  minInput.value = variacao.minimo != null ? variacao.minimo : 0;
  minLabel.appendChild(minInput);

  const ativaLabel = document.createElement('label');
  ativaLabel.className = 'check';
  const ativaInput = document.createElement('input');
  ativaInput.type = 'checkbox';
  ativaInput.dataset.key = 'ativa';
  ativaInput.checked = variacao.ativa !== false;
  ativaLabel.appendChild(ativaInput);
  ativaLabel.appendChild(document.createTextNode(' Variação ativa'));

  const sobLabel = document.createElement('label');
  sobLabel.className = 'check';
  const sobInput = document.createElement('input');
  sobInput.type = 'checkbox';
  sobInput.dataset.key = 'sob-encomenda';
  sobInput.checked = variacao.sobEncomenda === true;
  sobLabel.appendChild(sobInput);
  sobLabel.appendChild(document.createTextNode(' Sob encomenda'));

  const actions = document.createElement('div');
  actions.className = 'actions';
  const btnRemover = document.createElement('button');
  btnRemover.type = 'button';
  btnRemover.textContent = 'Remover';
  btnRemover.addEventListener('click', () => wrapper.remove());
  actions.appendChild(btnRemover);

  wrapper.appendChild(nomeLabel);
  wrapper.appendChild(ingredientesLabel);
  wrapper.appendChild(precoLabel);
  wrapper.appendChild(estoqueLabel);
  wrapper.appendChild(minLabel);
  wrapper.appendChild(ativaLabel);
  wrapper.appendChild(sobLabel);
  wrapper.appendChild(actions);

  return wrapper;
}

function renderVariacoesAdmin() {
  const container = document.getElementById('variacoesAdminList');
  if (!container) return;
  container.innerHTML = '';

  const variacoes = produtoEditando?.variacoes || [];
  variacoes.forEach(variacao => container.appendChild(criarVariacaoAdminItem(variacao)));
}

function lerVariacoesAdmin() {
  const container = document.getElementById('variacoesAdminList');
  if (!container) return [];

  return Array.from(container.querySelectorAll('.variacao-item')).map(item => {
    const nome = item.querySelector('input[data-key="nome"]').value.trim();
    const preco = Number(item.querySelector('input[data-key="preco"]').value || 0);
    const ingredientes = limparTexto(item.querySelector('[data-key="ingredientes"]')?.value || "")
      .split(",")
      .map(i => limparTexto(i))
      .filter(Boolean);
    const estoqueValor = item.querySelector('input[data-key="estoque"]').value;
    const estoque = estoqueValor === "" ? 0 : Number(estoqueValor || 0);
    const minimo = Number(item.querySelector('input[data-key="minimo"]').value || 0);
    const ativa = item.querySelector('input[data-key="ativa"]').checked;
    const sobEncomenda = item.querySelector('input[data-key="sob-encomenda"]').checked;

    return {
      id: item.dataset.variacaoId || gerarId(nome || 'variacao'),
      nome,
      preco,
      ingredientes,
      estoque,
      minimo,
      ativa,
      sobEncomenda
    };
  }).filter(v => v.nome && v.preco > 0);
}

function abrirModalProduto(id = null) {
  produtoEditando = id ? produtos.find(p => p.id === id) : null;

  preencherSelectCategorias();

  document.getElementById("modalTitulo").textContent = produtoEditando ? "Editar produto" : "Novo produto";
  document.getElementById("produtoNome").value = produtoEditando?.nome || "";
  document.getElementById("produtoCategoria").value = produtoEditando?.categoria || "salgados";
  atualizarCampoSelecaoProduto();
  document.getElementById("produtoPreco").value = produtoEditando?.preco || "";
  document.getElementById("produtoEmoji").value = produtoEditando?.emoji || "";
  document.getElementById("produtoDescricao").value = produtoEditando?.descricao || "";

  const ingredientesEditando = Array.isArray(produtoEditando?.ingredientes)
    ? produtoEditando.ingredientes.join(", ")
    : (produtoEditando?.ingredientes || "");
  const ingredientesCampo = document.getElementById("produtoIngredientes");
  if (ingredientesCampo) ingredientesCampo.value = ingredientesEditando;

  document.getElementById("produtoSabores").value = produtoEditando?.sabores?.join(", ") || "";
  document.getElementById("produtoEstoque").value = produtoEditando?.estoque ?? 40;
  document.getElementById("produtoMinimo").value = produtoEditando?.minimo ?? 5;
  document.getElementById("produtoAtivo").checked = produtoEditando?.ativo ?? true;
  document.getElementById("produtoDestaque").checked = produtoEditando?.destaque ?? false;
  document.getElementById("produtoSobEncomenda").checked = produtoEditando?.sobEncomenda ?? false;

  // imagem preview & file input
  const fileEl = document.getElementById('produtoImagemFile');
  const preview = document.getElementById('produtoImagemPreview');
  if (fileEl) {
    fileEl.value = '';
    fileEl.onchange = () => {
      const f = fileEl.files && fileEl.files[0];
      if (f && preview) preview.src = URL.createObjectURL(f);
    };
  }
  if (preview) preview.src = produtoEditando?.imagem || '';

  renderVariacoesAdmin();

  const btnAdicionar = document.getElementById('btnAdicionarVariacao');
  if (btnAdicionar) {
    btnAdicionar.onclick = () => {
      const lista = document.getElementById('variacoesAdminList');
      if (lista) lista.appendChild(criarVariacaoAdminItem());
    };
  }

  const statusIA = document.getElementById("statusIA");
  if (statusIA) statusIA.textContent = "";

  document.getElementById("modalProduto").classList.add("aberto");
}

function fecharModalProduto() {
  produtoEditando = null;
  document.getElementById("modalProduto").classList.remove("aberto");
}

async function gerarProdutoComIA() {
  const nome = limparTexto(document.getElementById("produtoNome").value);
  const status = document.getElementById("statusIA");

  if (!nome) {
    alert("Digite o nome do produto primeiro.");
    return;
  }

  try {
    status.textContent = "Gerando sugestão...";

    const s = await sugerirProdutoComIA(nome);

    if (s.nome) document.getElementById("produtoNome").value = s.nome;
    if (s.categoria) document.getElementById("produtoCategoria").value = s.categoria;
    if (s.emoji) document.getElementById("produtoEmoji").value = s.emoji;
    if (s.descricao) document.getElementById("produtoDescricao").value = s.descricao;
    if (s.preco) document.getElementById("produtoPreco").value = s.preco;
    if (Array.isArray(s.sabores)) document.getElementById("produtoSabores").value = s.sabores.join(", ");
    if (typeof s.sobEncomenda === "boolean") document.getElementById("produtoSobEncomenda").checked = s.sobEncomenda;
    if (typeof s.destaque === "boolean") document.getElementById("produtoDestaque").checked = s.destaque;

    status.textContent = "Sugestão aplicada. Confira antes de salvar.";
  } catch (erro) {
    console.error(erro);
    status.textContent = "";
    alert("Não foi possível usar a IA agora. Se estiver local, teste pela Vercel com GEMINI_API_KEY configurada.");
  }
}

async function salvarProdutoAdmin() {
  const nome = limparTexto(document.getElementById("produtoNome").value);
  const preco = Number(document.getElementById("produtoPreco").value || 0);

  if (!nome) {
    alert("Digite o nome do produto.");
    return;
  }

  const sabores = limparTexto(document.getElementById("produtoSabores").value)
    .split(",")
    .map(s => limparTexto(s))
    .filter(Boolean);

  const variacoes = lerVariacoesAdmin();

  const ingredientes = limparTexto(document.getElementById("produtoIngredientes")?.value || "")
    .split(",")
    .map(i => limparTexto(i))
    .filter(Boolean);

  if (preco <= 0 && variacoes.length === 0) {
    alert("Digite um preço válido ou adicione variações com preço.");
    return;
  }

  const id = produtoEditando?.id || gerarId(nome);
  const sobEncomenda = document.getElementById("produtoSobEncomenda").checked;

  // montar objeto produto
  const produtoObj = {
    id,
    nome,
    categoria: document.getElementById("produtoCategoria").value,
    preco,
    emoji: document.getElementById("produtoEmoji").value || "🍽️",
    descricao: document.getElementById("produtoDescricao").value || "",
    ingredientes,
    sabores,
    estoque: sobEncomenda ? 0 : Number(document.getElementById("produtoEstoque").value || 0),
    minimo: sobEncomenda ? 0 : Number(document.getElementById("produtoMinimo").value || 0),
    ativo: document.getElementById("produtoAtivo").checked,
    destaque: document.getElementById("produtoDestaque").checked,
    sobEncomenda,
    variacoes,
    ordem: produtoEditando?.ordem || Date.now()
  };

  // upload de imagem se houver arquivo selecionado
  try {
    const fileEl = document.getElementById('produtoImagemFile');
    if (fileEl && fileEl.files && fileEl.files[0]) {
      const file = fileEl.files[0];
      const path = `produtos/${id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      produtoObj.imagem = url;
    } else if (produtoEditando?.imagem) {
      produtoObj.imagem = produtoEditando.imagem;
    }
  } catch (err) {
    console.error('Erro ao enviar imagem:', err);
    alert('Falha ao enviar imagem. O produto será salvo sem alteração da imagem.');
  }

  await salvarProduto(produtoObj);
  fecharModalProduto();
}

async function alternarAtivo(id) {
  const produto = produtos.find(p => p.id === id);
  if (!produto) return;

  await atualizarProduto(id, { ativo: produto.ativo === false });
}

async function excluirProdutoAdmin(id) {
  const produto = produtos.find(p => p.id === id);
  if (!produto) return;

  if (!confirm(`Excluir ${produto.nome}?`)) return;

  await excluirProduto(id);
}

function renderVendaRapida() {
  const box = document.getElementById("listaVendaRapida");
  if (!box) return;

  const busca = (document.getElementById("buscaVenda")?.value || "").toLowerCase();

  box.innerHTML = "";

  produtos
    .filter(p => p.ativo !== false)
    .filter(p => p.nome.toLowerCase().includes(busca) || p.categoria.includes(busca))
    .forEach(p => {
      const item = document.createElement('div'); item.className = 'venda-item';
      const info = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = `${p.emoji || '🍽️'} ${p.nome}`; info.appendChild(strong);
      const meta = document.createElement('p'); meta.textContent = `${formatarMoeda(p.preco)} · Estoque: ${p.sobEncomenda ? 'encomenda' : (p.estoque || 0)}`; info.appendChild(meta);
      const btn = document.createElement('button'); btn.textContent = 'Adicionar'; btn.addEventListener('click', () => window.adicionarVendaRapida && window.adicionarVendaRapida(p.id));
      item.appendChild(info); item.appendChild(btn);
      box.appendChild(item);
    });

  renderVendaAtual();
}

function adicionarVendaRapida(id) {
  const produto = produtos.find(p => p.id === id);
  if (!produto) return;

  const item = vendaAtual.find(i => i.id === id);

  const estoque = Number(produto.estoque || 0);
  if (!produto.sobEncomenda && (!estoque || (item?.quantidade || 0) >= estoque)) {
    alert("Quantidade maxima disponivel no estoque.");
    return;
  }

  if (item) item.quantidade++;
  else vendaAtual.push({
    id: produto.id,
    nome: produto.nome,
    preco: produto.preco,
    quantidade: 1,
    estoqueAtual: produto.estoque || 0
  });

  renderVendaAtual();
}

function renderVendaAtual() {
  const box = document.getElementById("itensVendaRapida");
  if (!box) return;

  box.innerHTML = '';

  if (!vendaAtual.length) {
    const p = document.createElement('p'); p.textContent = 'Nenhum item.'; box.appendChild(p);
  }

  vendaAtual.forEach(item => {
    const wrapper = document.createElement('div'); wrapper.className = 'item-venda-atual';
    const left = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = `${item.quantidade}x ${item.nome}`; left.appendChild(strong);
    const meta = document.createElement('p'); meta.textContent = formatarMoeda(item.preco * item.quantidade); left.appendChild(meta);
    const right = document.createElement('div');
    const btnMinus = document.createElement('button'); btnMinus.textContent = '-'; btnMinus.addEventListener('click', () => window.alterarVendaItem && window.alterarVendaItem(item.id, -1));
    const btnPlus = document.createElement('button'); btnPlus.textContent = '+'; btnPlus.addEventListener('click', () => window.alterarVendaItem && window.alterarVendaItem(item.id, 1));
    right.appendChild(btnMinus); right.appendChild(btnPlus);
    wrapper.appendChild(left); wrapper.appendChild(right);
    box.appendChild(wrapper);
  });

  const total = vendaAtual.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
  document.getElementById("totalVendaRapida").textContent = formatarMoeda(total);
}

function alterarVendaItem(id, valor) {
  const item = vendaAtual.find(i => i.id === id);
  if (!item) return;

  const produto = produtos.find(produto => produto.id === id);
  const proximaQuantidade = item.quantidade + valor;
  if (valor > 0 && !produto?.sobEncomenda && proximaQuantidade > Number(produto?.estoque || 0)) {
    alert("Quantidade maxima disponivel no estoque.");
    return;
  }

  item.quantidade = proximaQuantidade;

  if (item.quantidade <= 0) vendaAtual = vendaAtual.filter(i => i.id !== id);

  renderVendaAtual();
}

function limparVendaRapida() {
  if (!vendaAtual.length) return;

  if (!confirm("Limpar venda atual?")) return;

  vendaAtual = [];
  renderVendaAtual();
}

function finalizarVendaRapida() {
  if (!vendaAtual.length) {
    alert("Adicione pelo menos um produto.");
    return;
  }

  const pagamento = document.getElementById("formaPagamentoVenda").value;
  const observacao = limparTexto(document.getElementById("obsVenda").value);
  const total = vendaAtual.reduce((soma, item) => soma + item.preco * item.quantidade, 0);

  const resumo = document.getElementById('resumoConfirmacaoVenda');
  resumo.innerHTML = '';

  vendaAtual.forEach(item => {
    const wrapper = document.createElement('div'); wrapper.className = 'item-venda-atual';
    const left = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = `${item.quantidade}x ${item.nome}`; left.appendChild(strong);
    const meta = document.createElement('p'); meta.textContent = formatarMoeda(item.preco * item.quantidade); left.appendChild(meta);
    wrapper.appendChild(left);
    resumo.appendChild(wrapper);
  });

  const confirmTotal = document.createElement('div'); confirmTotal.className = 'confirm-total';
  const pPag = document.createElement('p'); const sPag = document.createElement('strong'); sPag.textContent = 'Pagamento:'; pPag.appendChild(sPag); pPag.appendChild(document.createTextNode(' ' + pagamento)); confirmTotal.appendChild(pPag);
  if (observacao) { const pObs = document.createElement('p'); const sObs = document.createElement('strong'); sObs.textContent = 'Observação:'; pObs.appendChild(sObs); pObs.appendChild(document.createTextNode(' ' + observacao)); confirmTotal.appendChild(pObs); }
  const pTotal = document.createElement('p'); const sTotal = document.createElement('strong'); sTotal.textContent = 'Total:'; pTotal.appendChild(sTotal); pTotal.appendChild(document.createTextNode(' ' + formatarMoeda(total))); confirmTotal.appendChild(pTotal);
  resumo.appendChild(confirmTotal);

  document.getElementById("modalConfirmarVenda").classList.add("aberto");
}

function fecharConfirmacaoVenda() {
  document.getElementById("modalConfirmarVenda").classList.remove("aberto");
}

async function confirmarFinalizacaoVenda() {
  const pagamento = document.getElementById("formaPagamentoVenda").value;
  const observacao = limparTexto(document.getElementById("obsVenda").value);
  const total = vendaAtual.reduce((soma, item) => soma + item.preco * item.quantidade, 0);

  try {
    await registrarVendaRapida({ itens: vendaAtual, pagamento, total, observacao });
  } catch (error) {
    console.error(error);
    alert(error.message || "Nao foi possivel registrar a venda.");
    return;
  }

  fecharConfirmacaoVenda();

  const msg = document.getElementById('mensagemVenda');
  msg.style.display = 'block';
  msg.innerHTML = '';
  const strong = document.createElement('strong'); strong.textContent = 'Venda registrada!'; msg.appendChild(strong);
  msg.appendChild(document.createElement('br'));
  msg.appendChild(document.createTextNode('Total: ' + formatarMoeda(total)));
  msg.appendChild(document.createElement('br'));
  msg.appendChild(document.createTextNode('Pagamento: ' + pagamento));
  msg.appendChild(document.createElement('br'));
  msg.appendChild(document.createTextNode('Estoque descontado automaticamente.'));

  vendaAtual = [];
  document.getElementById("obsVenda").value = "";
  renderVendaAtual();
}

function renderCaixa() {
  const box = document.getElementById("resumoCaixa");
  const hist = document.getElementById("historicoVendas");

  if (!box || !hist) return;

  const resumo = resumoCaixa(vendasHoje);

  box.innerHTML = '';
  const keys = ['Pix', 'Dinheiro', 'Cartão débito', 'Cartão crédito'];
  keys.forEach(k => {
    const card = document.createElement('div'); card.className = 'caixa-card';
    const span = document.createElement('span'); span.textContent = k; card.appendChild(span);
    const strong = document.createElement('strong'); strong.textContent = formatarMoeda(resumo[k] || 0); card.appendChild(strong);
    box.appendChild(card);
  });
  const totalCard = document.createElement('div'); totalCard.className = 'caixa-card'; totalCard.appendChild(Object.assign(document.createElement('span'), { textContent: 'Total' })); totalCard.appendChild(Object.assign(document.createElement('strong'), { textContent: formatarMoeda(resumo.Total) })); box.appendChild(totalCard);
  const vendasCard = document.createElement('div'); vendasCard.className = 'caixa-card'; vendasCard.appendChild(Object.assign(document.createElement('span'), { textContent: 'Vendas' })); vendasCard.appendChild(Object.assign(document.createElement('strong'), { textContent: resumo.Quantidade })); box.appendChild(vendasCard);

  hist.innerHTML = '';

  if (!vendasHoje.length) {
    const p = document.createElement('p'); p.textContent = 'Nenhuma venda registrada hoje.'; hist.appendChild(p);
  }

  vendasHoje.forEach(venda => {
    const itens = (venda.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(', ');
    const wrapper = document.createElement('div'); wrapper.className = 'venda-historico';
    const strong = document.createElement('strong'); strong.textContent = `${venda.hora || '--:--'} - ${formatarMoeda(venda.total)}`; wrapper.appendChild(strong);
    const small1 = document.createElement('small'); small1.textContent = itens; wrapper.appendChild(small1);
    const detalhesPagamento = Array.isArray(venda.pagamentos) && venda.pagamentos.length
      ? venda.pagamentos.map(item => `${item.tipo}: ${formatarMoeda(item.valor)}`).join(" + ")
      : venda.pagamento;
    const small2 = document.createElement('small'); small2.textContent = detalhesPagamento + (venda.observacao ? ' · ' + venda.observacao : ''); wrapper.appendChild(small2);
    const actions = document.createElement('div'); actions.className = 'venda-historico-actions';
    const btn = document.createElement('button'); btn.className = 'delete-venda'; btn.textContent = 'Apagar venda'; btn.addEventListener('click', () => window.excluirVendaDoHistorico && window.excluirVendaDoHistorico(venda.id));
    actions.appendChild(btn); wrapper.appendChild(actions);
    hist.appendChild(wrapper);
  });
}

async function excluirVendaDoHistorico(id) {
  const venda = vendasHoje.find(v => v.id === id);

  if (!venda) {
    alert("Venda não encontrada.");
    return;
  }

  const itens = (venda.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(", ");

  const confirmou = confirm(
    `Apagar esta venda?\n\n${itens}\nTotal: ${formatarMoeda(venda.total)}\nPagamento: ${venda.pagamento}\n\nO estoque será restaurado para o valor anterior à venda.`
  );

  if (!confirmou) return;

  await excluirVendaComEstorno(venda);
  alert("Venda apagada e estoque restaurado.");
}

function preencherSelectProdutosPromocao() {
  const select = document.getElementById("promoProduto");
  if (!select) return;
  select.innerHTML = '';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '-- Selecione um produto (ou deixe em branco para aplicar por categoria) --';
  select.appendChild(noneOpt);

  produtos
    .filter(p => p.ativo !== false)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.emoji || '🍽️'} ${p.nome} - ${formatarMoeda(p.preco)}`;
      select.appendChild(opt);
    });
}

function abrirModalPromocao(id = null) {
  promocaoEditando = id ? promocoes.find(p => p.id === id) : null;

  preencherSelectProdutosPromocao();

  document.getElementById("modalTituloPromocao").textContent = promocaoEditando ? "Editar promoção" : "Nova promoção";
  document.getElementById("promoTitulo").value = promocaoEditando?.titulo || "";
  document.getElementById("promoAtiva").value = String(promocaoEditando?.ativa ?? true);
  document.getElementById("promoProduto").value = promocaoEditando?.produtoId || "";
  document.getElementById("promoCategoria").value = promocaoEditando?.categoria || "";
  document.getElementById("promoVariacao").value = promocaoEditando?.variacaoId || "";
  document.getElementById("promoPreco").value = promocaoEditando?.precoPromocional || "";
  document.getElementById("promoDescricao").value = promocaoEditando?.descricao || "";
  document.getElementById("promoInicio").value = promocaoEditando?.inicio || "";
  document.getElementById("promoFim").value = promocaoEditando?.fim || "";

  document.getElementById("modalPromocao").classList.add("aberto");
}

function fecharModalPromocao() {
  promocaoEditando = null;
  document.getElementById("modalPromocao").classList.remove("aberto");
}

async function salvarPromocaoAdmin() {
  const titulo = limparTexto(document.getElementById("promoTitulo").value);
  const produtoId = document.getElementById("promoProduto").value;
  const categoria = document.getElementById("promoCategoria").value;
  const variacaoId = document.getElementById("promoVariacao").value;
  const precoPromocional = Number(document.getElementById("promoPreco").value || 0);
  const produto = produtos.find(p => p.id === produtoId);

  if (!titulo) {
    alert("Digite o título da promoção.");
    return;
  }

  if (!produtoId && !categoria) {
    alert("Escolha um produto ou uma categoria.");
    return;
  }

  if (variacaoId && !produtoId) {
    alert("Selecione um produto antes da variação.");
    return;
  }

  if (precoPromocional <= 0) {
    alert("Digite um preço promocional válido.");
    return;
  }

  const id = promocaoEditando?.id || gerarId(titulo);
  const variacaoOriginal = produto?.variacoes?.find(v => v.id === variacaoId);
  const precoOriginal = variacaoOriginal ? Number(variacaoOriginal.preco || produto.preco) : Number(produto?.preco || 0);

  await salvarPromocao({
    id,
    titulo,
    produtoId: produtoId || null,
    categoria: categoria || null,
    variacaoId: variacaoId || null,
    produtoNome: produto?.nome || null,
    produtoEmoji: produto?.emoji || "🍽️",
    precoOriginal,
    precoPromocional,
    descricao: limparTexto(document.getElementById("promoDescricao").value),
    inicio: document.getElementById("promoInicio").value,
    fim: document.getElementById("promoFim").value,
    ativa: document.getElementById("promoAtiva").value === "true",
    criadoEm: promocaoEditando?.criadoEm || null
  });

  fecharModalPromocao();
}

function renderPromocoesAdmin() {
  const box = document.getElementById("listaPromocoes");
  if (!box) return;

  box.innerHTML = "";

  if (!promocoes.length) {
    const p = document.createElement('p'); p.textContent = 'Nenhuma promoção cadastrada ainda.'; box.appendChild(p); return;
  }

  promocoes.forEach(promo => {
    const card = createPromoAdminCard(promo, formatarMoeda);
    box.appendChild(card);
  });
}

async function alternarPromocao(id) {
  const promo = promocoes.find(p => p.id === id);
  if (!promo) return;

  await atualizarPromocao(id, { ativa: !promo.ativa });
}

async function excluirPromocaoAdmin(id) {
  const promo = promocoes.find(p => p.id === id);
  if (!promo) return;

  if (!confirm(`Excluir a promoção "${promo.titulo}"?`)) return;

  await excluirPromocao(id);
}
const diasAtendimento = [
  { id: "segunda", nome: "Segunda" },
  { id: "terca", nome: "Terça" },
  { id: "quarta", nome: "Quarta" },
  { id: "quinta", nome: "Quinta" },
  { id: "sexta", nome: "Sexta" },
  { id: "sabado", nome: "Sábado" },
  { id: "domingo", nome: "Domingo" }
];

let timerSalvarHorarios = null;

function renderHorariosAtendimento() {
  const box = document.getElementById("horariosAtendimento");
  if (!box) return;

  box.innerHTML = "";

  const horarios = lojaConfig.horariosAtendimento || {};

  diasAtendimento.forEach(dia => {
    const configDia = horarios[dia.id] || {
      fechado: false,
      periodos: [
        { inicio: "", fim: "" },
        { inicio: "", fim: "" }
      ]
    };

    const fechado = configDia.fechado === true;
    const periodos = configDia.periodos || [];

    box.innerHTML += `
      <div class="horario-dia">
        <div class="horario-dia-top">
          <strong>${dia.nome}</strong>
          <button type="button" class="secondary-btn" onclick="copiarHorarioParaTodos('${dia.id}')">Copiar para todos</button>
          <label class="check">
            <input type="checkbox" id="horario-${dia.id}-fechado" ${fechado ? "checked" : ""}>
            Fechado
          </label>
        </div>

        <div class="horario-periodos">
          <label>Início 1
            <input type="time" id="horario-${dia.id}-inicio-1" value="${periodos[0]?.inicio || ""}">
          </label>

          <label>Fim 1
            <input type="time" id="horario-${dia.id}-fim-1" value="${periodos[0]?.fim || ""}">
          </label>

          <label>Início 2
            <input type="time" id="horario-${dia.id}-inicio-2" value="${periodos[1]?.inicio || ""}">
          </label>

          <label>Fim 2
            <input type="time" id="horario-${dia.id}-fim-2" value="${periodos[1]?.fim || ""}">
          </label>
        </div>
      </div>
    `;
  });
}

function coletarHorariosAtendimento() {
  const horarios = {};

  diasAtendimento.forEach(dia => {
    const fechado = document.getElementById(`horario-${dia.id}-fechado`)?.checked || false;

    const inicio1 = document.getElementById(`horario-${dia.id}-inicio-1`)?.value || "";
    const fim1 = document.getElementById(`horario-${dia.id}-fim-1`)?.value || "";
    const inicio2 = document.getElementById(`horario-${dia.id}-inicio-2`)?.value || "";
    const fim2 = document.getElementById(`horario-${dia.id}-fim-2`)?.value || "";

    const periodos = [];

    if (inicio1 && fim1) periodos.push({ inicio: inicio1, fim: fim1 });
    if (inicio2 && fim2) periodos.push({ inicio: inicio2, fim: fim2 });

    horarios[dia.id] = {
      fechado,
      periodos
    };
  });

  return horarios;
}

function aplicarHorarioDeUmDiaParaTodos(diaOrigem) {
  const inicio1 = document.getElementById(`horario-${diaOrigem}-inicio-1`)?.value || "";
  const fim1 = document.getElementById(`horario-${diaOrigem}-fim-1`)?.value || "";
  const inicio2 = document.getElementById(`horario-${diaOrigem}-inicio-2`)?.value || "";
  const fim2 = document.getElementById(`horario-${diaOrigem}-fim-2`)?.value || "";
  const fechado = document.getElementById(`horario-${diaOrigem}-fechado`)?.checked || false;

  diasAtendimento.forEach(dia => {
    document.getElementById(`horario-${dia.id}-inicio-1`).value = inicio1;
    document.getElementById(`horario-${dia.id}-fim-1`).value = fim1;
    document.getElementById(`horario-${dia.id}-inicio-2`).value = inicio2;
    document.getElementById(`horario-${dia.id}-fim-2`).value = fim2;
    document.getElementById(`horario-${dia.id}-fechado`).checked = fechado;
  });

  salvarHorariosAutomaticamente();
}

function copiarHorarioParaTodos(diaOrigem) {
  aplicarHorarioDeUmDiaParaTodos(diaOrigem);
}

function copiarSegundaParaTodos() {
  aplicarHorarioDeUmDiaParaTodos("segunda");
}

function salvarHorariosAutomaticamente() {
  clearTimeout(timerSalvarHorarios);

  const status = document.getElementById("statusHorarioAuto");
  if (status) status.textContent = "Salvando horários...";

  timerSalvarHorarios = setTimeout(async () => {
    try {
      const horarios = coletarHorariosAtendimento();

      await salvarConfiguracoes({
        ...lojaConfig,
        horariosAtendimento: horarios
      });

      lojaConfig.horariosAtendimento = horarios;

      if (status) status.textContent = "✅ Horários salvos automaticamente";
    } catch (erro) {
      console.error("Erro ao salvar horários:", erro);
      if (status) status.textContent = "❌ Erro ao salvar horários";
    }
  }, 700);
}

function urlExternaValida(valor = "") {
  if (!valor) return true;
  try {
    const url = new URL(valor);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function numeroConfiguracao(id, padrao, minimo = 0, maximo = 1000) {
  const valor = Number(document.getElementById(id)?.value);
  if (!Number.isFinite(valor)) return padrao;
  return Math.min(maximo, Math.max(minimo, valor));
}

function preencherConfiguracoesLoja() {
  const campos = {
    configNomeLoja: lojaConfig.nomeLoja || "Delícias da Vó",
    configSlogan: lojaConfig.slogan || "Feito com carinho",
    configInstagram: lojaConfig.instagram || "@deliciasda_vo",
    configInstagramNome: lojaConfig.instagramNome || "Instagram da loja",
    configInstagramUrl: lojaConfig.instagramUrl || "",
    configWhatsapp: lojaConfig.whatsapp || "5518991178906",
    configEndereco: lojaConfig.endereco || "",
    configEnderecoNome: lojaConfig.enderecoNome || "Endereço da loja",
    configEnderecoUrl: lojaConfig.enderecoUrl || "",
    configHorario: lojaConfig.horario || "",
    configEntrega: lojaConfig.entrega || "Taxa conforme distância",
    configRetirada: lojaConfig.retirada || "Retirada na loja",
    configTaxaAte3Km: Number(lojaConfig.taxasEntrega?.ate3Km ?? 5),
    configTaxaAte5Km: Number(lojaConfig.taxasEntrega?.ate5Km ?? 7),
    configLimiteEntregaKm: Number(lojaConfig.taxasEntrega?.limiteKm ?? 5),
    configStatusLoja: lojaConfig.statusLoja || "aberta",
    cardapioDiaTituloInput: lojaConfig.cardapioDia?.titulo || "Cardápio de hoje",
    cardapioDiaItensInput: Array.isArray(lojaConfig.cardapioDia?.itens) ? lojaConfig.cardapioDia.itens.join("\n") : "",
    cardapioDiaObsInput: lojaConfig.cardapioDia?.observacao || "Disponível enquanto durar",
  };

  Object.entries(campos).forEach(([id, valor]) => {
    const el = document.getElementById(id);
    if (el) el.value = valor;
  });

  const cardapioAtivo = document.getElementById("cardapioDiaAtivo");
  if (cardapioAtivo) cardapioAtivo.checked = lojaConfig.cardapioDia?.ativo === true;

  renderHorariosAtendimento();
}

async function salvarConfiguracoesLoja() {
  const instagramUrl = limparTexto(document.getElementById("configInstagramUrl")?.value || "");
  const enderecoUrl = limparTexto(document.getElementById("configEnderecoUrl")?.value || "");

  if (!urlExternaValida(instagramUrl)) {
    alert("Digite um link completo e válido do Instagram, começando com https://");
    document.getElementById("configInstagramUrl")?.focus();
    return;
  }

  if (!urlExternaValida(enderecoUrl)) {
    alert("Digite um link completo e válido do Google Maps, começando com https://");
    document.getElementById("configEnderecoUrl")?.focus();
    return;
  }

  const dados = {
    nomeLoja: limparTexto(document.getElementById("configNomeLoja").value) || "Delícias da Vó",
    slogan: limparTexto(document.getElementById("configSlogan").value),
    instagram: limparTexto(document.getElementById("configInstagram").value),
    instagramNome: limparTexto(document.getElementById("configInstagramNome")?.value) || "Instagram da loja",
    instagramUrl,
    whatsapp: limparTexto(document.getElementById("configWhatsapp").value) || "5518991178906",
    endereco: limparTexto(document.getElementById("configEndereco").value),
    enderecoNome: limparTexto(document.getElementById("configEnderecoNome")?.value) || "Endereço da loja",
    enderecoUrl,
    horario: limparTexto(document.getElementById("configHorario").value),
    entrega: limparTexto(document.getElementById("configEntrega").value),
    retirada: limparTexto(document.getElementById("configRetirada").value),
    taxasEntrega: {
      ate3Km: numeroConfiguracao("configTaxaAte3Km", 5, 0, 500),
      ate5Km: numeroConfiguracao("configTaxaAte5Km", 7, 0, 500),
      limiteKm: numeroConfiguracao("configLimiteEntregaKm", 5, 3, 100)
    },
   statusLoja: document.getElementById("configStatusLoja").value,
horariosAtendimento: coletarHorariosAtendimento(),
    cardapioDia: {
      ativo: document.getElementById("cardapioDiaAtivo")?.checked || false,
      titulo: limparTexto(document.getElementById("cardapioDiaTituloInput")?.value) || "Cardápio de hoje",
      itens: (document.getElementById("cardapioDiaItensInput")?.value || "")
        .split("\n")
        .map(item => limparTexto(item))
        .filter(Boolean),
      observacao: limparTexto(document.getElementById("cardapioDiaObsInput")?.value) || ""
    }
  };

  await salvarConfiguracoes(dados);

  const status = document.getElementById('statusConfig');
  status.style.display = 'block';
  status.innerHTML = '';
  const sStrong = document.createElement('strong'); sStrong.textContent = 'Configurações salvas!'; status.appendChild(sStrong);
  status.appendChild(document.createElement('br'));
  status.appendChild(document.createTextNode('As alterações serão usadas no sistema.'));  
  setTimeout(() => status.style.display = 'none', 4000);
}
window.criarProdutosBase = criarProdutosBase;
window.iniciarAdminDepoisLogin = iniciarAdminDepoisLogin;
window.abrirAba = abrirAba;
window.abrirAbaPorNome = abrirAbaPorNome;
window.alternarMenuAdmin = alternarMenuAdmin;
window.fecharMenuAdmin = fecharMenuAdmin;
window.renderProdutosAdmin = renderProdutosAdmin;
window.abrirModalProduto = abrirModalProduto;
window.fecharModalProduto = fecharModalProduto;
window.gerarProdutoComIA = gerarProdutoComIA;
window.salvarProdutoAdmin = salvarProdutoAdmin;
window.alternarAtivo = alternarAtivo;
window.excluirProdutoAdmin = excluirProdutoAdmin;
window.renderVendaRapida = renderVendaRapida;
window.adicionarVendaRapida = adicionarVendaRapida;
window.alterarVendaItem = alterarVendaItem;
window.limparVendaRapida = limparVendaRapida;
window.finalizarVendaRapida = finalizarVendaRapida;
window.fecharConfirmacaoVenda = fecharConfirmacaoVenda;
window.confirmarFinalizacaoVenda = confirmarFinalizacaoVenda;
window.excluirVendaDoHistorico = excluirVendaDoHistorico;
window.abrirModalPromocao = abrirModalPromocao;
window.fecharModalPromocao = fecharModalPromocao;
window.salvarPromocaoAdmin = salvarPromocaoAdmin;
window.renderPromocoesAdmin = renderPromocoesAdmin;
window.alternarPromocao = alternarPromocao;
window.excluirPromocaoAdmin = excluirPromocaoAdmin;
window.abrirModalCategoria = abrirModalCategoria;
window.fecharModalCategoria = fecharModalCategoria;
window.salvarCategoriaAdmin = salvarCategoriaAdmin;
window.atualizarCampoSelecaoProduto = atualizarCampoSelecaoProduto;
window.salvarConfiguracoesLoja = salvarConfiguracoesLoja;
window.copiarHorarioParaTodos = copiarHorarioParaTodos;
window.copiarSegundaParaTodos = copiarSegundaParaTodos;


function renderFestasAdmin(erro = null) {
  const box = document.getElementById("listaFestaAdmin");
  if (!box) return;

  const busca = (document.getElementById("buscaFestaAdmin")?.value || "").trim().toLowerCase();
  const filtro = document.getElementById("filtroFestaAdmin")?.value || "todos";

  const lista = [...salgadosFesta]
    .sort((a, b) => Number(a.ordem || 99) - Number(b.ordem || 99) || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
    .filter((p) => {
      const texto = `${p.nome || ""} ${(p.sabores || []).join(" ")} ${p.descricao || ""}`.toLowerCase();
      const correspondeBusca = !busca || texto.includes(busca);
      const correspondeFiltro =
        filtro === "todos" ||
        (filtro === "fritos" && p.categoria !== "assados") ||
        (filtro === "assados" && p.categoria === "assados") ||
        (filtro === "ativos" && p.ativo !== false) ||
        (filtro === "inativos" && p.ativo === false);
      return correspondeBusca && correspondeFiltro;
    });

  const total = salgadosFesta.length;
  const ativos = salgadosFesta.filter((p) => p.ativo !== false).length;
  const fritos = salgadosFesta.filter((p) => p.categoria !== "assados").length;
  const assados = salgadosFesta.filter((p) => p.categoria === "assados").length;
  const resumo = {
    festaTotalProdutos: total,
    festaTotalAtivos: ativos,
    festaTotalFritos: fritos,
    festaTotalAssados: assados,
  };
  Object.entries(resumo).forEach(([id, valor]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  });

  box.innerHTML = "";

  if (!lista.length) {
    const vazio = document.createElement("div");
    vazio.className = "festas-empty-state";
    vazio.innerHTML = `<span>🥟</span><strong>Nenhum produto encontrado</strong><p>Tente mudar a pesquisa ou o filtro selecionado.</p>`;
    box.appendChild(vazio);
  }

  lista.forEach((p) => {
    const ativo = p.ativo !== false;
    const assado = p.categoria === "assados";
    const sabores = Array.isArray(p.sabores) ? p.sabores : [];

    const card = document.createElement("article");
    card.className = `festa-admin-card ${ativo ? "is-active" : "is-inactive"}`;

    const topo = document.createElement("div");
    topo.className = "festa-card-top";

    const identidade = document.createElement("div");
    identidade.className = "festa-identidade";
    identidade.innerHTML = `
      <span class="festa-emoji">${p.emoji || "🥟"}</span>
      <div>
        <h3>${p.nome || "Produto sem nome"}</h3>
        <div class="festa-badges">
          <span class="festa-tipo ${assado ? "tipo-assado" : "tipo-frito"}">${assado ? "🔥 Assado" : "🍳 Frito"}</span>
          <span class="festa-status ${ativo ? "status-ativo" : "status-inativo"}">${ativo ? "● Ativo" : "● Inativo"}</span>
          <span class="festa-origem ${p.__origem === "firestore" ? "origem-firestore" : "origem-codigo"}">${p.__origem === "firestore" ? "☁️ Salvo no Firestore" : "💻 Somente no código"}</span>
        </div>
      </div>`;

    const ordem = document.createElement("span");
    ordem.className = "festa-ordem";
    ordem.title = "Ordem de exibição";
    ordem.textContent = `#${Number(p.ordem || 99)}`;
    topo.append(identidade, ordem);

    const conteudo = document.createElement("div");
    conteudo.className = "festa-card-content";

    if (p.descricao) {
      const descricao = document.createElement("p");
      descricao.className = "festa-descricao";
      descricao.textContent = p.descricao;
      conteudo.appendChild(descricao);
    }

    const quantidadeInfo = document.createElement("div");
    quantidadeInfo.className = "festa-quantidade-info";
    quantidadeInfo.innerHTML = `<span>📦 A partir de <b>${Number(p.quantidadeInicial || 50)}</b></span><span>➕ De <b>${Number(p.incrementoQuantidade || 50)} em ${Number(p.incrementoQuantidade || 50)}</b></span><span>🔢 Até <b>${Number(p.quantidadeMaxima || 500)}</b></span>`;
    conteudo.appendChild(quantidadeInfo);

    const tituloSabores = document.createElement("span");
    tituloSabores.className = "festa-sabores-titulo";
    tituloSabores.textContent = sabores.length ? `${sabores.length} sabor(es)` : "Sem sabores cadastrados";
    conteudo.appendChild(tituloSabores);

    if (sabores.length) {
      const chips = document.createElement("div");
      chips.className = "festa-sabores";
      sabores.forEach((sabor) => {
        const chip = document.createElement("span");
        chip.textContent = sabor;
        chips.appendChild(chip);
      });
      conteudo.appendChild(chips);
    }

    const acoes = document.createElement("div");
    acoes.className = "festa-card-actions";

    const editar = document.createElement("button");
    editar.className = "festa-btn festa-btn-editar";
    editar.innerHTML = "✏️ <span>Editar</span>";
    editar.onclick = () => abrirModalFesta(p.id);

    const alternar = document.createElement("button");
    alternar.className = `festa-btn ${ativo ? "festa-btn-desativar" : "festa-btn-ativar"}`;
    alternar.innerHTML = ativo ? "⏸️ <span>Desativar</span>" : "▶️ <span>Ativar</span>";
    alternar.onclick = async () => {
      try {
        await salvarSalgadoFesta({ ...p, ativo: !ativo });
      } catch (e) {
        console.error(e);
        alert(descreverErroFirestore(e));
      }
    };

    const excluir = document.createElement("button");
    excluir.className = "festa-btn festa-btn-excluir";
    excluir.innerHTML = "🗑️ <span>Excluir</span>";
    excluir.onclick = async () => {
      if (!confirm(`Excluir ${p.nome}? Esta ação não pode ser desfeita.`)) return;
      try {
        await excluirSalgadoFesta(p.id);
      } catch (e) {
        console.error(e);
        alert(descreverErroFirestore(e));
      }
    };

    acoes.append(editar, alternar, excluir);
    card.append(topo, conteudo, acoes);
    box.appendChild(card);
  });

  const st = document.getElementById("statusFestaAdmin");
  if (st) {
    st.innerHTML = erro
      ? `<span>⚠️</span><div><strong>Não foi possível acessar o Firestore</strong><p>${descreverErroFirestore(erro)} Os produtos padrão continuam aparecendo no site.</p></div>`
      : "";
    st.style.display = erro ? "flex" : "none";
  }
}
function abrirModalFesta(id = null) {
  festaEditando = salgadosFesta.find(p => p.id === id) || null;
  document.getElementById("tituloModalFesta").textContent = festaEditando ? "Editar salgado para festa" : "Novo salgado para festa";
  document.getElementById("festaNome").value = festaEditando?.nome || "";
  document.getElementById("festaEmoji").value = festaEditando?.emoji || "🥟";
  document.getElementById("festaCategoria").value = festaEditando?.categoria || "fritos";
  document.getElementById("festaOrdem").value = Number(festaEditando?.ordem ?? 99);
  document.getElementById("festaQuantidadeInicial").value = Number(festaEditando?.quantidadeInicial ?? 50);
  document.getElementById("festaIncrementoQuantidade").value = Number(festaEditando?.incrementoQuantidade ?? 50);
  document.getElementById("festaQuantidadeMaxima").value = Number(festaEditando?.quantidadeMaxima ?? 500);

  const regraPreco = normalizarPrecoFesta(festaEditando || {
    nome: document.getElementById("festaNome").value,
    categoria: document.getElementById("festaCategoria").value
  });
  const ehEmpadinha = String(festaEditando?.nome || "").toLowerCase().includes("empad");
  document.getElementById("festaTipoPreco").value = ehEmpadinha ? "unitario" : regraPreco.tipoPreco;
  document.getElementById("festaPrecoCento").value = Number(regraPreco.precoCento || (festaEditando?.categoria === "assados" ? 80 : 75));
  document.getElementById("festaPrecoUnitario").value = Number(regraPreco.precoUnitario || 1.50);
  atualizarCamposPrecoFesta();

  document.getElementById("festaDescricao").value = festaEditando?.descricao || "";
  document.getElementById("festaSabores").value = (festaEditando?.sabores || []).join(", ");
  document.getElementById("festaAtivo").checked = festaEditando?.ativo !== false;
  document.getElementById("modalFesta").classList.add("aberto");
}
function fecharModalFesta() {
  document.getElementById("modalFesta").classList.remove("aberto");
  festaEditando = null;
}
async function salvarFestaAdmin() {
  const nome = limparTexto(document.getElementById("festaNome").value);
  if (!nome) return alert("Digite o nome do produto.");

  const quantidadeInicial = Number(document.getElementById("festaQuantidadeInicial").value || 50);
  const incrementoQuantidade = Number(document.getElementById("festaIncrementoQuantidade").value || 50);
  const quantidadeMaxima = Number(document.getElementById("festaQuantidadeMaxima").value || 500);

  if (quantidadeInicial < 50 || quantidadeInicial % 50 !== 0) return alert("A quantidade inicial deve ser no mínimo 50 e sempre múltipla de 50.");
  if (incrementoQuantidade < 50 || incrementoQuantidade % 50 !== 0) return alert("O aumento precisa ser de 50 em 50 ou outro múltiplo de 50.");
  if (quantidadeMaxima < quantidadeInicial) return alert("A quantidade máxima não pode ser menor que a quantidade inicial.");

  const tipoPreco = document.getElementById("festaTipoPreco").value;
  const precoCento = Number(document.getElementById("festaPrecoCento").value || 0);
  const precoUnitario = Number(document.getElementById("festaPrecoUnitario").value || 0);

  if (tipoPreco === "cento" && precoCento <= 0) return alert("Digite o valor de 100 unidades.");
  if (tipoPreco === "unitario" && precoUnitario <= 0) return alert("Digite o valor de cada unidade.");

  const item = {
    id: festaEditando?.id || gerarId("festa-" + nome),
    nome,
    emoji: limparTexto(document.getElementById("festaEmoji").value) || "🥟",
    categoria: document.getElementById("festaCategoria").value,
    ordem: Number(document.getElementById("festaOrdem").value || 99),
    quantidadeInicial,
    incrementoQuantidade,
    quantidadeMaxima,
    tipoPreco,
    precoCento: tipoPreco === "cento" ? precoCento : 0,
    precoUnitario: tipoPreco === "unitario" ? precoUnitario : 0,
    descricao: limparTexto(document.getElementById("festaDescricao").value),
    sabores: document.getElementById("festaSabores").value.split(",").map(limparTexto).filter(Boolean),
    ativo: document.getElementById("festaAtivo").checked
  };

  try {
    await salvarSalgadoFesta(item);
    fecharModalFesta();
  } catch (e) {
    console.error(e);
    alert(descreverErroFirestore(e));
  }
}
async function migrarFestasParaFirestore() {
  const botao = document.getElementById("btnMigrarFestas");
  const retorno = document.getElementById("retornoMigracaoFestas");
  if (!confirm("Enviar os 7 produtos padrão para o Firestore? Eles serão criados ou atualizados sem duplicar.")) return;
  try {
    if (botao) { botao.disabled = true; botao.textContent = "⏳ Enviando..."; }
    if (retorno) { retorno.className = "festas-migracao-retorno"; retorno.textContent = "Enviando produtos para o banco..."; }
    const total = await enviarProdutosBaseParaFirestore();
    if (retorno) { retorno.className = "festas-migracao-retorno sucesso"; retorno.textContent = `✅ ${total} produtos salvos no Firestore. Agora todos podem ser editados normalmente.`; }
  } catch (e) {
    console.error(e);
    if (retorno) { retorno.className = "festas-migracao-retorno erro"; retorno.textContent = `❌ ${descreverErroFirestore(e)}`; }
    alert(descreverErroFirestore(e));
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = "☁️ Enviar produtos atuais para o Firestore"; }
  }
}
window.abrirModalFesta=abrirModalFesta;window.fecharModalFesta=fecharModalFesta;window.salvarFestaAdmin=salvarFestaAdmin;window.migrarFestasParaFirestore=migrarFestasParaFirestore;


const STATUS_ENCOMENDA = {
  aguardando_confirmacao: ["Aguardando confirmação", "novo"],
  confirmado: ["Confirmado", "confirmado"],
  em_producao: ["Em produção", "producao"],
  pronto: ["Pronto", "pronto"],
  entregue: ["Entregue", "entregue"],
  cancelado: ["Cancelado", "cancelado"]
};

function dataEncomenda(valor) {
  if (!valor) return "Data não informada";
  const partes = String(valor).split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : valor;
}
function dataHoraPedido(p) {
  const d = p.criadoEm?.toDate?.() || new Date(p.criadoEmMs || Date.now());
  return d.toLocaleString("pt-BR");
}
function renderNotificacoesEncomendas() {
  const novas = encomendasFesta.filter(p => !p.visualizado);
  const badge = document.getElementById("badgeEncomendas");
  if (badge) { badge.textContent = novas.length; badge.hidden = novas.length === 0; }
  const stat = document.getElementById("statNovasEncomendas");
  const sub = document.getElementById("statProximaFesta");
  if (stat) stat.textContent = novas.length;
  if (sub) sub.textContent = novas[0] ? `${novas[0].cliente?.nome || "Cliente"} • festa em ${dataEncomenda(novas[0].dataFesta)}` : "Nenhuma nova encomenda";
}
function renderAgendaEncomendas(erro = null) {
  const box = document.getElementById("listaAgendaEncomendas");
  if (!box) return;
  const busca = (document.getElementById("buscaEncomenda")?.value || "").toLowerCase();
  const filtro = document.getElementById("filtroEncomenda")?.value || "todos";
  const lista = encomendasFesta.filter(p => {
    const texto = `${p.numero} ${p.cliente?.nome || ""} ${(p.itens||[]).map(i=>`${i.nome} ${i.sabor}`).join(" ")}`.toLowerCase();
    return (!busca || texto.includes(busca)) && (filtro === "todos" || p.status === filtro);
  });
  const cont = st => encomendasFesta.filter(p=>p.status===st).length;
  document.getElementById("agendaNovas").textContent = cont("aguardando_confirmacao");
  document.getElementById("agendaConfirmadas").textContent = cont("confirmado");
  document.getElementById("agendaProducao").textContent = cont("em_producao");
  document.getElementById("agendaProntas").textContent = cont("pronto");
  const statusBox = document.getElementById("statusAgendaEncomendas");
  if (statusBox) { statusBox.style.display = erro ? "flex" : "none"; statusBox.textContent = erro ? "Não foi possível carregar as encomendas agora." : ""; }
  if (!lista.length) {
    box.innerHTML = '<div class="agenda-vazia">📭<strong>Nenhuma encomenda encontrada</strong><span>Os pedidos enviados pelo site aparecerão aqui.</span></div>';
    return;
  }
  box.innerHTML = lista.map(p => {
    const [rotulo, classe] = STATUS_ENCOMENDA[p.status] || STATUS_ENCOMENDA.aguardando_confirmacao;
    const total = Number(p.totalEstimado || 0);
    return `<article class="agenda-card ${!p.visualizado ? "nao-lida" : ""}">
      <div class="agenda-card-topo">
        <div><span class="agenda-numero">${p.numero || p.id}</span><h3>${p.cliente?.nome || "Cliente"}</h3><small>Recebido em ${dataHoraPedido(p)}</small></div>
        <span class="agenda-status ${classe}">${rotulo}</span>
      </div>
      <div class="agenda-info-grid">
        <div><span>📅 Data da festa</span><strong>${dataEncomenda(p.dataFesta)}</strong></div>
        <div><span>📱 WhatsApp</span><strong>${p.cliente?.telefone || "Não informado"}</strong></div>
        <div><span>🚚 Recebimento</span><strong>${p.tipoEntrega || "Retirada na loja"}</strong></div>
        <div><span>📍 Endereço</span><strong>${p.tipoEntrega === "Entrega" ? (p.endereco || "Não informado") : "Retirada na loja"}</strong></div>
        <div><span>🧺 Total</span><strong>${p.totalUnidades || 0} unidades</strong></div>
        <div><span>💰 Estimativa</span><strong>${total > 0 ? formatarMoeda(total) : "Sob consulta"}</strong></div>
      </div>
      <div class="agenda-itens">${(p.itens||[]).map(i=>`<div><span>${i.emoji || "🥟"} ${i.nome} — ${i.sabor}</span><strong>${i.quantidade}</strong></div>`).join("")}</div>
      ${p.observacoes ? `<p class="agenda-observacao"><b>Observações:</b> ${p.observacoes}</p>` : ""}
      <div class="agenda-acoes">
        <select onchange="alterarStatusEncomenda('${p.id}', this.value)">
          ${Object.entries(STATUS_ENCOMENDA).map(([valor,d])=>`<option value="${valor}" ${p.status===valor?"selected":""}>${d[0]}</option>`).join("")}
        </select>
        ${!p.visualizado ? `<button class="secondary-btn" onclick="visualizarEncomenda('${p.id}')">✓ Marcar como vista</button>` : ""}
        <button class="agenda-btn-excluir" onclick="apagarEncomenda('${p.id}', '${String(p.numero || p.id).replaceAll("'", "&#39;")}')">🗑️ Excluir</button>
      </div>
    </article>`;
  }).join("");
}
async function alterarStatusEncomenda(id, status) {
  try { await atualizarStatusEncomendaFesta(id, status); }
  catch(e) { console.error(e); alert("Não foi possível atualizar o status."); }
}
async function visualizarEncomenda(id) {
  try { await marcarEncomendaVisualizada(id); }
  catch(e) { console.error(e); alert("Não foi possível marcar a encomenda como vista."); }
}
async function apagarEncomenda(id, numero) {
  const confirmar = confirm(`Excluir definitivamente a encomenda ${numero}?\n\nUse esta opção para pedidos de teste, cancelados ou lançados por engano.`);
  if (!confirmar) return;
  try {
    await excluirEncomendaFesta(id);
  } catch(e) {
    console.error(e);
    alert("Não foi possível excluir a encomenda. Confira a conexão e as permissões do Firestore.");
  }
}
window.renderAgendaEncomendas=renderAgendaEncomendas;
window.alterarStatusEncomenda=alterarStatusEncomenda;
window.visualizarEncomenda=visualizarEncomenda;
window.apagarEncomenda=apagarEncomenda;


function atualizarCamposPrecoFesta() {
  const tipo = document.getElementById("festaTipoPreco")?.value || "cento";
  const campoCento = document.getElementById("campoFestaPrecoCento");
  const campoUnitario = document.getElementById("campoFestaPrecoUnitario");
  if (campoCento) campoCento.hidden = tipo !== "cento";
  if (campoUnitario) campoUnitario.hidden = tipo !== "unitario";
  atualizarPreviaPrecoFesta();
}

function atualizarPreviaPrecoFesta() {
  const previa = document.getElementById("festaPreviaPreco");
  if (!previa) return;
  const tipo = document.getElementById("festaTipoPreco")?.value || "cento";
  const moeda = valor => Number(valor || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });

  if (tipo === "unitario") {
    const unitario = Number(document.getElementById("festaPrecoUnitario")?.value || 0);
    previa.innerHTML = `
      <strong>Prévia por unidade — venda mínima de 50</strong>
      <span>50 unidades<b>${moeda(unitario * 50)}</b></span>
      <span>100 unidades<b>${moeda(unitario * 100)}</b></span>
      <span>150 unidades<b>${moeda(unitario * 150)}</b></span>
      <span>200 unidades<b>${moeda(unitario * 200)}</b></span>`;
  } else {
    const cento = Number(document.getElementById("festaPrecoCento")?.value || 0);
    previa.innerHTML = `
      <strong>Prévia por cento</strong>
      <span>50 unidades<b>${moeda(cento / 2)}</b></span>
      <span>100 unidades<b>${moeda(cento)}</b></span>
      <span>150 unidades<b>${moeda(cento * 1.5)}</b></span>
      <span>200 unidades<b>${moeda(cento * 2)}</b></span>`;
  }
}
window.atualizarCamposPrecoFesta = atualizarCamposPrecoFesta;
window.atualizarPreviaPrecoFesta = atualizarPreviaPrecoFesta;


function dataHojeISOFinanceiro() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth()+1).padStart(2,"0");
  const dia = String(agora.getDate()).padStart(2,"0");
  return `${ano}-${mes}-${dia}`;
}

function limitesPeriodoFinanceiro() {
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  let inicio = new Date(hoje);
  let fim = new Date(hoje);

  if (periodoFinanceiroAtual === "semana") {
    const diaSemana = hoje.getDay();
    const deslocamento = diaSemana === 0 ? 6 : diaSemana - 1;
    inicio.setDate(hoje.getDate() - deslocamento);
  } else if (periodoFinanceiroAtual === "mes") {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
  } else if (periodoFinanceiroAtual === "personalizado") {
    const valorInicio = document.getElementById("financeiroDataInicio")?.value;
    const valorFim = document.getElementById("financeiroDataFim")?.value;
    if (valorInicio) inicio = new Date(`${valorInicio}T00:00:00`);
    if (valorFim) fim = new Date(`${valorFim}T23:59:59`);
  }

  const iso = data => {
    const a=data.getFullYear(), m=String(data.getMonth()+1).padStart(2,"0"), d=String(data.getDate()).padStart(2,"0");
    return `${a}-${m}-${d}`;
  };
  return { inicio:iso(inicio), fim:iso(fim) };
}

function movimentosNoPeriodo() {
  const { inicio, fim } = limitesPeriodoFinanceiro();
  return consolidarFinanceiro().filter(m => {
    const data = m.dataISO || "";
    return data >= inicio && data <= fim;
  });
}

function selecionarPeriodoFinanceiro(periodo, botao) {
  periodoFinanceiroAtual = periodo;
  document.querySelectorAll(".periodo-btn").forEach(b => b.classList.toggle("ativo", b === botao));
  const personalizado = document.getElementById("financeiroPeriodoPersonalizado");
  if (personalizado) personalizado.hidden = periodo !== "personalizado";

  if (periodo === "personalizado") {
    const hoje = dataHojeISOFinanceiro();
    const inicio = document.getElementById("financeiroDataInicio");
    const fim = document.getElementById("financeiroDataFim");
    if (inicio && !inicio.value) inicio.value = hoje.slice(0,8)+"01";
    if (fim && !fim.value) fim.value = hoje;
  }
  renderFinanceiro();
}

function agruparPagamentos(lista) {
  const totais = {};
  lista.forEach(movimento => {
    const detalhes = Array.isArray(movimento.pagamentos) ? movimento.pagamentos : [];
    if (detalhes.length) {
      detalhes.forEach(item => {
        const tipo = item.tipo || "Não informado";
        totais[tipo] = (totais[tipo] || 0) + Number(item.valor || 0);
      });
    } else {
      const tipo = movimento.pagamento || "Não informado";
      totais[tipo] = (totais[tipo] || 0) + Number(movimento.valor || 0);
    }
  });
  return totais;
}

function resumoFinanceiroPeriodo(lista) {
  const entradas = lista.filter(m=>m.tipo==="entrada");
  const saidas = lista.filter(m=>m.tipo==="saida");
  const totalEntradas = entradas.reduce((s,m)=>s+Number(m.valor||0),0);
  const totalSaidas = saidas.reduce((s,m)=>s+Number(m.valor||0),0);
  const custoVendido = entradas.reduce((s,m)=>s+calcularCustoItens(m.itens||[]),0);
  const resultado = totalEntradas-totalSaidas;
  const lucroEstimado = resultado-custoVendido;
  return { entradas, saidas, totalEntradas, totalSaidas, resultado, custoVendido, lucroEstimado };
}

function renderDashboardFinanceiro() {
  const elemento = document.getElementById("statResultadoMes");
  if (!elemento) return;
  const periodoAnterior = periodoFinanceiroAtual;
  periodoFinanceiroAtual = "mes";
  const resumo = resumoFinanceiroPeriodo(movimentosNoPeriodo());
  periodoFinanceiroAtual = periodoAnterior;
  elemento.textContent = formatarMoeda(resumo.lucroEstimado);
  elemento.classList.toggle("valor-negativo", resumo.lucroEstimado < 0);
  const texto = document.getElementById("statFinanceiroMes");
  if (texto) texto.textContent = `Lucro estimado após despesas e custos vendidos`;
}

function renderFinanceiro() {
  const listaBox = document.getElementById("listaMovimentosFinanceiros");
  if (!listaBox) return;

  const filtroTipo = document.getElementById("financeiroFiltroTipo")?.value || "todos";
  const todos = movimentosNoPeriodo();
  const lista = todos.filter(m => filtroTipo === "todos" || m.tipo === filtroTipo);
  const resumo = resumoFinanceiroPeriodo(todos);

  document.getElementById("financeiroEntradas").textContent = formatarMoeda(resumo.totalEntradas);
  document.getElementById("financeiroSaidas").textContent = formatarMoeda(resumo.totalSaidas);
  document.getElementById("financeiroResultado").textContent = formatarMoeda(resumo.resultado);
  document.getElementById("financeiroResultado").classList.toggle("valor-negativo", resumo.resultado < 0);
  document.getElementById("financeiroCustoVendido").textContent = formatarMoeda(resumo.custoVendido);
  document.getElementById("financeiroLucroEstimado").textContent = formatarMoeda(resumo.lucroEstimado);
  document.getElementById("financeiroLucroEstimado").classList.toggle("valor-negativo", resumo.lucroEstimado < 0);
  document.getElementById("financeiroQtdEntradas").textContent = `${resumo.entradas.length} lançamento(s)`;
  document.getElementById("financeiroQtdSaidas").textContent = `${resumo.saidas.length} lançamento(s)`;

  if (!lista.length) {
    listaBox.innerHTML = '<div class="financeiro-vazio">📭<strong>Nenhuma movimentação neste período</strong><span>As vendas e despesas aparecerão aqui.</span></div>';
  } else {
    listaBox.innerHTML = lista.map(m => `
      <article class="financeiro-movimento ${m.tipo}">
        <div class="financeiro-movimento-icone">${m.tipo === "entrada" ? "↗" : "↘"}</div>
        <div class="financeiro-movimento-info">
          <div><strong>${m.descricao || (m.tipo==="entrada"?"Entrada":"Despesa")}</strong>
          ${m.automatico ? '<span class="financeiro-automatico">Automático</span>' : ''}</div>
          <small>${m.dataISO ? m.dataISO.split("-").reverse().join("/") : "Sem data"} ${m.hora || ""} • ${m.categoria || "Outros"} • ${Array.isArray(m.pagamentos) && m.pagamentos.length ? m.pagamentos.map(p=>`${p.tipo}: ${formatarMoeda(p.valor)}`).join(" + ") : (m.pagamento || "Não informado")}</small>
          ${m.observacao ? `<p>${m.observacao}</p>` : ""}
        </div>
        <strong class="financeiro-movimento-valor">${m.tipo==="entrada"?"+":"-"} ${formatarMoeda(m.valor)}</strong>
        ${!m.automatico ? `<div class="financeiro-acoes"><button title="Editar" onclick="editarMovimentoFinanceiro('${m.id}')">✏️</button><button class="financeiro-excluir" title="Excluir" onclick="apagarMovimentoFinanceiro('${m.id}')">🗑️</button></div>` : ""}
      </article>`).join("");
  }

  const pagamentos = {};
  resumo.entradas.forEach(m => {
    const detalhes = Array.isArray(m.pagamentos) ? m.pagamentos : [];
    if (detalhes.length) {
      detalhes.forEach(item => {
        const chave = item.tipo || "Não informado";
        pagamentos[chave] = (pagamentos[chave] || 0) + Number(item.valor || 0);
      });
    } else {
      const chave=m.pagamento||"Não informado";
      pagamentos[chave]=(pagamentos[chave]||0)+Number(m.valor||0);
    }
  });
  const pagBox=document.getElementById("financeiroPagamentos");
  const maxPagamento=Math.max(1,...Object.values(pagamentos));
  pagBox.innerHTML=Object.keys(pagamentos).length
    ? Object.entries(pagamentos).sort((a,b)=>b[1]-a[1]).map(([nome,valor])=>`
      <div class="financeiro-pagamento-item">
        <div><span>${nome}</span><strong>${formatarMoeda(valor)}</strong></div>
        <div class="financeiro-barra"><i style="width:${Math.round(valor/maxPagamento*100)}%"></i></div>
      </div>`).join("")
    : '<p class="texto-suave">Nenhuma entrada no período.</p>';

  const ranking={};
  resumo.entradas.forEach(m=>(m.itens||[]).forEach(i=>{
    const nome=i.nome||"Produto";
    ranking[nome]=(ranking[nome]||0)+Number(i.quantidade||0);
  }));
  const rankingBox=document.getElementById("financeiroProdutosVendidos");
  rankingBox.innerHTML=Object.keys(ranking).length
    ? Object.entries(ranking).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([nome,qtd],i)=>`
      <div class="financeiro-ranking-item"><span>${i+1}</span><b>${nome}</b><strong>${qtd} un.</strong></div>`).join("")
    : '<p class="texto-suave">Sem produtos contabilizados.</p>';

  renderDashboardFinanceiro();
}

function abrirModalMovimento(tipo="saida") {
  movimentoEditando = null;
  const modal=document.getElementById("modalMovimentoFinanceiro");
  document.getElementById("movimentoTipo").value=tipo;
  document.getElementById("movimentoModalTitulo").textContent=tipo==="saida"?"Registrar despesa":"Registrar entrada";
  document.getElementById("movimentoModalEmoji").textContent=tipo==="saida"?"💸":"💰";
  document.getElementById("movimentoDescricao").value="";
  document.getElementById("movimentoValor").value="";
  document.getElementById("movimentoData").value=dataHojeISOFinanceiro();
  document.getElementById("movimentoObservacao").value="";
  document.getElementById("movimentoCategoria").value=tipo==="saida"?"Ingredientes":"Vendas";
  modal.classList.add("aberto");
}

function editarMovimentoFinanceiro(id) {
  const movimento = movimentosFinanceiros.find(item => item.id === id);
  if (!movimento) return alert("Lançamento não encontrado.");
  movimentoEditando = movimento;
  document.getElementById("movimentoTipo").value = movimento.tipo;
  document.getElementById("movimentoModalTitulo").textContent = movimento.tipo === "saida" ? "Editar despesa" : "Editar entrada";
  document.getElementById("movimentoModalEmoji").textContent = "✏️";
  document.getElementById("movimentoDescricao").value = movimento.descricao || "";
  document.getElementById("movimentoCategoria").value = movimento.categoria || "Outros";
  document.getElementById("movimentoValor").value = Number(movimento.valor || 0);
  document.getElementById("movimentoPagamento").value = movimento.pagamento || "Não informado";
  document.getElementById("movimentoData").value = movimento.dataISO || dataHojeISOFinanceiro();
  document.getElementById("movimentoObservacao").value = movimento.observacao || "";
  document.getElementById("modalMovimentoFinanceiro").classList.add("aberto");
}

function fecharModalMovimento() {
  document.getElementById("modalMovimentoFinanceiro")?.classList.remove("aberto");
  movimentoEditando=null;
}

async function salvarMovimentoAdmin() {
  const tipo=document.getElementById("movimentoTipo").value;
  const descricao=limparTexto(document.getElementById("movimentoDescricao").value);
  const valor=Number(document.getElementById("movimentoValor").value||0);
  if(!descricao) return alert("Digite uma descrição.");
  if(valor<=0) return alert("Digite um valor maior que zero.");

  try{
    await salvarMovimentoFinanceiro({
      id:movimentoEditando?.id,
      tipo,
      descricao,
      categoria:document.getElementById("movimentoCategoria").value,
      valor,
      pagamento:document.getElementById("movimentoPagamento").value,
      dataISO:document.getElementById("movimentoData").value||dataHojeISOFinanceiro(),
      observacao:limparTexto(document.getElementById("movimentoObservacao").value)
    });
    fecharModalMovimento();
  }catch(e){
    console.error(e);
    alert("Não foi possível salvar o lançamento. Confira as regras do Firestore.");
  }
}

async function apagarMovimentoFinanceiro(id) {
  if(!confirm("Excluir este lançamento financeiro?")) return;
  try{await excluirMovimentoFinanceiro(id);}
  catch(e){console.error(e);alert("Não foi possível excluir o lançamento.");}
}

function renderCustosProdutos() {
  const box=document.getElementById("listaCustosProdutos");
  if(!box) return;
  const busca=(document.getElementById("buscaCustoProduto")?.value||"").toLowerCase();
  const mapaProdutos = new Map();
  [...produtos, ...salgadosFesta].forEach(p => mapaProdutos.set(p.id, p));
  const lista=[...mapaProdutos.values()].filter(p=>(p.nome||"").toLowerCase().includes(busca));
  box.innerHTML=lista.length ? lista.map(p=>`
    <label class="custo-produto-card">
      <span>${p.emoji||"📦"}</span>
      <div><strong>${p.nome}</strong><small>Custo aproximado de 1 unidade</small></div>
      <div class="custo-input"><span>R$</span><input type="number" min="0" step="0.01" value="${Number(custosProdutos[p.id]?.custoUnitario||0)}" onchange="salvarCustoProdutoAdmin('${p.id}', this.value, '${String(p.nome||"").replaceAll("'","&#39;")}')"></div>
    </label>`).join("") : '<p class="texto-suave">Nenhum produto encontrado.</p>';
}

async function salvarCustoProdutoAdmin(id, valor, nome) {
  const status=document.getElementById("statusCustosProdutos");
  if(status) status.textContent="Salvando custo...";
  try{
    await salvarCustoProduto(id,{nome,custoUnitario:Number(valor||0)});
    if(status){status.textContent="✅ Custo salvo automaticamente.";setTimeout(()=>status.textContent="",2200);}
  }catch(e){
    console.error(e);
    if(status) status.textContent="❌ Não foi possível salvar.";
  }
}

function escaparXml(valor) {
  return String(valor ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
}

function planilhaXml(nome, cabecalhos, linhas) {
  const celula = (valor, tipo="String") => `<Cell><Data ss:Type="${tipo}">${escaparXml(valor)}</Data></Cell>`;
  return `<Worksheet ss:Name="${escaparXml(nome)}"><Table>
    <Row>${cabecalhos.map(h=>celula(h)).join("")}</Row>
    ${linhas.map(l=>`<Row>${l.map(v=>celula(v,typeof v==="number"?"Number":"String")).join("")}</Row>`).join("")}
  </Table></Worksheet>`;
}

function exportarFinanceiroExcel() {
  const lista=movimentosNoPeriodo();
  const resumo=resumoFinanceiroPeriodo(lista);
  const produtos={};
  lista.filter(m=>m.tipo==="entrada").forEach(m=>(m.itens||[]).forEach(i=>{
    const nome=i.nome||"Produto";
    if(!produtos[nome]) produtos[nome]={qtd:0,total:0};
    produtos[nome].qtd+=Number(i.quantidade||0);
    produtos[nome].total+=Number(i.subtotal||0);
  }));

  const resumoLinhas=[
    ["Período",`${limitesPeriodoFinanceiro().inicio} até ${limitesPeriodoFinanceiro().fim}`],
    ["Entradas",resumo.totalEntradas],
    ["Despesas",resumo.totalSaidas],
    ["Resultado antes dos custos",resumo.resultado],
    ["Custo estimado vendido",resumo.custoVendido],
    ["Lucro estimado",resumo.lucroEstimado]
  ];
  const movimentoLinhas=lista.map(m=>[
    m.dataISO||"",m.hora||"",m.tipo==="entrada"?"Entrada":"Despesa",m.descricao||"",
    m.categoria||"",m.pagamento||"",Number(m.valor||0),m.origem||"",m.observacao||""
  ]);
  const produtoLinhas=Object.entries(produtos).sort((a,b)=>b[1].qtd-a[1].qtd).map(([nome,d])=>[nome,d.qtd,d.total]);
  const custoLinhas=produtos ? Object.values(custosProdutos).map(c=>[c.nome||c.produtoId,Number(c.custoUnitario||0)]) : [];

  const xml=`<?xml version="1.0"?>
  <?mso-application progid="Excel.Sheet"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
   xmlns:o="urn:schemas-microsoft-com:office:office"
   xmlns:x="urn:schemas-microsoft-com:office:excel"
   xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    ${planilhaXml("Resumo",["Indicador","Valor"],resumoLinhas)}
    ${planilhaXml("Movimentacoes",["Data","Hora","Tipo","Descrição","Categoria","Pagamento","Valor","Origem","Observação"],movimentoLinhas)}
    ${planilhaXml("Produtos vendidos",["Produto","Quantidade","Faturamento"],produtoLinhas)}
    ${planilhaXml("Custos produtos",["Produto","Custo unitário"],custoLinhas)}
  </Workbook>`;

  const blob=new Blob(["\ufeff",xml],{type:"application/vnd.ms-excel"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  link.download=`relatorio-delicias-da-vo-${limitesPeriodoFinanceiro().inicio}-${limitesPeriodoFinanceiro().fim}.xls`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1500);
}

window.selecionarPeriodoFinanceiro=selecionarPeriodoFinanceiro;
window.renderFinanceiro=renderFinanceiro;
window.abrirModalMovimento=abrirModalMovimento;
window.fecharModalMovimento=fecharModalMovimento;
window.salvarMovimentoAdmin=salvarMovimentoAdmin;
window.apagarMovimentoFinanceiro=apagarMovimentoFinanceiro;
window.editarMovimentoFinanceiro=editarMovimentoFinanceiro;
window.renderCustosProdutos=renderCustosProdutos;
window.salvarCustoProdutoAdmin=salvarCustoProdutoAdmin;
window.exportarFinanceiroExcel=exportarFinanceiroExcel;


const STATUS_CENTRAL = {
  registrado:["Registrado","registrado"],
  aguardando_envio:["Aguardando envio","registrado"],
  aguardando_confirmacao:["Aguardando confirmação","registrado"],
  confirmado:["Confirmado","confirmado"],
  preparando:["Em preparação","producao"],
  em_producao:["Em produção","producao"],
  pronto:["Pronto","pronto"],
  entregue:["Entregue","entregue"],
  concluida:["Concluída","entregue"],
  cancelado:["Cancelado","cancelado"],
  cancelada:["Cancelada","cancelado"]
};

function grupoStatusCentral(status) {
  if (["cancelado","cancelada"].includes(status)) return "cancelado";
  if (["entregue","concluida"].includes(status)) return "concluido";
  return "andamento";
}

function dataCentralFormatada(valor) {
  if (!valor) return "Sem data";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.split("-").reverse().join("/");
  return valor;
}

function opcoesStatusCentral(item) {
  if (item.origemTipo === "venda") {
    return `<option value="concluida" ${item.status==="concluida"?"selected":""}>Concluída</option>
      <option value="cancelada" ${item.status==="cancelada"?"selected":""}>Cancelada</option>`;
  }

  if (item.origemTipo === "festa") {
    const opcoes=["aguardando_confirmacao","confirmado","em_producao","pronto","entregue","cancelado"];
    return opcoes.map(status=>`<option value="${status}" ${item.status===status?"selected":""}>${STATUS_CENTRAL[status][0]}</option>`).join("");
  }

  const opcoes=["registrado","confirmado","preparando","pronto","entregue","cancelado"];
  return opcoes.map(status=>`<option value="${status}" ${item.status===status?"selected":""}>${STATUS_CENTRAL[status][0]}</option>`).join("");
}

function renderCentralPedidos() {
  const box=document.getElementById("listaCentralPedidos");
  if(!box) return;

  const busca=(document.getElementById("buscaCentralPedidos")?.value||"").toLowerCase();
  const origem=document.getElementById("filtroOrigemCentral")?.value||"todos";
  const filtroStatus=document.getElementById("filtroStatusCentral")?.value||"todos";
  const todos=consolidarCentralPedidos();

  const lista=todos.filter(item=>{
    const texto=`${item.numeroExibicao} ${item.clienteNome} ${item.origem} ${(item.itens||[]).map(i=>`${i.nome} ${i.sabor||""}`).join(" ")}`.toLowerCase();
    return (!busca||texto.includes(busca))
      && (origem==="todos"||item.origemTipo===origem)
      && (filtroStatus==="todos"||grupoStatusCentral(item.status)===filtroStatus);
  });

  document.getElementById("centralTotal").textContent=todos.length;
  document.getElementById("centralAndamento").textContent=todos.filter(i=>grupoStatusCentral(i.status)==="andamento").length;
  document.getElementById("centralConcluidos").textContent=todos.filter(i=>grupoStatusCentral(i.status)==="concluido").length;
  document.getElementById("centralCancelados").textContent=todos.filter(i=>grupoStatusCentral(i.status)==="cancelado").length;

  const alerta=document.getElementById("statusCentralPedidos");
  if(alerta){
    alerta.style.display=erroCentralPedidos?"flex":"none";
    alerta.textContent=erroCentralPedidos?"Não foi possível carregar uma das fontes da central agora.":"";
  }

  if(!lista.length){
    box.innerHTML='<div class="central-vazia">📭<strong>Nenhum registro encontrado</strong><span>Tente alterar os filtros ou a pesquisa.</span></div>';
    return;
  }

  box.innerHTML=lista.map(item=>{
    const [statusTexto,statusClasse]=STATUS_CENTRAL[item.status]||[item.status||"Registrado","registrado"];
    const cancelado=grupoStatusCentral(item.status)==="cancelado";
    return `<article class="central-card ${cancelado?"cancelado":""}">
      <div class="central-card-topo">
        <div class="central-identificacao">
          <span class="central-origem ${item.origemTipo}">${item.origem}</span>
          <h3>${item.numeroExibicao}</h3>
          <small>${item.clienteNome}</small>
        </div>
        <span class="agenda-status ${statusClasse}">${statusTexto}</span>
      </div>
      <div class="central-dados">
        <span><b>📅 Data</b>${dataCentralFormatada(item.dataExibicao)} ${item.horaExibicao||""}</span>
        <span><b>💰 Valor</b>${formatarMoeda(item.valor)}</span>
        <span><b>💳 Pagamento</b>${item.pagamento||"Não informado"}</span>
        <span><b>🧺 Itens</b>${(item.itens||[]).reduce((s,i)=>s+Number(i.quantidade||0),0)} unidade(s)</span>
      </div>
      <div class="central-itens">
        ${(item.itens||[]).slice(0,6).map(i=>`<span>${i.emoji||"•"} ${i.quantidade||0}× ${i.nome}${i.sabor?` — ${i.sabor}`:""}</span>`).join("")||"<span>Sem itens detalhados</span>"}
      </div>
      <div class="central-acoes">
        <select onchange="alterarStatusCentral('${item.origemTipo}','${item.origemTipo==="normal"?item.caminho:item.id}',this.value)">
          ${opcoesStatusCentral(item)}
        </select>
        ${!cancelado?`<button class="central-cancelar" onclick="cancelarRegistroCentral('${item.origemTipo}','${item.origemTipo==="normal"?item.caminho:item.id}','${String(item.numeroExibicao).replaceAll("'","&#39;")}')">🚫 Cancelar</button>`:""}
      </div>
    </article>`;
  }).join("");
}

async function alterarStatusCentral(tipo,id,status) {
  try{
    if(tipo==="normal") await atualizarStatusPedidoNormal(id,status);
    else if(tipo==="festa") await atualizarStatusEncomendaFesta(id,status);
    else if(tipo==="venda"){
      if(status==="cancelada"){
        const venda=vendasCentral.find(v=>v.id===id);
        if(venda?.status!=="cancelada") await excluirVendaComEstorno(venda);
      } else {
        await atualizarStatusVenda(id,status);
      }
    }
  }catch(e){
    console.error(e);
    alert("Não foi possível atualizar o status.");
    renderCentralPedidos();
  }
}

async function cancelarRegistroCentral(tipo,id,numero) {
  if(!confirm(`Cancelar ${numero} sem apagar o histórico?`)) return;
  const status=tipo==="venda"?"cancelada":"cancelado";
  await alterarStatusCentral(tipo,id,status);
}

function mesAtualId() {
  const agora=new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,"0")}`;
}

async function fecharMesFinanceiro() {
  const mesId=mesAtualId();
  const periodoAnterior=periodoFinanceiroAtual;
  periodoFinanceiroAtual="mes";
  const resumo=resumoFinanceiroPeriodo(movimentosNoPeriodo());
  periodoFinanceiroAtual=periodoAnterior;

  const jaExiste=fechamentosFinanceiros.find(f=>f.id===mesId||f.mesId===mesId);
  const aviso=jaExiste
    ? `O mês ${mesId} já foi fechado. Deseja atualizar o fechamento com os valores atuais?`
    : `Fechar o mês ${mesId} e congelar o resumo financeiro atual?`;
  if(!confirm(aviso)) return;

  try{
    await salvarFechamentoFinanceiro(mesId,{
      entradas:resumo.totalEntradas,
      despesas:resumo.totalSaidas,
      resultado:resumo.resultado,
      custoVendido:resumo.custoVendido,
      lucroEstimado:resumo.lucroEstimado,
      quantidadeEntradas:resumo.entradas.length,
      quantidadeDespesas:resumo.saidas.length,
      pagamentosEntradas:agruparPagamentos(resumo.entradas),
      pagamentosDespesas:agruparPagamentos(resumo.saidas)
    });
    alert("Fechamento mensal salvo.");
  }catch(e){
    console.error(e);
    alert("Não foi possível salvar o fechamento mensal.");
  }
}

function nomeMesFechamento(mesId="") {
  const [ano,mes]=mesId.split("-").map(Number);
  if(!ano||!mes) return mesId;
  return new Date(ano,mes-1,1).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
}

function renderFechamentosFinanceiros() {
  const box=document.getElementById("listaFechamentosFinanceiros");
  if(!box) return;
  if(!fechamentosFinanceiros.length){
    box.innerHTML='<p class="texto-suave">Nenhum mês fechado ainda.</p>';
    return;
  }
  box.innerHTML=fechamentosFinanceiros.map(f=>`
    <article class="fechamento-card">
      <div><span>🔒</span><div><strong>${nomeMesFechamento(f.mesId||f.id)}</strong><small>Resumo congelado</small></div></div>
      <dl>
        <div><dt>Entradas</dt><dd>${formatarMoeda(f.entradas)}</dd></div>
        <div><dt>Despesas</dt><dd>${formatarMoeda(f.despesas)}</dd></div>
        <div><dt>Custos vendidos</dt><dd>${formatarMoeda(f.custoVendido)}</dd></div>
        <div class="lucro"><dt>Lucro estimado</dt><dd>${formatarMoeda(f.lucroEstimado)}</dd></div>
      </dl>
      ${f.pagamentosEntradas ? `<div class="fechamento-pagamentos"><strong>Entradas por pagamento</strong><small>${Object.entries(f.pagamentosEntradas).map(([tipo,valor])=>`${tipo}: ${formatarMoeda(valor)}`).join(" • ") || "Sem entradas"}</small></div>` : ""}
      ${f.pagamentosDespesas ? `<div class="fechamento-pagamentos"><strong>Despesas por pagamento</strong><small>${Object.entries(f.pagamentosDespesas).map(([tipo,valor])=>`${tipo}: ${formatarMoeda(valor)}`).join(" • ") || "Sem despesas"}</small></div>` : ""}
    </article>`).join("");
}

function definirStatusBackup(titulo,mensagem,tipo="") {
  const box=document.getElementById("statusBackup");
  if(!box) return;
  box.className=`panel backup-status ${tipo}`;
  box.innerHTML=`<strong>${titulo}</strong><p>${mensagem}</p>`;
}

async function exportarBackupCompleto() {
  const botao=document.getElementById("btnExportarBackup");
  try{
    botao.disabled=true;
    botao.textContent="⏳ Preparando backup...";
    definirStatusBackup("Gerando backup","Lendo os dados do Firestore. Não feche o painel.");
    const backup=await gerarBackupCompleto();
    baixarBackupJson(backup);
    definirStatusBackup("✅ Backup concluído",`${backup.totalDocumentos} documentos foram incluídos no arquivo.`,"sucesso");
  }catch(e){
    console.error(e);
    definirStatusBackup("❌ Falha no backup","Confira a conexão e as permissões do Firestore.","erro");
  }finally{
    botao.disabled=false;
    botao.textContent="Baixar backup agora";
  }
}

async function prepararRestauracaoBackup(input) {
  const arquivo=input.files?.[0];
  arquivoBackupPendente=null;
  const info=document.getElementById("backupArquivoSelecionado");
  const botao=document.getElementById("btnRestaurarBackup");
  if(!arquivo){
    info.textContent="Nenhum arquivo selecionado.";
    botao.disabled=true;
    return;
  }
  try{
    const texto=await arquivo.text();
    const dados=JSON.parse(texto);
    if(!Array.isArray(dados.documentos)) throw new Error("Formato inválido");
    arquivoBackupPendente=dados;
    info.innerHTML=`<strong>${arquivo.name}</strong><span>${dados.totalDocumentos||dados.documentos.length} documentos • criado em ${new Date(dados.criadoEm||Date.now()).toLocaleString("pt-BR")}</span>`;
    botao.disabled=false;
  }catch(e){
    info.textContent="Arquivo inválido ou danificado.";
    botao.disabled=true;
  }
}

async function confirmarRestauracaoBackup() {
  if(!arquivoBackupPendente) return;
  if(!confirm("Restaurar este backup? Documentos com o mesmo caminho serão atualizados. Os demais não serão apagados.")) return;
  const botao=document.getElementById("btnRestaurarBackup");
  try{
    botao.disabled=true;
    definirStatusBackup("Restaurando backup","Iniciando restauração...");
    const total=await restaurarBackupCompleto(arquivoBackupPendente,(feito,todos)=>{
      definirStatusBackup("Restaurando backup",`${feito} de ${todos} documentos restaurados.`);
    });
    definirStatusBackup("✅ Restauração concluída",`${total} documentos foram processados.`,"sucesso");
  }catch(e){
    console.error(e);
    definirStatusBackup("❌ Falha na restauração",e.message||"Confira o arquivo e as permissões.","erro");
  }finally{
    botao.disabled=false;
  }
}

window.renderCentralPedidos=renderCentralPedidos;
window.alterarStatusCentral=alterarStatusCentral;
window.cancelarRegistroCentral=cancelarRegistroCentral;
window.fecharMesFinanceiro=fecharMesFinanceiro;
window.exportarBackupCompleto=exportarBackupCompleto;
window.prepararRestauracaoBackup=prepararRestauracaoBackup;
window.confirmarRestauracaoBackup=confirmarRestauracaoBackup;
