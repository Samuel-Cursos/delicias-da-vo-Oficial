import { iniciarAuth } from "../core/auth.js";
import { APP_CONFIG } from "../core/config.js";
import { formatarMoeda, limparTexto, salvarLocal, carregarLocal } from "../core/utils.js";
import { produtos, observarProdutos, statusEstoque } from "../services/productService.js";
import { categorias, categoriasBase, observarCategorias, normalizarCategorias, categoriaPorId } from "../services/categoryService.js";
import { lojaConfig, observarConfiguracoesLoja } from "../services/configService.js";
import { promocoes, observarPromocoes, promocaoAtivaParaProduto } from "../services/promotionService.js";
import { createProductCard } from "../core/templates.js";
import { gerarPedidoSite } from "../services/orderService.js";
import { salgadosFesta, observarSalgadosFesta, calcularPrecoFesta, textoPrecoFesta, normalizarPrecoFesta } from "../services/partyProductService.js";
import { registrarEncomendaFesta } from "../services/partyOrderService.js";
import { cardapioDiarioAtual, observarCardapioDiario, produtoLiberadoNoCardapio } from "../services/dailyMenuService.js";

let categoriaAtual = "todos";
let carrinho = carregarLocal(APP_CONFIG.storageCarrinho, []);
let pendingSaborProdutoId = null;
let ultimoFocoAntesCarrinho = null;
let taxaEntregaAtual = null;
let timerCalculoEntrega = null;
let solicitacaoEntregaAtual = 0;

window.addEventListener("perfil-cliente-atualizado", event => {
  const perfil = event.detail?.perfil || null;
  preencherDadosCliente(perfil);

  if (!perfil) {
    fecharPerfilCliente();
  } else if (document.getElementById("modalPerfilCliente")?.classList.contains("aberto")) {
    preencherFormularioPerfilCliente(perfil);
  }
});

iniciarAuth();
observarSalgadosFesta((_, erro) => renderSalgadosFesta(erro));
observarCardapioDiario(() => {
  sincronizarCarrinhoDisponibilidade(false);
  renderCategoriasSite();
  renderizarProdutos(categoriaAtual);
  renderPromocoesSite();
  renderCardapioDiaSite();
  atualizarCarrinho();
});

observarProdutos((_, erro, usandoCache) => {
  sincronizarCarrinhoDisponibilidade(true);
  renderCategoriasSite();
  renderizarProdutos(categoriaAtual);
  renderPromocoesSite();
  atualizarCarrinho();
  atualizarEstadoCardapio(erro, usandoCache);
});

function sincronizarCarrinhoDisponibilidade(verificarCatalogo = true) {
  const anterior = JSON.stringify(carrinho);
  const restantes = new Map();
  carrinho = carrinho.filter(item => produtoLiberadoNoCardapio(item.id));

  if (verificarCatalogo) {
    carrinho = carrinho.filter(item => {
      const produto = produtos.find(registro => registro.id === item.id);
      if (!produto || produto.ativo === false) return false;
      const variacao = item.variacaoId
        ? (produto.variacoes || []).find(registro => registro.id === item.variacaoId && registro.ativa !== false)
        : null;
      if (item.variacaoId && !variacao) return false;
      const sobEncomenda = Boolean(produto.sobEncomenda || variacao?.sobEncomenda);
      if (sobEncomenda) return true;
      const chaveEstoque = `${produto.id}|${variacao?.id || ""}`;
      if (!restantes.has(chaveEstoque)) restantes.set(chaveEstoque, Math.max(0, Number(variacao?.estoque ?? produto.estoque ?? 0)));
      const disponivel = restantes.get(chaveEstoque);
      item.quantidade = Math.min(Math.max(0, Number(item.quantidade || 0)), disponivel);
      item.estoqueAtual = disponivel;
      restantes.set(chaveEstoque, Math.max(0, disponivel - item.quantidade));
      return item.quantidade > 0;
    });
  }

  const mudou = anterior !== JSON.stringify(carrinho);
  if (mudou) salvarLocal(APP_CONFIG.storageCarrinho, carrinho);
  return mudou;
}

observarCategorias(() => {
  renderCategoriasSite();
  renderizarProdutos(categoriaAtual);
});

observarConfiguracoesLoja(() => {
  aplicarConfiguracoesSite();
  renderCardapioDiaSite();
});

observarPromocoes(() => {
  renderizarProdutos(categoriaAtual);
  renderPromocoesSite();
});

function preencherCampo(id, valor, sobrescrever = false) {
  const campo = document.getElementById(id);
  if (campo && valor && (sobrescrever || !campo.value.trim())) campo.value = valor;
}

function preencherDadosCliente(perfil, sobrescrever = false) {
  const aviso = document.getElementById("perfilClienteAviso");

  if (!perfil) {
    if (aviso) aviso.textContent = "Entre com Google para reutilizar seus dados nas próximas compras.";
    return;
  }

  const endereco = perfil.endereco || {};

  preencherCampo("nomeCliente", perfil.nome, sobrescrever);
  preencherCampo("telefoneCliente", perfil.telefone, sobrescrever);
  preencherCampo("ruaCliente", endereco.rua, sobrescrever);
  preencherCampo("numeroCliente", endereco.numero, sobrescrever);
  preencherCampo("bairroCliente", endereco.bairro, sobrescrever);
  preencherCampo("complementoCliente", endereco.complemento, sobrescrever);

  preencherCampo("nomeFestaCliente", perfil.nome, sobrescrever);
  preencherCampo("telefoneFestaCliente", perfil.telefone, sobrescrever);
  preencherCampo("ruaFesta", endereco.rua, sobrescrever);
  preencherCampo("numeroFesta", endereco.numero, sobrescrever);
  preencherCampo("bairroFesta", endereco.bairro, sobrescrever);
  preencherCampo("complementoFesta", endereco.complemento, sobrescrever);

  if (aviso) {
    const perfilCompleto = Boolean(perfil.telefone && endereco.rua && endereco.numero && endereco.bairro);
    aviso.textContent = perfilCompleto
      ? "✓ Seus dados foram preenchidos pelo seu perfil Google."
      : "Seu nome veio do Google. Complete telefone e endereço uma vez; depois eles aparecem automaticamente.";
  }

  if (sobrescrever && document.getElementById("tipoPedido")?.value === "Entrega") {
    agendarCalculoTaxaEntrega();
  }
}

function capturarPerfilCliente(origem = "normal") {
  const festa = origem === "festa";

  return {
    nome: limparTexto(document.getElementById(festa ? "nomeFestaCliente" : "nomeCliente")?.value || ""),
    telefone: limparTexto(document.getElementById(festa ? "telefoneFestaCliente" : "telefoneCliente")?.value || ""),
    endereco: {
      rua: limparTexto(document.getElementById(festa ? "ruaFesta" : "ruaCliente")?.value || ""),
      numero: limparTexto(document.getElementById(festa ? "numeroFesta" : "numeroCliente")?.value || ""),
      bairro: limparTexto(document.getElementById(festa ? "bairroFesta" : "bairroCliente")?.value || ""),
      complemento: limparTexto(document.getElementById(festa ? "complementoFesta" : "complementoCliente")?.value || "")
    }
  };
}

async function salvarDadosCliente(origem = "normal") {
  if (!window.usuarioAtual || typeof window.salvarPerfilCliente !== "function") return;

  const dados = capturarPerfilCliente(origem);

  try {
    await window.salvarPerfilCliente(dados);
  } catch (erro) {
    // Salvar o perfil é uma comodidade e nunca deve impedir o pedido.
    console.warn("Não foi possível atualizar os dados do cliente:", erro);
  }
}

const camposCepPorOrigem = {
  normal: {
    cep: "cepCliente",
    botao: "btnCepCliente",
    status: "statusCepCliente",
    rua: "ruaCliente",
    bairro: "bairroCliente",
    numero: "numeroCliente"
  },
  festa: {
    cep: "cepFesta",
    botao: "btnCepFesta",
    status: "statusCepFesta",
    rua: "ruaFesta",
    bairro: "bairroFesta",
    numero: "numeroFesta"
  },
  perfil: {
    cep: "cepPerfilCliente",
    botao: "btnCepPerfilCliente",
    status: "statusCepPerfilCliente",
    rua: "ruaPerfilCliente",
    bairro: "bairroPerfilCliente",
    numero: "numeroPerfilCliente"
  }
};

function formatarCep(valor = "") {
  const digitos = String(valor).replace(/\D/g, "").slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

async function buscarCepEndereco(origem = "normal") {
  const campos = camposCepPorOrigem[origem];
  if (!campos) return;

  const inputCep = document.getElementById(campos.cep);
  const botao = document.getElementById(campos.botao);
  const status = document.getElementById(campos.status);
  const cep = String(inputCep?.value || "").replace(/\D/g, "");

  if (cep.length !== 8) {
    if (status) {
      status.className = "cep-status erro";
      status.textContent = "Digite um CEP com 8 números.";
    }
    inputCep?.focus();
    return;
  }

  if (botao) {
    botao.disabled = true;
    botao.textContent = "Buscando...";
  }
  if (status) {
    status.className = "cep-status";
    status.textContent = "Consultando endereço...";
  }

  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: "application/json" }
    });
    if (!resposta.ok) throw new Error("Falha ao consultar o CEP");

    const endereco = await resposta.json();
    if (endereco.erro) throw new Error("CEP não encontrado");

    const rua = document.getElementById(campos.rua);
    const bairro = document.getElementById(campos.bairro);
    if (rua) rua.value = limparTexto(endereco.logradouro || "");
    if (bairro) bairro.value = limparTexto(endereco.bairro || "");

    if (status) {
      const localidade = [endereco.localidade, endereco.uf].filter(Boolean).join(" - ");
      status.className = "cep-status sucesso";
      status.textContent = localidade ? `Endereço encontrado em ${localidade}.` : "Endereço encontrado.";
    }

    document.getElementById(campos.numero)?.focus();
    if (origem === "normal") agendarCalculoTaxaEntrega();
  } catch (erro) {
    if (status) {
      status.className = "cep-status erro";
      status.textContent = erro?.message === "CEP não encontrado"
        ? "CEP não encontrado. Confira os números."
        : "Não foi possível buscar agora. Preencha o endereço manualmente.";
    }
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent = "Buscar CEP";
    }
  }
}

document.querySelectorAll("#cepCliente, #cepFesta, #cepPerfilCliente").forEach(input => {
  input.addEventListener("input", () => {
    input.value = formatarCep(input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const origem = input.id === "cepFesta" ? "festa" : input.id === "cepPerfilCliente" ? "perfil" : "normal";
    buscarCepEndereco(origem);
  });
});

function preencherFormularioPerfilCliente(perfil = window.perfilClienteAtual) {
  if (!perfil) return;
  const endereco = perfil.endereco || {};
  const valores = {
    nomePerfilCliente: perfil.nome || window.usuarioAtual?.displayName || "",
    emailPerfilCliente: perfil.email || window.usuarioAtual?.email || "",
    telefonePerfilCliente: perfil.telefone || "",
    ruaPerfilCliente: endereco.rua || "",
    numeroPerfilCliente: endereco.numero || "",
    bairroPerfilCliente: endereco.bairro || "",
    complementoPerfilCliente: endereco.complemento || ""
  };

  Object.entries(valores).forEach(([id, valor]) => {
    const campo = document.getElementById(id);
    if (campo) campo.value = valor;
  });

  const statusCep = document.getElementById("statusCepPerfilCliente");
  if (statusCep) {
    statusCep.className = "cep-status";
    statusCep.textContent = "";
  }
}

function abrirPerfilCliente() {
  if (!window.usuarioAtual) {
    window.loginGoogle?.();
    return;
  }

  const modal = document.getElementById("modalPerfilCliente");
  if (!modal) return;
  preencherFormularioPerfilCliente();
  const status = document.getElementById("statusPerfilCliente");
  if (status) {
    status.className = "perfil-salvar-status";
    status.textContent = "";
  }
  document.body.classList.add("modal-em-foco");
  modal.classList.add("aberto");
  window.setTimeout(() => document.getElementById("telefonePerfilCliente")?.focus(), 50);
}

function fecharPerfilCliente() {
  const modal = document.getElementById("modalPerfilCliente");
  if (!modal?.classList.contains("aberto")) return;
  modal.classList.remove("aberto");
  document.body.classList.remove("modal-em-foco");
}

async function salvarFormularioPerfilCliente() {
  const status = document.getElementById("statusPerfilCliente");
  const botao = document.getElementById("btnSalvarPerfilCliente");
  const nome = limparTexto(document.getElementById("nomePerfilCliente")?.value || "");
  const telefone = limparTexto(document.getElementById("telefonePerfilCliente")?.value || "");
  const endereco = {
    rua: limparTexto(document.getElementById("ruaPerfilCliente")?.value || ""),
    numero: limparTexto(document.getElementById("numeroPerfilCliente")?.value || ""),
    bairro: limparTexto(document.getElementById("bairroPerfilCliente")?.value || ""),
    complemento: limparTexto(document.getElementById("complementoPerfilCliente")?.value || "")
  };

  if (!nome) {
    if (status) {
      status.className = "perfil-salvar-status erro";
      status.textContent = "Digite seu nome.";
    }
    document.getElementById("nomePerfilCliente")?.focus();
    return;
  }

  const enderecoIniciado = Boolean(endereco.rua || endereco.numero || endereco.bairro || endereco.complemento);
  if (enderecoIniciado && (!endereco.rua || !endereco.numero || !endereco.bairro)) {
    if (status) {
      status.className = "perfil-salvar-status erro";
      status.textContent = "Para salvar o endereço, complete rua, número e bairro.";
    }
    return;
  }

  if (botao) {
    botao.disabled = true;
    botao.textContent = "Salvando...";
  }

  try {
    const perfil = await window.salvarPerfilCliente?.({ nome, telefone, endereco });
    if (!perfil) throw new Error("Faça login novamente para salvar.");
    preencherDadosCliente(perfil, true);
    if (status) {
      status.className = "perfil-salvar-status sucesso";
      status.textContent = "✓ Dados salvos. Seus próximos pedidos já serão preenchidos.";
    }
    window.setTimeout(fecharPerfilCliente, 850);
  } catch (erro) {
    console.error("Não foi possível salvar o perfil:", erro);
    if (status) {
      status.className = "perfil-salvar-status erro";
      status.textContent = "Não foi possível salvar agora. Tente novamente.";
    }
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent = "Salvar meus dados";
    }
  }
}

window.buscarCepEndereco = buscarCepEndereco;
window.abrirPerfilCliente = abrirPerfilCliente;
window.fecharPerfilCliente = fecharPerfilCliente;
window.salvarFormularioPerfilCliente = salvarFormularioPerfilCliente;

const CACHE_ROTAS_ENTREGA = "deliciasRotasEntregaV53";
const TEMPO_CACHE_ROTA_MS = 30 * 60 * 1000;

function dadosEnderecoParaEntrega() {
  const rua = limparTexto(document.getElementById("ruaCliente")?.value || "");
  const numero = limparTexto(document.getElementById("numeroCliente")?.value || "");
  const bairro = limparTexto(document.getElementById("bairroCliente")?.value || "");
  const cep = limparTexto(document.getElementById("cepCliente")?.value || "");
  const enderecoLoja = limparTexto(lojaConfig.endereco || "");
  const origem = enderecoLoja
    ? `${enderecoLoja}${/votuporanga/i.test(enderecoLoja) ? "" : ", Votuporanga - SP"}, Brasil`
    : "";
  const destino = [
    rua && numero ? `${rua}, ${numero}` : rua || numero,
    bairro,
    "Votuporanga - SP",
    cep,
    "Brasil"
  ].filter(Boolean).join(", ");

  const chave = [origem, rua, numero, bairro, cep]
    .join("|")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return {
    origem,
    destino,
    chave,
    completo: Boolean(origem && rua && numero && bairro)
  };
}

function taxaPorDistancia(distanciaKm) {
  const taxas = configuracaoTaxasEntrega();
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0) return null;
  if (distanciaKm <= 3) return { valor: taxas.ate3Km, foraArea: false };
  if (distanciaKm <= taxas.limiteKm) return { valor: taxas.ate5Km, foraArea: false };
  return { valor: 0, foraArea: true };
}

function atualizarInterfaceTaxaEntrega() {
  const tipo = document.getElementById("tipoPedido")?.value || "Retirada na loja";
  const status = document.getElementById("taxaEntregaStatus");
  const resultado = document.getElementById("taxaEntregaResultado");
  const distancia = document.getElementById("distanciaEntregaTexto");
  const valor = document.getElementById("valorTaxaEntregaTexto");
  const botao = document.getElementById("btnCalcularTaxaEntrega");
  if (!status || !resultado || !botao || tipo !== "Entrega") return;

  status.className = "";
  botao.disabled = false;
  botao.textContent = "Calcular entrega";

  if (!taxaEntregaAtual) {
    resultado.hidden = true;
    status.textContent = dadosEnderecoParaEntrega().completo
      ? "O valor será calculado automaticamente."
      : "Complete rua, número e bairro para calcular.";
    return;
  }

  if (taxaEntregaAtual.estado === "calculando") {
    resultado.hidden = true;
    status.textContent = "Calculando a melhor rota de carro...";
    botao.disabled = true;
    botao.textContent = "Calculando...";
    return;
  }

  if (taxaEntregaAtual.estado === "erro") {
    resultado.hidden = true;
    status.className = "erro";
    status.textContent = taxaEntregaAtual.mensagem || "Não foi possível calcular agora.";
    botao.textContent = "Tentar novamente";
    return;
  }

  resultado.hidden = false;
  if (distancia) distancia.textContent = `${taxaEntregaAtual.distanciaKm.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;

  if (taxaEntregaAtual.foraArea) {
    status.className = "aviso";
    status.textContent = `Esse endereço ultrapassa o limite automático de ${configuracaoTaxasEntrega().limiteKm.toLocaleString("pt-BR")} km. Consulte a loja.`;
    if (valor) valor.textContent = "A combinar";
  } else {
    status.className = "sucesso";
    status.textContent = "✓ Taxa calculada pela distância da rota.";
    if (valor) valor.textContent = formatarMoeda(taxaEntregaAtual.valor);
  }

  botao.textContent = "Recalcular entrega";
}

function invalidarTaxaEntrega() {
  solicitacaoEntregaAtual += 1;
  taxaEntregaAtual = null;
  atualizarInterfaceTaxaEntrega();
  atualizarCarrinho();
}

function cacheRota(chave) {
  const cache = carregarLocal(CACHE_ROTAS_ENTREGA, {});
  const item = cache?.[chave];
  if (!item || Date.now() - Number(item.salvoEm || 0) > TEMPO_CACHE_ROTA_MS) return null;
  return item;
}

function salvarCacheRota(chave, rota) {
  const cacheAtual = carregarLocal(CACHE_ROTAS_ENTREGA, {});
  const entradas = Object.entries({
    ...cacheAtual,
    [chave]: { ...rota, salvoEm: Date.now() }
  })
    .sort(([, a], [, b]) => Number(b.salvoEm || 0) - Number(a.salvoEm || 0))
    .slice(0, 12);
  salvarLocal(CACHE_ROTAS_ENTREGA, Object.fromEntries(entradas));
}

function aplicarRotaCalculada(rota, chave) {
  const distanciaKm = Number(rota.distanciaKm);
  const faixa = taxaPorDistancia(distanciaKm);
  if (!faixa) throw new Error("Distância inválida");

  taxaEntregaAtual = {
    estado: "calculada",
    chave,
    distanciaKm,
    duracaoMin: Number(rota.duracaoMin || 0),
    valor: faixa.valor,
    foraArea: faixa.foraArea
  };
  atualizarInterfaceTaxaEntrega();
  atualizarCarrinho();
}

async function calcularTaxaEntrega(forcar = false) {
  if (document.getElementById("tipoPedido")?.value !== "Entrega") return;
  const endereco = dadosEnderecoParaEntrega();

  if (!endereco.completo) {
    if (forcar) {
      taxaEntregaAtual = { estado: "erro", mensagem: endereco.origem
        ? "Complete rua, número e bairro para calcular."
        : "Cadastre o endereço completo da loja no painel administrativo." };
      atualizarInterfaceTaxaEntrega();
    }
    return;
  }

  if (!forcar && taxaEntregaAtual?.estado === "calculada" && taxaEntregaAtual.chave === endereco.chave) return;

  const rotaCache = cacheRota(endereco.chave);
  if (rotaCache && !forcar) {
    aplicarRotaCalculada(rotaCache, endereco.chave);
    return;
  }

  const idSolicitacao = ++solicitacaoEntregaAtual;
  taxaEntregaAtual = { estado: "calculando", chave: endereco.chave };
  atualizarInterfaceTaxaEntrega();
  atualizarCarrinho();

  try {
    const resposta = await fetch("/api/calcular-entrega", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ origem: endereco.origem, destino: endereco.destino })
    });
    const dados = await resposta.json().catch(() => ({}));
    if (idSolicitacao !== solicitacaoEntregaAtual) return;
    if (!resposta.ok) {
      const mensagem = dados.codigo === "GEOAPIFY_NAO_CONFIGURADA"
        ? "O cálculo automático ainda precisa ser ativado pela loja. A taxa será confirmada no WhatsApp."
        : (dados.erro || "Não foi possível calcular agora. A taxa será confirmada no WhatsApp.");
      throw new Error(mensagem);
    }

    salvarCacheRota(endereco.chave, dados);
    aplicarRotaCalculada(dados, endereco.chave);
  } catch (erro) {
    if (idSolicitacao !== solicitacaoEntregaAtual) return;
    taxaEntregaAtual = {
      estado: "erro",
      chave: endereco.chave,
      mensagem: limparTexto(erro?.message || "") || "Não foi possível calcular agora. A taxa será confirmada no WhatsApp."
    };
    atualizarInterfaceTaxaEntrega();
    atualizarCarrinho();
  }
}

function agendarCalculoTaxaEntrega() {
  window.clearTimeout(timerCalculoEntrega);
  invalidarTaxaEntrega();
  if (document.getElementById("tipoPedido")?.value !== "Entrega" || !dadosEnderecoParaEntrega().completo) return;
  timerCalculoEntrega = window.setTimeout(() => calcularTaxaEntrega(false), 750);
}

["cepCliente", "ruaCliente", "numeroCliente", "bairroCliente"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", agendarCalculoTaxaEntrega);
});

window.calcularTaxaEntrega = calcularTaxaEntrega;

function atualizarEstadoCardapio(erro, usandoCache = false) {
  const status = document.getElementById("statusCardapioSite");
  if (!status) return;

  status.classList.toggle("aviso", Boolean(erro));

  if (erro && usandoCache) {
    status.textContent = "Mostrando o último cardápio disponível. Confirme os itens pelo WhatsApp.";
  } else if (erro) {
    status.textContent = "Não foi possível carregar o cardápio agora. Tente novamente ou fale conosco pelo WhatsApp.";
  } else if (!produtos.length) {
    status.textContent = "O cardápio está sendo atualizado. Volte em alguns instantes.";
  } else {
    status.textContent = "Escolha seus favoritos e monte o pedido em poucos toques.";
  }
}

function formatarTelefoneExibicao(numero = "") {
  const digitos = String(numero).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return numero;
}

function normalizarUrlExterna(valor = "") {
  try {
    const url = new URL(limparTexto(valor));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function configuracaoTaxasEntrega() {
  const ate3Km = Math.max(0, Number(lojaConfig.taxasEntrega?.ate3Km ?? 5));
  const ate5Km = Math.max(0, Number(lojaConfig.taxasEntrega?.ate5Km ?? 7));
  const limiteKm = Math.max(3, Number(lojaConfig.taxasEntrega?.limiteKm ?? 5));
  return { ate3Km, ate5Km, limiteKm };
}

function textoFaixasEntrega() {
  const taxas = configuracaoTaxasEntrega();
  return `${formatarMoeda(taxas.ate3Km)} até 3 km • ${formatarMoeda(taxas.ate5Km)} até ${taxas.limiteKm.toLocaleString("pt-BR")} km`;
}


function aplicarConfiguracoesSite() {
  document.querySelectorAll(".brand strong").forEach(el => {
    el.textContent = lojaConfig.nomeLoja || "Delícias da Vó";
  });

  const entrega = document.getElementById("entregaTexto");
  const retirada = document.getElementById("retiradaTexto");
  const festaEntrega = document.getElementById("festaEntregaTexto");
  const status = document.getElementById("statusLojaTexto");

  if (entrega) entrega.textContent = textoFaixasEntrega();
  if (festaEntrega) festaEntrega.textContent = textoFaixasEntrega();
  if (retirada) retirada.textContent = lojaConfig.retirada || "Disponível na loja";

  const numeroWhatsApp = String(lojaConfig.whatsapp || APP_CONFIG.whatsapp).replace(/\D/g, "");
  const enderecoLoja = limparTexto(lojaConfig.endereco || "");
  const instagram = limparTexto(lojaConfig.instagram || "").replace(/^@/, "");
  const enderecoNome = limparTexto(lojaConfig.enderecoNome || "") || "Endereço da loja";
  const instagramNome = limparTexto(lojaConfig.instagramNome || "") || "Instagram da loja";
  const enderecoUrlConfigurada = normalizarUrlExterna(lojaConfig.enderecoUrl || "");
  const instagramUrlConfigurada = normalizarUrlExterna(lojaConfig.instagramUrl || "");
  const enderecoHref = enderecoUrlConfigurada || (enderecoLoja
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${enderecoLoja}, Votuporanga - SP`)}`
    : "");
  const instagramHref = instagramUrlConfigurada || (instagram
    ? `https://www.instagram.com/${encodeURIComponent(instagram)}/`
    : "");
  const footerWhatsApp = document.getElementById("footerWhatsApp");
  const footerEndereco = document.getElementById("footerEndereco");
  const footerInstagram = document.getElementById("footerInstagram");
  const btnWhatsapp = document.getElementById("btnWhatsappLoja");
  const btnEndereco = document.getElementById("btnEnderecoLoja");
  const btnInstagram = document.getElementById("btnInstagramLoja");

  if (footerWhatsApp) {
    footerWhatsApp.href = `https://wa.me/${numeroWhatsApp}`;
    footerWhatsApp.textContent = `📱 ${formatarTelefoneExibicao(numeroWhatsApp)}`;
  }

  if (btnWhatsapp) {
    btnWhatsapp.href = `https://wa.me/${numeroWhatsApp}`;
  }

  if (footerEndereco) {
    footerEndereco.hidden = !enderecoHref;
    footerEndereco.href = enderecoHref || "#";
    footerEndereco.textContent = `📍 ${enderecoNome}`;
  }

  if (btnEndereco) {
    btnEndereco.hidden = !enderecoHref;
    btnEndereco.href = enderecoHref || "#";
    const texto = btnEndereco.querySelector("strong");
    if (texto) texto.textContent = enderecoNome;
  }

  if (footerInstagram) {
    footerInstagram.hidden = !instagramHref;
    footerInstagram.href = instagramHref || "#";
    footerInstagram.textContent = `📷 ${instagramNome}`;
  }

  if (btnInstagram) {
    btnInstagram.hidden = !instagramHref;
    btnInstagram.href = instagramHref || "#";
    const texto = btnInstagram.querySelector("strong");
    if (texto) texto.textContent = instagramNome;
  }

  if (status) {
  const resultado = calcularStatusAtendimento();
  status.innerHTML = "";
  status.textContent = resultado.texto;
}

  if (taxaEntregaAtual?.estado === "calculada") {
    const faixa = taxaPorDistancia(taxaEntregaAtual.distanciaKm);
    taxaEntregaAtual = { ...taxaEntregaAtual, ...faixa };
  }
  atualizarInterfaceTaxaEntrega();
  atualizarCarrinho();
}


function renderCardapioDiaSite() {
  const section = document.getElementById("cardapioDiaSite");
  if (!section) return;

  const cardapioAtualTemItens = Array.isArray(cardapioDiarioAtual?.itens) && cardapioDiarioAtual.itens.some(Boolean);
  const cardapio = cardapioAtualTemItens ? cardapioDiarioAtual : (lojaConfig.cardapioDia || {});
  const itens = Array.isArray(cardapio.itens) ? cardapio.itens.filter(Boolean) : [];

  const publicado = cardapioAtualTemItens ? cardapio.publicado === true : cardapio.ativo === true;
  if (!publicado || !itens.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  const titulo = document.getElementById("cardapioDiaTitulo");
  const observacao = document.getElementById("cardapioDiaObservacao");
  const lista = document.getElementById("cardapioDiaItens");

  if (titulo) titulo.textContent = cardapio.titulo || "Cardápio de hoje";

  if (observacao) {
    observacao.textContent = cardapio.observacao || "";
    observacao.style.display = cardapio.observacao ? "block" : "none";
  }

  if (lista) {
    lista.innerHTML = "";

    itens.forEach(item => {
      const el = document.createElement("span");
      el.textContent = item;
      lista.appendChild(el);
    });
  }
}


function minutosDoHorario(horario = "") {
  const [hora, minuto] = horario.split(":").map(Number);
  if (!Number.isFinite(hora) || !Number.isFinite(minuto)) return null;
  return hora * 60 + minuto;
}

function formatarPeriodosAtendimento(periodos = []) {
  const validos = periodos.filter(periodo => periodo?.inicio && periodo?.fim);
  if (!validos.length) return "";
  return validos.map(periodo => `${periodo.inicio}–${periodo.fim}`).join(" e ");
}

function agoraNaLoja(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: APP_CONFIG.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(data).map(parte => [parte.type, parte.value]));

  const indices = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    indiceDia: indices[partes.weekday] ?? data.getDay(),
    hora: Number(partes.hour || 0),
    minuto: Number(partes.minute || 0)
  };
}

function dataISOHojeLoja(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data).map(parte => [parte.type, parte.value]));

  return `${partes.year}-${partes.month}-${partes.day}`;
}

function calcularStatusAtendimento() {
  const horarios = lojaConfig.horariosAtendimento || {};
  const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const nomesDias = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const agora = agoraNaLoja();
  const indiceHoje = agora.indiceDia;
  const diaAtual = dias[indiceHoje];
  const minutoAtual = agora.hora * 60 + agora.minuto;
  const configHoje = horarios[diaAtual];
  const periodosHoje = (configHoje?.periodos || [])
    .filter(periodo => periodo?.inicio && periodo?.fim)
    .sort((a, b) => minutosDoHorario(a.inicio) - minutosDoHorario(b.inicio));

  if (lojaConfig.statusLoja === "fechada") {
    return {
      aberto: false,
      texto: "🔴 Fechado no momento",
      motivo: "fechamento_manual",
      horarioHoje: formatarPeriodosAtendimento(periodosHoje)
    };
  }

  if (configHoje && configHoje.fechado !== true && periodosHoje.length) {
    for (const periodo of periodosHoje) {
      const inicio = minutosDoHorario(periodo.inicio);
      const fim = minutosDoHorario(periodo.fim);

      if (minutoAtual >= inicio && minutoAtual <= fim) {
        const minutosParaFechar = fim - minutoAtual;
        return {
          aberto: true,
          texto: minutosParaFechar <= 30 && minutosParaFechar > 0
            ? `🟡 Fechando em breve · fecha às ${periodo.fim}`
            : `🟢 Aberto agora até ${periodo.fim}`,
          periodoAtual: periodo,
          horarioHoje: formatarPeriodosAtendimento(periodosHoje)
        };
      }

      if (minutoAtual < inicio) {
        return {
          aberto: false,
          texto: `🔴 Fechado · abrimos hoje às ${periodo.inicio}`,
          proximaAbertura: `Hoje, às ${periodo.inicio}`,
          horarioHoje: formatarPeriodosAtendimento(periodosHoje)
        };
      }
    }
  }

  for (let deslocamento = 1; deslocamento <= 7; deslocamento++) {
    const indice = (indiceHoje + deslocamento) % 7;
    const chaveDia = dias[indice];
    const configDia = horarios[chaveDia];
    const periodos = (configDia?.periodos || [])
      .filter(periodo => periodo?.inicio && periodo?.fim)
      .sort((a, b) => minutosDoHorario(a.inicio) - minutosDoHorario(b.inicio));

    if (configDia?.fechado !== true && periodos.length) {
      const rotulo = deslocamento === 1 ? "Amanhã" : nomesDias[indice];
      return {
        aberto: false,
        texto: `🔴 Fechado · abrimos ${rotulo.toLowerCase()} às ${periodos[0].inicio}`,
        proximaAbertura: `${rotulo}, às ${periodos[0].inicio}`,
        horarioHoje: formatarPeriodosAtendimento(periodosHoje)
      };
    }
  }

  return {
    aberto: false,
    texto: "🔴 Fechado no momento",
    horarioHoje: formatarPeriodosAtendimento(periodosHoje)
  };
}

function abrirAvisoLojaFechada(status) {
  const modal = document.getElementById("modalLojaFechada");
  const texto = document.getElementById("textoLojaFechada");
  const horario = document.getElementById("horarioLojaFechada");
  if (!modal) return;

  if (texto) {
    texto.textContent = status?.motivo === "fechamento_manual"
      ? "A loja foi fechada temporariamente e não está recebendo pedidos agora."
      : "No momento não estamos recebendo pedidos pelo cardápio normal.";
  }

  if (horario) {
    if (status?.proximaAbertura) {
      horario.innerHTML = `<span>🕒 Próximo atendimento</span><strong>${status.proximaAbertura}</strong>`;
    } else if (status?.horarioHoje) {
      horario.innerHTML = `<span>🕒 Horário de hoje</span><strong>${status.horarioHoje}</strong>`;
    } else {
      horario.innerHTML = `<span>🕒 Atendimento</span><strong>Consulte nossos horários no site</strong>`;
    }
  }

  modal.classList.add("aberto");
}

function fecharAvisoLojaFechada() {
  document.getElementById("modalLojaFechada")?.classList.remove("aberto");
}

window.fecharAvisoLojaFechada = fecharAvisoLojaFechada;

function precoProduto(produto) {
  const promo = promocaoAtivaParaProduto(produto.id);

  if (Array.isArray(produto.variacoes) && produto.variacoes.length) {
    const disponiveis = produto.variacoes.filter(v =>
      v.ativa !== false && (v.sobEncomenda || Number(v.estoque || 0) > 0)
    );

    const precoBase = disponiveis.length
      ? Math.min(...disponiveis.map(v => Number(v.preco || produto.preco || 0)))
      : Number(produto.preco || 0);

    return promo ? Number(promo.precoPromocional || precoBase) : Number(precoBase);
  }

  return promo ? Number(promo.precoPromocional || produto.preco) : Number(produto.preco || 0);
}
function cardProduto(produto) {
  const status = statusEstoque(produto);
  const promo = promocaoAtivaParaProduto(produto.id);
  const precoFinal = precoProduto(produto);

  return createProductCard(produto, {
    promo: Boolean(promo),
    statusClass: status.classe,
    badgeText: promo ? 'Promoção' : status.texto,
    description: promo?.descricao || produto.descricao || '',
    showOldPrice: Boolean(promo),
    price: precoFinal,
    available: status.disponivel,
    buttonText: Array.isArray(produto.variacoes) && produto.variacoes.length ? 'Escolher' : undefined
  });
}

function renderPromocoesSite() {
  const box = document.getElementById("listaPromocoesSite");
  if (!box) return;

  box.innerHTML = "";
  const section = document.getElementById("promocoes");

  const hoje = dataISOHojeLoja();

  const ativas = promocoes.filter(p => {
    if (!p.ativa) return false;

    const inicioOk = !p.inicio || p.inicio <= hoje;
    const fimOk = !p.fim || p.fim >= hoje;

    return inicioOk && fimOk;
  }).filter(promo => produtos.some(produto => produto.id === promo.produtoId && produto.ativo !== false && produtoLiberadoNoCardapio(produto.id)));

  if (!ativas.length) {
    if (section) section.hidden = true;
    return;
  }

  if (section) section.hidden = false;

  ativas.forEach(promo => {
    const produto = produtos.find(p => p.id === promo.produtoId);
    if (!produto || produto.ativo === false || !produtoLiberadoNoCardapio(produto.id)) return;

    const card = createProductCard(produto, {
      promo: true,
      badgeText: 'Promoção',
      description: promo.descricao || produto.descricao || '',
      showOldPrice: true,
      price: promo.precoPromocional,
      available: true
    });

    box.appendChild(card);
  });
}

function renderizarGrupo(container, categoria, titulo, descricao) {
  const lista = produtos.filter(p => p.ativo !== false && produtoLiberadoNoCardapio(p.id) && p.categoria === categoria);

  if (!lista.length) return;

  const bloco = document.createElement('section');
  bloco.className = 'categoria-bloco';
  const h3 = document.createElement('h3'); h3.textContent = titulo; bloco.appendChild(h3);
  if (descricao) {
    const p = document.createElement('p'); p.textContent = descricao; bloco.appendChild(p);
  }
  const grid = document.createElement('div'); grid.className = 'produtos-grid'; bloco.appendChild(grid);

  lista.forEach(produto => grid.appendChild(cardProduto(produto)));

  container.appendChild(bloco);
}

function renderizarProdutos(categoria = "todos") {
  categoriaAtual = categoria;

  const container = document.getElementById("listaProdutos");
  container.innerHTML = "";

  if (categoria !== 'todos') {
    const bloco = document.createElement('section'); bloco.className = 'categoria-bloco';
    const grid = document.createElement('div'); grid.className = 'produtos-grid'; bloco.appendChild(grid);

    produtos
      .filter(p => p.ativo !== false && produtoLiberadoNoCardapio(p.id) && p.categoria === categoria)
      .forEach(p => grid.appendChild(cardProduto(p)));

    container.appendChild(bloco);
    return;
  }

  const categoriasAtivas = normalizarCategorias(categorias.length ? categorias : categoriasBase).filter(c => c.ativa !== false);

  categoriasAtivas.forEach(cat => renderizarGrupo(container, cat.id, `${cat.emoji || '🏷️'} ${cat.nome}`, cat.descricao || ''));
}

function renderCategoriasSite() {
  const container = document.getElementById('categoriasSite');
  if (!container) return;

  const categoriasAtivas = normalizarCategorias(categorias.length ? categorias : categoriasBase).filter(c => c.ativa !== false);
  container.innerHTML = '';

  const todosBtn = document.createElement('button');
  todosBtn.className = `categoria ${categoriaAtual === 'todos' ? 'ativa' : ''}`;
  todosBtn.textContent = 'Todos';
  todosBtn.addEventListener('click', event => filtrarCategoriaImpl(event, 'todos'));
  container.appendChild(todosBtn);

  categoriasAtivas.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `categoria ${categoriaAtual === cat.id ? 'ativa' : ''}`;
    btn.textContent = `${cat.emoji || '🏷️'} ${cat.nome}`;
    btn.addEventListener('click', event => filtrarCategoriaImpl(event, cat.id));
    container.appendChild(btn);
  });
}

function filtrarCategoriaImpl(event, categoria) {
  document.querySelectorAll('.categoria').forEach(btn => btn.classList.remove('ativa'));
  if (event && event.target) event.target.classList.add('ativa');
  renderizarProdutos(categoria);
}

function pesquisarProdutosImpl() {
  const termo = limparTexto(document.getElementById('buscaProduto').value).toLowerCase();
  const container = document.getElementById('listaProdutos');

  container.innerHTML = '';
  const bloco = document.createElement('section'); bloco.className = 'categoria-bloco';
  const grid = document.createElement('div'); grid.className = 'produtos-grid'; bloco.appendChild(grid);

  produtos
    .filter(p => p.ativo !== false && produtoLiberadoNoCardapio(p.id))
    .filter(p =>
      p.nome.toLowerCase().includes(termo) ||
      (p.descricao || '').toLowerCase().includes(termo) ||
      (p.categoria || '').includes(termo)
    )
    .forEach(p => grid.appendChild(cardProduto(p)));

  container.appendChild(bloco);
}

function abrirCarrinhoImpl(focar = true) {
  const carrinhoEl = document.getElementById("carrinho");
  if (!document.body.classList.contains("cart-open")) ultimoFocoAntesCarrinho = document.activeElement;
  carrinhoEl?.classList.add("aberto");
  carrinhoEl?.setAttribute("aria-hidden", "false");
  document.body.classList.add("cart-open");

  if (focar) {
    window.setTimeout(() => {
      carrinhoEl?.querySelector(".cart-head button")?.focus({ preventScroll: true });
    }, 30);
  }
}

function fecharCarrinhoImpl() {
  const carrinhoEl = document.getElementById("carrinho");
  carrinhoEl?.classList.remove("aberto");
  carrinhoEl?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cart-open");

  if (ultimoFocoAntesCarrinho?.isConnected) ultimoFocoAntesCarrinho.focus({ preventScroll: true });
}


function chaveCarrinho(produtoId, variacaoId = "", sabor = "") {
  return `${produtoId}__${variacaoId || ""}__${sabor || ""}`;
}

function adicionarCarrinhoImpl(id) {
  const produto = produtos.find(p => p.id === id);
  if (!produto) return;

  const precoFinal = precoProduto(produto);

  // normalizar sabores: aceitar string separado por vírgula ou array
  let sabores = produto.sabores;
  if (typeof sabores === 'string') {
    sabores = sabores.split(',').map(s => limparTexto(s)).filter(Boolean);
  }

  // se o produto tem variações, abrir modal de variação
  if (Array.isArray(produto.variacoes) && produto.variacoes.length) {
    abrirModalSabores(produto);
    return;
  }

  // se o produto tem sabores, abrir modal para escolher
  if (Array.isArray(sabores) && sabores.length > 0) {
    console.debug('abrindo modal de sabores para', produto.id, sabores);
    // garantir que abrirModalSabores receba a lista normalizada
    abrirModalSabores(Object.assign({}, produto, { sabores }));
    return;
  }

  // sem sabores: adicionar direto
  const chave = chaveCarrinho(produto.id);
  const item = carrinho.find(i => (i.chave || chaveCarrinho(i.id, i.variacaoId, i.sabor)) === chave);

  if (item) item.quantidade++;
  else carrinho.push({ chave, id: produto.id, nome: produto.nome, emoji: produto.emoji || "🛒", preco: precoFinal, quantidade: 1, estoqueAtual: Number(produto.estoque || 0), observacao: "" });

  atualizarCarrinho();
  abrirCarrinhoImpl();

}

window.filtrarCategoria = filtrarCategoriaImpl;
window.pesquisarProdutos = pesquisarProdutosImpl;
window.abrirCarrinho = abrirCarrinhoImpl;
window.fecharCarrinho = fecharCarrinhoImpl;
window.adicionarCarrinho = adicionarCarrinhoImpl;

window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;

  if (document.getElementById("modalPerfilCliente")?.classList.contains("aberto")) {
    fecharPerfilCliente();
    return;
  }

  if (document.getElementById("modalRevisaoPedido")?.classList.contains("aberto")) {
    fecharRevisaoPedido();
    return;
  }

  if (document.getElementById("modalComprovanteFesta")?.classList.contains("aberto")) {
    fecharComprovanteFesta();
    return;
  }

  if (document.getElementById("modalSabores")?.classList.contains("aberto")) {
    fecharModalSabores();
    return;
  }

  fecharCarrinhoImpl();
});

document.getElementById("modalPerfilCliente")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) fecharPerfilCliente();
});

function atualizarCarrinho() {
  const box = document.getElementById("itensCarrinho");
  box.innerHTML = "";

  if (!carrinho.length) {
    const p = document.createElement('p'); p.textContent = 'Seu carrinho está vazio.'; box.appendChild(p);
  }

  carrinho.forEach(item => {
    const wrapper = document.createElement('div'); wrapper.className = 'item-cart';
    const cabecalho = document.createElement('div');
    cabecalho.className = 'item-cart-cabecalho';

    const icone = document.createElement('span');
    icone.className = 'item-cart-emoji';
    const produtoAtual = produtos.find(produto => produto.id === item.id);
    icone.textContent = item.emoji || produtoAtual?.emoji || '🛒';

    const strong = document.createElement('strong');
    strong.textContent = `${item.quantidade}x ${item.nome}`;

    cabecalho.appendChild(icone);
    cabecalho.appendChild(strong);
    wrapper.appendChild(cabecalho);
    if (item.sabor) {
      const saborSpan = document.createElement('span');
      saborSpan.className = 'item-sabor';
      saborSpan.textContent = `Opção: ${item.sabor}`;
      wrapper.appendChild(saborSpan);
    }

    if (item.ingredientes) {
      const ingredientesSpan = document.createElement('span');
      ingredientesSpan.className = 'item-ingredientes';
      ingredientesSpan.textContent = `Ingredientes: ${item.ingredientes}`;
      wrapper.appendChild(ingredientesSpan);
    }

    const obs = document.createElement('textarea');
    obs.className = 'obs-item';
    obs.placeholder = 'Observação deste item. Ex: sem tomate, sem cebola...';
    obs.value = item.observacao || '';
    obs.addEventListener('input', () => {
      item.observacao = obs.value;
      salvarLocal(APP_CONFIG.storageCarrinho, carrinho);
    });
    wrapper.appendChild(obs);

    const small = document.createElement('small'); small.textContent = formatarMoeda(item.preco * item.quantidade); wrapper.appendChild(small);
    const actions = document.createElement('div'); actions.className = 'item-actions';
    const btnMinus = document.createElement('button'); btnMinus.type = 'button'; btnMinus.textContent = '-'; btnMinus.setAttribute('aria-label', `Remover uma unidade de ${item.nome}`); btnMinus.addEventListener('click', () => window.alterarItem && window.alterarItem(item.chave || chaveCarrinho(item.id, item.variacaoId, item.sabor), -1));
    const btnPlus = document.createElement('button'); btnPlus.type = 'button'; btnPlus.textContent = '+'; btnPlus.setAttribute('aria-label', `Adicionar uma unidade de ${item.nome}`); btnPlus.addEventListener('click', () => window.alterarItem && window.alterarItem(item.chave || chaveCarrinho(item.id, item.variacaoId, item.sabor), 1));
    actions.appendChild(btnMinus); actions.appendChild(btnPlus); wrapper.appendChild(actions);
    box.appendChild(wrapper);
  });

  const subtotal = carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
  const entregaSelecionada = document.getElementById("tipoPedido")?.value === "Entrega";
  const taxaValida = entregaSelecionada
    && taxaEntregaAtual?.estado === "calculada"
    && !taxaEntregaAtual.foraArea
    && taxaEntregaAtual.chave === dadosEnderecoParaEntrega().chave;
  const taxaAplicadaNoTotal = taxaValida && subtotal > 0;
  const total = subtotal + (taxaAplicadaNoTotal ? Number(taxaEntregaAtual.valor || 0) : 0);
  const quantidade = carrinho.reduce((soma, item) => soma + item.quantidade, 0);

  document.getElementById("totalPedido").textContent = formatarMoeda(total);
  const rotuloTotal = document.getElementById("rotuloTotalPedido");
  if (rotuloTotal) {
    rotuloTotal.textContent = entregaSelecionada
      ? (taxaAplicadaNoTotal ? "Total com entrega" : "Subtotal sem a taxa")
      : "Total";
  }
  document.getElementById("contadorItens").textContent = quantidade;
  const contadorTopo = document.getElementById("contadorTopo");
  if (contadorTopo) contadorTopo.textContent = quantidade;

  salvarLocal(APP_CONFIG.storageCarrinho, carrinho);
}

function alterarItemImpl(chave, valor) {
  const manterCarrinhoAberto = document.getElementById("carrinho")?.classList.contains("aberto");
  const itemIndex = carrinho.findIndex(i => (i.chave || chaveCarrinho(i.id, i.variacaoId, i.sabor)) === chave);
  if (itemIndex === -1) return;

  const item = carrinho[itemIndex];
  item.quantidade += valor;

  if (item.quantidade <= 0) {
    carrinho.splice(itemIndex, 1);
  }

  atualizarCarrinho();
  if (manterCarrinhoAberto) abrirCarrinhoImpl(false);
}

// Modal de sabores

function textoIngredientes(valor) {
  if (Array.isArray(valor)) return valor.filter(Boolean).join(", ");
  return valor || "";
}

function ingredientesDaEscolha(escolha) {
  if (escolha && typeof escolha === "object") {
    return textoIngredientes(escolha.ingredientes);
  }

  return "";
}

function criarLinhaIngredientesModal(ingredientesTexto) {
  if (!ingredientesTexto) return null;

  const div = document.createElement("div");
  div.className = "ingredientes-opcao";
  div.innerHTML = `<strong>Ingredientes:</strong> ${ingredientesTexto}`;
  return div;
}


function abrirModalSabores(produto) {
  pendingSaborProdutoId = produto.id;
  const modal = document.getElementById('modalSabores');
  const list = document.getElementById('listaSaboresModal');
  if (!modal) { console.warn('modalSabores element not found'); alert('Erro: modal de variações não encontrado.'); return; }
  if (!list) { console.warn('listaSaboresModal element not found'); alert('Erro: lista de opções não encontrada.'); modal.classList.remove('aberto'); return; }
  list.innerHTML = '';

  const opcoes = Array.isArray(produto.variacoes) && produto.variacoes.length ? produto.variacoes : (produto.sabores || []);
  const titulo = document.querySelector('#modalSabores h2');
  if (titulo) {
    const categoria = categoriaPorId(produto.categoria);
    titulo.textContent = categoria?.tituloSelecao || (Array.isArray(produto.variacoes) && produto.variacoes.length ? 'Escolha uma variação' : 'Escolha um sabor');
  }

  if (Array.isArray(produto.variacoes) && produto.variacoes.length) {
    opcoes
      .filter(v => v.ativa !== false)
      .forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'sabor-btn';
        btn.innerHTML = `<strong>${v.nome}</strong><small>${Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v.preco)}${v.sobEncomenda ? ' · Sob encomenda' : ''}</small>`;

        const ingredientesTexto = textoIngredientes(v.ingredientes);
        const ingredientesEl = criarLinhaIngredientesModal(ingredientesTexto);
        if (ingredientesEl) btn.appendChild(ingredientesEl);

        btn.disabled = v.ativa === false;
        btn.addEventListener('click', () => confirmarSabor(produto.id, v));
        list.appendChild(btn);
      });
  } else {
    opcoes.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'sabor-btn';
      btn.textContent = s;
      btn.addEventListener('click', () => confirmarSabor(produto.id, s));
      list.appendChild(btn);
    });
  }

  const cancelar = document.getElementById('cancelarSabor');
  if (cancelar) cancelar.onclick = fecharModalSabores;
  const fechar = document.getElementById('fecharModalSabores');
  if (fechar) fechar.onclick = fecharModalSabores;

  modal.classList.add('aberto');
}

function fecharModalSabores() {
  const modal = document.getElementById('modalSabores');
  if (!modal) return;
  modal.classList.remove('aberto');
  pendingSaborProdutoId = null;
}

function confirmarSabor(produtoId, escolha) {
  const produto = produtos.find(p => p.id === produtoId);
  if (!produto) return;

  const isVariacao = escolha && typeof escolha === 'object' && escolha.nome;
  const variacaoId = isVariacao ? escolha.id : undefined;
  const sabor = isVariacao ? escolha.nome : escolha;
  const precoFinal = isVariacao ? Number(escolha.preco || precoProduto(produto)) : precoProduto(produto);
  const estoqueAtual = isVariacao ? Number(escolha.estoque || produto.estoque || 0) : Number(produto.estoque || 0);
  const ingredientesOpcao = ingredientesDaEscolha(escolha);

  const chave = chaveCarrinho(produto.id, variacaoId, sabor);
  const item = carrinho.find(i => (i.chave || chaveCarrinho(i.id, i.variacaoId, i.sabor)) === chave);
  if (item) item.quantidade++;
  else carrinho.push({ chave, id: produto.id, variacaoId, nome: produto.nome, emoji: produto.emoji || "🛒", preco: precoFinal, quantidade: 1, sabor, ingredientes: ingredientesOpcao, estoqueAtual, observacao: "" });

  atualizarCarrinho();
  fecharModalSabores();
  abrirCarrinhoImpl();
}


function textoWhatsApp(valor) {
  return encodeURIComponent(valor);
}

function montarMensagemPedidoWhatsApp(pedido) {
  const linhasItens = pedido.itens.map(item => {
    const opcao = item.sabor ? `\n   Opção: ${item.sabor}` : "";
    const ingredientes = item.ingredientes ? `\n   Ingredientes: ${item.ingredientes}` : "";
    const observacao = item.observacao ? `\n   Obs: ${item.observacao}` : "";
    return `• ${item.quantidade}x ${item.nome}${opcao}${ingredientes}${observacao}\n  ${formatarMoeda(item.subtotal)}`;
  }).join("\n\n");

  const tipoEntrega = pedido.tipo === "Entrega" ? "🚚 ENTREGA" : "🏪 RETIRADA NA LOJA";
  const endereco = pedido.tipo === "Entrega"
    ? `\n📍 Endereço\n${pedido.endereco}\n`
    : "";
  const entregaCalculada = pedido.tipo === "Entrega" && Number.isFinite(Number(pedido.taxaEntrega));
  const resumoTaxa = pedido.tipo === "Entrega"
    ? entregaCalculada
      ? `📏 Distância da rota: ${Number(pedido.distanciaEntregaKm).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km\n🛵 Taxa de entrega: ${formatarMoeda(pedido.taxaEntrega)}\n🧾 Subtotal dos produtos: ${formatarMoeda(pedido.subtotalProdutos)}\n`
      : "🛵 Taxa de entrega: a confirmar pelo WhatsApp\n"
    : "";
  const tituloTotal = pedido.tipo === "Entrega" && !entregaCalculada ? "💰 SUBTOTAL SEM A TAXA" : "💰 TOTAL";

  return `━━━━━━━━━━━━━━━━━━━━━━
🍽️ DELÍCIAS DA VÓ

📦 Pedido ${pedido.numeroFormatado}
📅 ${pedido.dataBR}
🕒 ${pedido.horaBR}

━━━━━━━━━━━━━━━━━━━━━━

👤 CLIENTE
${pedido.cliente.nome}${pedido.cliente.telefone ? `\n📱 ${pedido.cliente.telefone}` : ""}

🛒 PEDIDO

${linhasItens}

━━━━━━━━━━━━━━━━━━━━━━

${tipoEntrega}
${endereco}
${resumoTaxa}
💳 PAGAMENTO
${pedido.pagamento}

━━━━━━━━━━━━━━━━━━━━━━

${tituloTotal}
${formatarMoeda(pedido.total)}

━━━━━━━━━━━━━━━━━━━━━━

Obrigado pela preferência ❤️`;
}

function setBotaoFinalizarPedido(texto, desabilitado = false) {
  const botao = document.getElementById("btnFinalizarPedido");
  if (!botao) return;

  botao.textContent = texto;
  botao.disabled = desabilitado;
}



let urlWhatsAppPedidoPendente = "";

function escaparHtmlRevisao(valor = "") {
  return String(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function abrirRevisaoPedido(dados) {
  const modal = document.getElementById("modalRevisaoPedido");
  const numero = document.getElementById("revisaoNumeroPedido");
  const itens = document.getElementById("revisaoItensPedido");
  const detalhes = document.getElementById("revisaoDetalhesPedido");
  const total = document.getElementById("revisaoTotalPedido");
  const totalRotulo = document.getElementById("revisaoTotalRotulo");
  if (!modal) return;

  urlWhatsAppPedidoPendente = dados.urlWhatsApp || "";
  if (numero) numero.textContent = dados.numero || "Pedido";

  if (itens) {
    itens.innerHTML = (dados.itens || []).map(item => {
      const complemento = [item.sabor, item.ingredientes].filter(Boolean).join(" • ");
      const subtotal = Number(item.subtotal || (Number(item.preco || 0) * Number(item.quantidade || 0)));
      return `<div class="revisao-item">
        <div><strong>${Number(item.quantidade || 0)}× ${escaparHtmlRevisao(item.nome || "Item")}</strong>
        ${complemento ? `<small>${escaparHtmlRevisao(complemento)}</small>` : ""}</div>
        <b>${formatarMoeda(subtotal)}</b>
      </div>`;
    }).join("");
  }

  if (detalhes) {
    detalhes.innerHTML = `
      <span><b>📦 Recebimento</b>${escaparHtmlRevisao(dados.tipo || "Retirada")}</span>
      ${dados.tipo === "Entrega" && dados.endereco ? `<span><b>📍 Endereço</b>${escaparHtmlRevisao(dados.endereco)}</span>` : ""}
      ${dados.tipo === "Entrega" ? `<span><b>🛵 Taxa de entrega</b>${escaparHtmlRevisao(dados.taxaEntregaTexto || "A confirmar pelo WhatsApp")}</span>` : ""}
      <span><b>💳 Pagamento</b>${escaparHtmlRevisao(dados.pagamento || "Não informado")}</span>`;
  }

  if (total) total.textContent = formatarMoeda(dados.total || 0);
  if (totalRotulo) totalRotulo.textContent = dados.totalIncluiTaxa === false ? "Subtotal sem a taxa" : "Total do pedido";

  fecharCarrinhoImpl();
  document.body.classList.add("modal-em-foco");
  modal.classList.add("aberto");
}

function fecharRevisaoPedido() {
  document.getElementById("modalRevisaoPedido")?.classList.remove("aberto");
  document.body.classList.remove("modal-em-foco");
}

function limparCarrinhoAposEnvio() {
  carrinho = [];
  window.clearTimeout(timerCalculoEntrega);
  solicitacaoEntregaAtual += 1;
  taxaEntregaAtual = null;
  salvarLocal(APP_CONFIG.storageCarrinho, carrinho);
  atualizarCarrinho();

  const cep = document.getElementById("cepCliente");
  if (cep) cep.value = "";
  const statusCep = document.getElementById("statusCepCliente");
  if (statusCep) statusCep.textContent = "";

  const camposParaLimpar = [
    "nomeCliente",
    "telefoneCliente",
    "ruaCliente",
    "numeroCliente",
    "bairroCliente",
    "complementoCliente"
  ];

  if (!window.usuarioAtual) {
    camposParaLimpar.forEach(id => {
      const campo = document.getElementById(id);
      if (campo) campo.value = "";
    });
  }

  const tipoPedido = document.getElementById("tipoPedido");
  if (tipoPedido) tipoPedido.value = "Retirada na loja";
  atualizarEnderecoPedidoNormal();

  const pix = document.querySelector('input[name="pagamentoVisual"][value="Pix"]');
  if (pix) {
    pix.checked = true;
    selecionarPagamento(pix);
  }

  if (window.usuarioAtual) preencherDadosCliente(window.perfilClienteAtual);
}

function confirmarPedidoNoWhatsApp() {
  if (!urlWhatsAppPedidoPendente) return;
  const url = urlWhatsAppPedidoPendente;

  limparCarrinhoAposEnvio();
  fecharRevisaoPedido();
  urlWhatsAppPedidoPendente = "";
  window.open(url, "_blank");
}

window.fecharRevisaoPedido = fecharRevisaoPedido;
window.confirmarPedidoNoWhatsApp = confirmarPedidoNoWhatsApp;



function selecionarPagamento(input) {
  const valor = input?.value || "Pix";
  const campo = document.getElementById("pagamento");
  if (campo) campo.value = valor;
  document.querySelectorAll(".pagamento-card").forEach(card => {
    card.classList.toggle("ativo", card.contains(input));
  });
}
window.selecionarPagamento = selecionarPagamento;

function atualizarEnderecoPedidoNormal() {
  const tipo = document.getElementById("tipoPedido")?.value || "Retirada na loja";
  const campos = document.getElementById("camposEnderecoPedidoNormal");
  if (campos) campos.hidden = tipo !== "Entrega";

  if (tipo === "Entrega") {
    atualizarInterfaceTaxaEntrega();
    if (dadosEnderecoParaEntrega().completo) agendarCalculoTaxaEntrega();
  } else {
    window.clearTimeout(timerCalculoEntrega);
    solicitacaoEntregaAtual += 1;
    taxaEntregaAtual = null;
    atualizarCarrinho();
  }
}
window.atualizarEnderecoPedidoNormal = atualizarEnderecoPedidoNormal;

function montarEndereco({ rua, numero, bairro, complemento }) {
  const partes = [
    rua && numero ? `${rua}, ${numero}` : rua || numero,
    bairro,
    complemento
  ].filter(Boolean);
  return partes.join(" • ");
}

async function finalizarPedidoImpl() {
  if (sincronizarCarrinhoDisponibilidade(true)) {
    atualizarCarrinho();
    alert("O cardápio ou o estoque mudou. Ajustamos seu carrinho; confira os itens antes de continuar.");
    return;
  }
  if (!carrinho.length) {
    alert("Adicione pelo menos um produto.");
    return;
  }

  const statusAtendimento = calcularStatusAtendimento();
  if (!statusAtendimento.aberto) {
    abrirAvisoLojaFechada(statusAtendimento);
    return;
  }

  const nome = limparTexto(document.getElementById("nomeCliente").value);
  const telefone = limparTexto(document.getElementById("telefoneCliente")?.value || "");
  const tipo = document.getElementById("tipoPedido").value;
  const rua = limparTexto(document.getElementById("ruaCliente")?.value || "");
  const numeroEndereco = limparTexto(document.getElementById("numeroCliente")?.value || "");
  const bairro = limparTexto(document.getElementById("bairroCliente")?.value || "");
  const complemento = limparTexto(document.getElementById("complementoCliente")?.value || "");
  const endereco = montarEndereco({ rua, numero: numeroEndereco, bairro, complemento });
  const pagamento = document.getElementById("pagamento").value;

  if (!nome) {
    alert("Digite seu nome.");
    return;
  }

  if (tipo === "Entrega" && (!rua || !numeroEndereco || !bairro)) {
    alert("Preencha a rua, o número e o bairro para entrega.");
    return;
  }

  if (tipo === "Entrega") {
    const enderecoCalculo = dadosEnderecoParaEntrega();
    const calculoAtualValido = taxaEntregaAtual?.estado === "calculada"
      && taxaEntregaAtual.chave === enderecoCalculo.chave;
    if (!calculoAtualValido) {
      setBotaoFinalizarPedido("📍 Calculando entrega...", true);
      await calcularTaxaEntrega(true);
    }
  }

  setBotaoFinalizarPedido("⏳ Preparando pedido...", true);

  try {
    await salvarDadosCliente("normal");

    const itens = carrinho.map(item => ({
      id: item.id,
      variacaoId: item.variacaoId || "",
      nome: item.nome,
      sabor: item.sabor || "",
      ingredientes: item.ingredientes || "",
      observacao: limparTexto(item.observacao || ""),
      quantidade: Number(item.quantidade || 0),
      preco: Number(item.preco || 0),
      subtotal: Number(item.preco || 0) * Number(item.quantidade || 0)
    }));

    const subtotalProdutos = itens.reduce((soma, item) => soma + item.subtotal, 0);
    const enderecoCalculo = dadosEnderecoParaEntrega();
    const taxaEntregaValida = tipo === "Entrega"
      && taxaEntregaAtual?.estado === "calculada"
      && !taxaEntregaAtual.foraArea
      && taxaEntregaAtual.chave === enderecoCalculo.chave;
    const taxaEntrega = taxaEntregaValida ? Number(taxaEntregaAtual.valor || 0) : null;
    const total = subtotalProdutos + (taxaEntrega ?? 0);

    setBotaoFinalizarPedido("📦 Gerando número...", true);

    const pedido = await gerarPedidoSite({
      origem: "site",
      loja: lojaConfig.nomeLoja || "Delícias da Vó",
      cliente: {
        nome,
        telefone,
        uid: window.usuarioAtual?.uid || ""
      },
      usuarioId: window.usuarioAtual?.uid || "",
      tipo,
      endereco: tipo === "Entrega" ? endereco : "",
      enderecoDetalhado: tipo === "Entrega" ? {
        rua,
        numero: numeroEndereco,
        bairro,
        complemento
      } : null,
      pagamento,
      itens,
      subtotalProdutos,
      taxaEntrega,
      distanciaEntregaKm: tipo === "Entrega" && taxaEntregaAtual?.estado === "calculada"
        ? Number(taxaEntregaAtual.distanciaKm)
        : null,
      total
    });

    const pedidoExibicao = {
      ...pedido,
      subtotalProdutos,
      taxaEntrega,
      distanciaEntregaKm: tipo === "Entrega" && taxaEntregaAtual?.estado === "calculada"
        ? Number(taxaEntregaAtual.distanciaKm)
        : null
    };
    const mensagem = montarMensagemPedidoWhatsApp(pedidoExibicao);
    const numero = lojaConfig.whatsapp || APP_CONFIG.whatsapp;

    abrirRevisaoPedido({
      numero: pedido.numeroFormatado,
      itens: pedido.itens || itens,
      tipo: pedido.tipo || tipo,
      endereco: pedido.endereco || endereco,
      pagamento: pedido.pagamento || pagamento,
      total: pedido.total || total,
      taxaEntregaTexto: taxaEntregaValida
        ? `${formatarMoeda(taxaEntrega)} • ${Number(taxaEntregaAtual.distanciaKm).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`
        : taxaEntregaAtual?.foraArea
          ? `A combinar • endereço a ${Number(taxaEntregaAtual.distanciaKm).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`
          : "A confirmar pelo WhatsApp",
      totalIncluiTaxa: tipo !== "Entrega" || taxaEntregaValida,
      urlWhatsApp: `https://wa.me/${numero}?text=${textoWhatsApp(mensagem)}`
    });

    setBotaoFinalizarPedido("Enviar pelo WhatsApp", false);

  } catch (erro) {
    console.error("Erro ao finalizar pedido:", erro);
    alert("Não foi possível gerar o número do pedido. Tente novamente.");
    setBotaoFinalizarPedido("Enviar pelo WhatsApp", false);
  }
};

window.alterarItem = alterarItemImpl;
window.finalizarPedido = finalizarPedidoImpl;


let encomendaFesta = carregarLocal("deliciasFestaPedido", []);
function abrirAreaFestas(){ document.getElementById("areaPrincipal").hidden=true; document.getElementById("areaFestas").hidden=false; document.getElementById("btnFestasTopo").textContent="🏠 Cardápio principal"; document.getElementById("btnFestasTopo").onclick=voltarCardapioPrincipal; window.scrollTo({top:0,behavior:"smooth"}); renderSalgadosFesta(); }
function voltarCardapioPrincipal(){ document.getElementById("areaFestas").hidden=true; document.getElementById("areaPrincipal").hidden=false; const b=document.getElementById("btnFestasTopo"); b.textContent="🎉 Salgados para Festas"; b.onclick=abrirAreaFestas; window.scrollTo({top:0,behavior:"smooth"}); }
function opcoesQuantidadeFesta(produto) {
  const inicial = Math.max(50, Number(produto.quantidadeInicial || 50));
  const incremento = Math.max(50, Number(produto.incrementoQuantidade || 50));
  const maxima = Math.max(inicial, Number(produto.quantidadeMaxima || 500));
  const valores = [];
  for (let quantidade = inicial; quantidade <= maxima; quantidade += incremento) valores.push(quantidade);
  return valores.length ? valores : [50, 100, 150, 200];
}

function renderSalgadosFesta(erro = null) {
  const fritos = document.getElementById("festaFritos");
  const assados = document.getElementById("festaAssados");
  if (!fritos || !assados) return;

  fritos.innerHTML = "";
  assados.innerHTML = "";

  salgadosFesta.filter(p => p.ativo !== false).forEach(p => {
    const card = document.createElement("article");
    card.className = `festa-produto-card ${p.categoria}`;
    const sabores = Array.isArray(p.sabores) && p.sabores.length ? p.sabores : ["Tradicional"];
    const opcoesSabores = sabores.map(x => `<option value="${x.replace(/"/g, '&quot;')}">${x}</option>`).join("");
    const quantidades = opcoesQuantidadeFesta(p);
    const opcoesQuantidades = quantidades.map((q, i) => `<option value="${q}" ${i === 0 ? "selected" : ""}>${q} unidades</option>`).join("");

    card.innerHTML = `
      <div class="festa-card-decor" aria-hidden="true">✦</div>
      <div class="festa-card-top">
        <span class="festa-emoji">${p.emoji || "🥟"}</span>
        <span class="festa-tipo">${p.categoria === "assados" ? "🔥 Assado" : "🍳 Frito"}</span>
      </div>
      <h3>${p.nome}</h3>
      <p class="festa-card-descricao">${p.descricao || "Feito com carinho para sua festa."}</p>
      <div class="festa-configurador">
        <div class="festa-configurador-title"><span>✨</span><div><b>Monte sua encomenda</b><small>Escolha o sabor e a quantidade</small></div></div>
        <div class="festa-campo-sabor">
          <span class="festa-campo-label">Sabor</span>
          <div class="festa-opcoes-sabor" role="radiogroup" aria-label="Escolha o sabor">
            ${sabores.map((x, i) => `<button type="button" class="festa-sabor-opcao ${i === 0 ? "selecionado" : ""}" data-sabor="${x.replace(/"/g, '&quot;')}" role="radio" aria-checked="${i === 0 ? "true" : "false"}"><span class="festa-sabor-check">✓</span><span>${x}</span></button>`).join("")}
          </div>
        </div>
        <label><span>Quantidade</span><select class="festa-select-quantidade">${opcoesQuantidades}</select></label>
        <small class="festa-regra-quantidade">Acréscimos de ${Number(p.incrementoQuantidade || 50)} em ${Number(p.incrementoQuantidade || 50)} unidades.</small>
        <div class="festa-preco"><span>Valor</span><strong>${textoPrecoFesta(p)}</strong>${normalizarPrecoFesta(p).tipoPreco === "unitario" ? `<small>Venda mínima: 50 unidades</small>` : ""}</div>
      </div>
      <button class="btn primary festa-add-btn">＋ Adicionar à encomenda</button>`;

    card.querySelectorAll(".festa-sabor-opcao").forEach(botao => {
      botao.addEventListener("click", () => {
        card.querySelectorAll(".festa-sabor-opcao").forEach(opcao => {
          opcao.classList.remove("selecionado");
          opcao.setAttribute("aria-checked", "false");
        });
        botao.classList.add("selecionado");
        botao.setAttribute("aria-checked", "true");
      });
    });

    card.querySelector(".festa-add-btn").onclick = () => {
      const selecionado = card.querySelector(".festa-sabor-opcao.selecionado");
      const sabor = selecionado ? selecionado.dataset.sabor : sabores[0];
      const quantidade = Number(card.querySelector(".festa-select-quantidade").value);
      adicionarFesta(p, sabor, quantidade);
    };
    (p.categoria === "assados" ? assados : fritos).appendChild(card);
  });

  const st = document.getElementById("statusFestas");
  if (st) {
    st.textContent = erro ? "O catálogo padrão está disponível. Os produtos novos voltarão quando a conexão for restabelecida." : "";
    st.style.display = erro ? "block" : "none";
  }
  renderResumoFesta();
}
function adicionarFesta(p, sabor, qtd) {
  const id = p.id + "__" + sabor;
  const item = encomendaFesta.find(i => i.id === id);
  const incremento = Math.max(50, Number(p.incrementoQuantidade || 50));
  if (item) { item.quantidade += qtd; Object.assign(item, normalizarPrecoFesta(p)); item.emoji = p.emoji || item.emoji || "🥟"; }
  else encomendaFesta.push({ id, produtoId:p.id, nome:p.nome, emoji:p.emoji || "🥟", sabor, quantidade:qtd, incremento, ...normalizarPrecoFesta(p) });
  salvarLocal("deliciasFestaPedido", encomendaFesta);
  renderResumoFesta();
}
function alterarFesta(i, delta) {
  const item = encomendaFesta[i];
  if (!item) return;
  const incremento = Math.max(50, Number(item.incremento || 50));
  item.quantidade += delta > 0 ? incremento : -incremento;
  if (item.quantidade <= 0) encomendaFesta.splice(i, 1);
  salvarLocal("deliciasFestaPedido", encomendaFesta);
  renderResumoFesta();
}
function renderResumoFesta() {
  const box = document.getElementById("resumoFestaPedido");
  if (!box) return;
  if (!encomendaFesta.length) {
    box.innerHTML = '<div class="festa-vazio"><span>🎈</span><div><b>Sua encomenda está vazia</b><p>Escolha um salgado, um sabor e a quantidade para começar.</p></div></div>';
    return;
  }
  const total = encomendaFesta.reduce((s, i) => s + Number(i.quantidade || 0), 0);
  const totalEstimado = encomendaFesta.reduce((soma, item) => {
    const produtoAtual = salgadosFesta.find(p => p.id === item.produtoId) || item;
    return soma + calcularPrecoFesta(produtoAtual, item.quantidade);
  }, 0);
  box.innerHTML = `<div class="festa-resumo-cabecalho"><div><span>🧺</span><div><b>Sua encomenda</b><small>${encomendaFesta.length} opção(ões) escolhida(s)</small></div></div><strong>${total} unidades</strong></div>` + encomendaFesta.map((i, n) => {
    const produtoAtual = salgadosFesta.find(p => p.id === i.produtoId) || i;
    const subtotal = calcularPrecoFesta(produtoAtual, i.quantidade);
    return `
    <div class="festa-resumo-item">
      <div class="festa-resumo-identidade"><span class="festa-resumo-icone">${i.emoji || (salgadosFesta.find(p => p.id === i.produtoId)?.emoji) || "🥟"}</span><div><b>${i.nome}</b><span>${i.sabor}${subtotal > 0 ? ` • ${formatarMoeda(subtotal)}` : " • sob consulta"}</span></div></div>
      <div class="festa-resumo-controles"><button aria-label="Diminuir" onclick="alterarFesta(${n},-1)">−</button><strong>${i.quantidade}</strong><button aria-label="Aumentar" onclick="alterarFesta(${n},1)">+</button></div>
    </div>`}).join("") + `<div class="festa-total-estimado"><span>Total estimado</span><strong>${totalEstimado > 0 ? formatarMoeda(totalEstimado) : "Sob consulta"}</strong><small>Valor sujeito à confirmação da loja.</small></div>`;
}
let ultimoComprovanteFesta = null;


function atualizarEnderecoFesta() {
  const tipo = document.getElementById("tipoEntregaFesta")?.value || "Retirada na loja";
  const campo = document.getElementById("campoEnderecoFesta");
  if (campo) campo.hidden = tipo !== "Entrega";
}
window.atualizarEnderecoFesta = atualizarEnderecoFesta;

async function enviarEncomendaFesta(){
  if(!encomendaFesta.length) return alert("Adicione pelo menos um salgado.");
  const nome=limparTexto(document.getElementById("nomeFestaCliente").value);
  const telefone=limparTexto(document.getElementById("telefoneFestaCliente").value);
  if(!nome) return alert("Digite seu nome.");
  if(!telefone) return alert("Digite seu WhatsApp.");
  const data=document.getElementById("dataFesta").value;
  const tipoEntrega=document.getElementById("tipoEntregaFesta")?.value || "Retirada na loja";
  const ruaFesta=limparTexto(document.getElementById("ruaFesta")?.value || "");
  const numeroFesta=limparTexto(document.getElementById("numeroFesta")?.value || "");
  const bairroFesta=limparTexto(document.getElementById("bairroFesta")?.value || "");
  const complementoFesta=limparTexto(document.getElementById("complementoFesta")?.value || "");
  const endereco=montarEndereco({ rua:ruaFesta, numero:numeroFesta, bairro:bairroFesta, complemento:complementoFesta });
  const obs=limparTexto(document.getElementById("obsFesta").value);
  if(tipoEntrega==="Entrega" && (!ruaFesta || !numeroFesta || !bairroFesta)) {
    return alert("Preencha a rua, o número e o bairro para entrega.");
  }
  const totalUnidades=encomendaFesta.reduce((s,i)=>s+Number(i.quantidade||0),0);
  const totalEstimado=encomendaFesta.reduce((soma,item)=>{
    const produtoAtual=salgadosFesta.find(p=>p.id===item.produtoId)||item;
    return soma+calcularPrecoFesta(produtoAtual,item.quantidade);
  },0);
  const itensPedido=encomendaFesta.map(i=>({
    produtoId:i.produtoId, nome:i.nome, emoji:i.emoji||"🥟", sabor:i.sabor,
    quantidade:Number(i.quantidade||0), ...normalizarPrecoFesta(salgadosFesta.find(p=>p.id===i.produtoId)||i),
    subtotal:calcularPrecoFesta(salgadosFesta.find(p=>p.id===i.produtoId)||i, Number(i.quantidade||0))
  }));

  const botao=document.querySelector('.festa-pedido-box .btn-whatsapp');
  if(botao){botao.disabled=true;botao.textContent="⏳ Registrando encomenda...";}
  try{
    await salvarDadosCliente("festa");

    const pedido=await registrarEncomendaFesta({
      cliente:{nome,telefone,uid:window.usuarioAtual?.uid||""},
      usuarioId:window.usuarioAtual?.uid||"",
      dataFesta:data||"",
      tipoEntrega,
      endereco: tipoEntrega==="Entrega" ? endereco : "",
      enderecoDetalhado: tipoEntrega==="Entrega" ? {
        rua:ruaFesta,
        numero:numeroFesta,
        bairro:bairroFesta,
        complemento:complementoFesta
      } : null,
      observacoes:obs,
      itens:itensPedido,
      totalUnidades,
      totalEstimado
    });
    const linhas=itensPedido.map(i=>`• ${i.quantidade}x ${i.nome} — ${i.sabor} (${formatarMoeda(i.subtotal)})`).join("\n");
    const msg=`Olá! Vim pelo site da Delícias da Vó e gostaria de encomendar salgados para festa.\n\nPedido: ${pedido.numero}\nCliente: ${nome}\nWhatsApp: ${telefone}\n${data?`Data da festa: ${data}\n`:""}\n${linhas}\n\nTotal: ${formatarMoeda(totalEstimado)}${obs?`\n\nObservações: ${obs}`:""}\n\nAguardo a confirmação do pedido e do valor.`;
    ultimoComprovanteFesta={pedido,msg};
    mostrarComprovanteFesta(pedido);
  }catch(erro){
    console.error("Erro ao registrar encomenda:",erro);
    alert("Não foi possível registrar a encomenda. Confira a conexão e as permissões do Firestore.");
  }finally{
    if(botao){botao.disabled=false;botao.textContent="💬 Enviar encomenda pelo WhatsApp";}
  }
}
function mostrarComprovanteFesta(pedido){
  const modal=document.getElementById("modalComprovanteFesta");
  const box=document.getElementById("conteudoComprovanteFesta");
  const itens=(pedido.itens||[]).map(i=>`<div><span>${i.emoji||"🥟"} ${i.nome} — ${i.sabor}</span><strong>${i.quantidade}</strong></div>`).join("");
  box.innerHTML=`<div class="comprovante-numero"><span>Número do pedido</span><strong>${pedido.numero}</strong></div>
  <div class="comprovante-linha"><span>Cliente</span><strong>${pedido.cliente?.nome||""}</strong></div>
  <div class="comprovante-linha"><span>WhatsApp</span><strong>${pedido.cliente?.telefone||"Não informado"}</strong></div>
  <div class="comprovante-linha"><span>Data da festa</span><strong>${pedido.dataFesta||"A combinar"}</strong></div>
  <div class="comprovante-linha"><span>Recebimento</span><strong>${pedido.tipoEntrega||"Retirada na loja"}</strong></div>
  ${pedido.tipoEntrega==="Entrega" ? `<div class="comprovante-linha"><span>Endereço</span><strong>${pedido.endereco||"Não informado"}</strong></div>` : ""}
  <div class="comprovante-itens">${itens}</div>
  <div class="comprovante-total"><span>Total estimado</span><strong>${formatarMoeda(pedido.totalEstimado||0)}</strong></div>
  <small>O pedido ainda depende da confirmação da Delícias da Vó.</small>`;
  modal?.classList.add("aberto");
}
function fecharComprovanteFesta(){document.getElementById("modalComprovanteFesta")?.classList.remove("aberto");}
async function copiarComprovanteFesta(){
  if(!ultimoComprovanteFesta) return;
  try{await navigator.clipboard.writeText(ultimoComprovanteFesta.msg); alert("Resumo copiado!");}
  catch{alert("Não foi possível copiar automaticamente.");}
}
function abrirWhatsAppComprovante(){
  if(!ultimoComprovanteFesta) return;
  window.open(`https://wa.me/${lojaConfig.whatsapp||APP_CONFIG.whatsapp}?text=${encodeURIComponent(ultimoComprovanteFesta.msg)}`,"_blank");
}
window.fecharComprovanteFesta=fecharComprovanteFesta;
window.copiarComprovanteFesta=copiarComprovanteFesta;
window.abrirWhatsAppComprovante=abrirWhatsAppComprovante;
window.abrirAreaFestas=abrirAreaFestas; window.voltarCardapioPrincipal=voltarCardapioPrincipal; window.alterarFesta=alterarFesta; window.enviarEncomendaFesta=enviarEncomendaFesta;
