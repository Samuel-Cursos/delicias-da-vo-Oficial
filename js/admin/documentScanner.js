import { salvarMovimentoFinanceiro } from "../services/financeService.js";
import { registrarVendaRapida } from "../services/salesService.js";
import { lerRegistroComIA } from "../services/documentAiService.js";

const $ = id => document.getElementById(id);

let arquivoAtual = null;
let bufferOriginal = null;
let imagemOriginal = null;
let urlOriginal = "";
let blobTratado = null;
let urlTratado = "";
let pontos = [];
let indiceArrastando = null;
let scannerWorker = null;
let workerSequencia = 0;
let ocrWorker = null;
let resultadoIaAtual = null;
let controllerLeituraIa = null;
let leituraIaSequencia = 0;
const chamadasWorker = new Map();

function normalizar(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function numeroBR(texto) {
  let limpo = String(texto || "")
    .replace(/[Oo](?=\d)/g, "0")
    .replace(/(\d)[Oo]/g, (_, digito) => `${digito}0`)
    .replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  if (limpo.includes(",")) limpo = limpo.replace(/\./g, "").replace(",", ".");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : 0;
}

function valoresDaLinha(linha) {
  const padrao = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/g;
  return [...String(linha).matchAll(padrao)]
    .map(match => numeroBR(match[1]))
    .filter(valor => Number.isFinite(valor) && valor > 0 && valor < 1000000);
}

function detectarPagamentosDetalhados(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map(linha => linha.trim()).filter(Boolean);
  const mapa = {
    Pix: /\bPIX\b|PAGAMENTO INSTANTANEO/,
    Dinheiro: /DINHEIRO|ESPECIE/,
    "Cartão débito": /CARTAO.{0,18}DEBITO|\bDEBITO\b|CARTAO DEB|POS DEBITO/,
    "Cartão crédito": /CARTAO.{0,18}CREDITO|\bCREDITO\b|CARTAO CRED|POS CREDITO/
  };
  const achados = {};
  linhas.forEach((linha, indice) => {
    const linhaNormal = normalizar(linha);
    Object.entries(mapa).forEach(([tipo, regex]) => {
      if (!regex.test(linhaNormal)) return;
      let valores = valoresDaLinha(linha);
      if (!valores.length && linhas[indice + 1]) valores = valoresDaLinha(linhas[indice + 1]);
      if (valores.length) achados[tipo] = Math.max(...valores);
    });
  });
  return Object.entries(achados).map(([tipo, valor]) => ({ tipo, valor }));
}

function detectarPagamento(texto) {
  const textoNormal = normalizar(texto);
  const formas = [];
  if (/\bPIX\b|PAGAMENTO INSTANTANEO/.test(textoNormal)) formas.push("Pix");
  if (/DINHEIRO|ESPECIE/.test(textoNormal)) formas.push("Dinheiro");
  if (/CARTAO.{0,18}DEBITO|\bDEBITO\b|CARTAO DEB|POS DEBITO/.test(textoNormal)) formas.push("Cartão débito");
  if (/CARTAO.{0,18}CREDITO|\bCREDITO\b|CARTAO CRED|POS CREDITO/.test(textoNormal)) formas.push("Cartão crédito");
  const unicas = [...new Set(formas)];
  return unicas.length > 1 ? "Pagamento misto" : (unicas[0] || "Não informado");
}

function detectarValorTotal(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map(linha => linha.trim()).filter(Boolean);
  const candidatos = [];
  const prioridadeAlta = /VALOR\s+TOTAL|TOTAL\s+A\s+PAGAR|TOTAL\s+DA\s+COMPRA|TOTAL\s+GERAL|TOTAL\s+LIQUIDO|TOTAL\s+R?\$?/i;
  const prioridadeMedia = /\bTOTAL\b|VALOR\s+PAGO|VALOR\s+COBRADO/i;
  const ignorar = /SUBTOTAL|TROCO|DESCONTO|VALOR RECEBIDO|DINHEIRO RECEBIDO|TOTAL DE ITENS|QTD\.? TOTAL|CNPJ|CPF|TELEFONE|FONE|CHAVE DE ACESSO/i;
  linhas.forEach((linha, indice) => {
    valoresDaLinha(linha).forEach(valor => {
      let pontuacao = (indice / Math.max(linhas.length, 1)) * 18;
      if (prioridadeAlta.test(linha)) pontuacao += 140;
      else if (prioridadeMedia.test(linha)) pontuacao += 85;
      if (/PIX|DINHEIRO|DEBITO|CREDITO/i.test(normalizar(linha))) pontuacao += 24;
      if (ignorar.test(linha)) pontuacao -= 170;
      candidatos.push({ valor, pontuacao, indice });
    });
  });
  candidatos.sort((a, b) => (b.pontuacao - a.pontuacao) || (b.indice - a.indice) || (b.valor - a.valor));
  return candidatos[0]?.valor || 0;
}

function hojeLocalISO() {
  const data = new Date();
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function modoAtual() {
  return document.querySelector('input[name="scannerTipo"]:checked')?.value || "nota";
}

function setStatus(mensagem, tipo = "") {
  const elemento = $("scannerSalvarStatus");
  if (!elemento) return;
  elemento.textContent = mensagem;
  elemento.dataset.tipo = tipo;
}

function setProgresso(mensagem = "", percentual = 0) {
  if ($("scannerProgresso")) $("scannerProgresso").textContent = mensagem;
  if ($("scannerProgressoBarra")) $("scannerProgressoBarra").style.width = `${Math.max(0, Math.min(100, percentual))}%`;
}

function atualizarEtapa(etapa) {
  document.querySelectorAll(".scanner-steps span").forEach((item, indice) => {
    const numero = indice + 1;
    item.classList.toggle("active", numero === etapa);
    item.classList.toggle("done", numero < etapa);
  });
}

function atualizarRotulos() {
  const venda = modoAtual() === "caixa";
  $("scannerTituloRevisao").textContent = venda ? "Revisar venda" : "Revisar compra";
  $("scannerTextoRevisao").textContent = venda
    ? "Confira o valor recebido e a forma de pagamento antes de salvar no caixa."
    : "Confira o valor pago e a forma de pagamento antes de salvar no financeiro.";
  if ($("scannerValorLabel")?.firstChild) $("scannerValorLabel").firstChild.textContent = venda ? "Valor da venda (R$)" : "Valor da compra (R$)";
  $("scannerConfirmar").textContent = venda ? "Confirmar venda" : "Confirmar compra";

  if ($("scannerDica")) {
    $("scannerDica").textContent = venda
      ? "Dica: fotografe de perto, com boa luz, deixando o valor e o pagamento bem visíveis."
      : "Dica: deixe o papel inteiro visível e evite sombras fortes.";
  }
  if ($("scannerAiNota")) $("scannerAiNota").hidden = !venda;
  if ($("scannerLerRapido")) {
    $("scannerLerRapido").hidden = !venda;
    $("scannerLerRapido").disabled = !venda || !arquivoAtual || Boolean(controllerLeituraIa);
  }
  if ($("scannerLer")) {
    $("scannerLer").textContent = venda ? "🔎 Usar leitura local" : "🔎 Ler nota localmente";
    if (!arquivoAtual) $("scannerLer").disabled = true;
  }
  if ($("scannerVoltarRecorte")) {
    $("scannerVoltarRecorte").textContent = venda ? "✂️ Ajustar para leitura local" : "← Ajustar recorte";
  }
}

function camposMistos() {
  return [
    ["Pix", $("scannerMistoPix")],
    ["Dinheiro", $("scannerMistoDinheiro")],
    ["Cartão débito", $("scannerMistoDebito")],
    ["Cartão crédito", $("scannerMistoCredito")]
  ];
}

function pagamentosMistosInformados() {
  return camposMistos().map(([tipo, elemento]) => ({ tipo, valor: Number(elemento?.value || 0) }))
    .filter(item => Number.isFinite(item.valor) && item.valor > 0);
}

function atualizarMisto() {
  const misto = $("scannerPagamento")?.value === "Pagamento misto";
  $("scannerPagamentosMistos").hidden = !misto;
  if (!misto) return;
  const total = Number($("scannerValor")?.value || 0);
  const soma = pagamentosMistosInformados().reduce((acc, item) => acc + item.valor, 0);
  const ok = total > 0 && Math.abs(total - soma) < 0.01;
  const resumo = $("scannerMistoResumo");
  resumo.textContent = `Soma: R$ ${soma.toFixed(2).replace(".", ",")} — Total: R$ ${total.toFixed(2).replace(".", ",")}${ok ? " ✓" : ""}`;
  resumo.dataset.ok = String(ok);
}

function preencherMistos(lista = []) {
  camposMistos().forEach(([, elemento]) => { if (elemento) elemento.value = ""; });
  lista.forEach(item => {
    const alvo = camposMistos().find(([tipo]) => tipo === item.tipo)?.[1];
    if (alvo) alvo.value = Number(item.valor || 0).toFixed(2);
  });
  atualizarMisto();
}

function liberarRevisao(valor, pagamento, pagamentos, confianca = 0) {
  $("scannerValor").value = valor > 0 ? valor.toFixed(2) : "";
  $("scannerPagamento").value = pagamento;
  preencherMistos(pagamento === "Pagamento misto" ? pagamentos : []);
  const confiancaEl = $("scannerConfianca");
  const encontrou = valor > 0;
  confiancaEl.textContent = encontrou ? (confianca >= 70 ? "Leitura boa" : "Valor encontrado") : "Confira manualmente";
  confiancaEl.dataset.tipo = encontrou ? (confianca >= 70 ? "boa" : "revisar") : "alerta";
  $("scannerConfirmar").disabled = false;
  atualizarEtapa(3);
}

function revogarUrl(nome) {
  if (nome === "original" && urlOriginal) { URL.revokeObjectURL(urlOriginal); urlOriginal = ""; }
  if (nome === "tratado" && urlTratado) { URL.revokeObjectURL(urlTratado); urlTratado = ""; }
}

function pontosPadrao() {
  const largura = imagemOriginal?.naturalWidth || 1;
  const altura = imagemOriginal?.naturalHeight || 1;
  const margem = Math.max(10, Math.min(largura, altura) * 0.04);
  return [{ x: margem, y: margem }, { x: largura - margem, y: margem }, { x: largura - margem, y: altura - margem }, { x: margem, y: altura - margem }];
}

function escalaCanvas() {
  const canvas = $("scannerCanvas");
  return { x: canvas && imagemOriginal ? canvas.width / imagemOriginal.naturalWidth : 1, y: canvas && imagemOriginal ? canvas.height / imagemOriginal.naturalHeight : 1 };
}

function desenharImagemOriginal() {
  const canvas = $("scannerCanvas");
  if (!canvas || !imagemOriginal) return;
  const escala = Math.min(1, 1200 / Math.max(imagemOriginal.naturalWidth, imagemOriginal.naturalHeight));
  canvas.width = Math.max(1, Math.round(imagemOriginal.naturalWidth * escala));
  canvas.height = Math.max(1, Math.round(imagemOriginal.naturalHeight * escala));
  const contexto = canvas.getContext("2d", { alpha: false });
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(imagemOriginal, 0, 0, canvas.width, canvas.height);
  atualizarRecorteVisual();
}

function atualizarRecorteVisual() {
  const canvas = $("scannerCanvas");
  const overlay = $("scannerOverlay");
  const polygon = $("scannerPolygon");
  if (!canvas || !overlay || !polygon || pontos.length !== 4) return;
  const escala = escalaCanvas();
  const pontosCanvas = pontos.map(ponto => ({ x: ponto.x * escala.x, y: ponto.y * escala.y }));
  overlay.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  polygon.setAttribute("points", pontosCanvas.map(ponto => `${ponto.x},${ponto.y}`).join(" "));
  document.querySelectorAll(".scanner-handle").forEach((handle, indice) => {
    const ponto = pontosCanvas[indice];
    handle.style.left = `${(ponto.x / canvas.width) * 100}%`;
    handle.style.top = `${(ponto.y / canvas.height) * 100}%`;
  });
}

function iniciarArraste(evento) {
  indiceArrastando = Number(evento.currentTarget.dataset.point);
  evento.currentTarget.setPointerCapture?.(evento.pointerId);
  evento.preventDefault();
}

function moverPonto(evento) {
  if (indiceArrastando === null || !imagemOriginal) return;
  const canvas = $("scannerCanvas");
  const rect = canvas.getBoundingClientRect();
  const xCanvas = Math.max(0, Math.min(rect.width, evento.clientX - rect.left));
  const yCanvas = Math.max(0, Math.min(rect.height, evento.clientY - rect.top));
  pontos[indiceArrastando] = { x: (xCanvas / rect.width) * imagemOriginal.naturalWidth, y: (yCanvas / rect.height) * imagemOriginal.naturalHeight };
  atualizarRecorteVisual();
}

function finalizarArraste() { indiceArrastando = null; }

function obterScannerWorker() {
  if (scannerWorker) return scannerWorker;
  scannerWorker = new Worker(new URL("./documentScanner.worker.js", import.meta.url));
  scannerWorker.onmessage = evento => {
    const { id, ok, result, error } = evento.data || {};
    const chamada = chamadasWorker.get(id);
    if (!chamada) return;
    chamadasWorker.delete(id);
    if (ok) chamada.resolve(result);
    else chamada.reject(new Error(error || "Falha ao processar a imagem."));
  };
  scannerWorker.onerror = erro => {
    chamadasWorker.forEach(chamada => chamada.reject(new Error(erro.message || "Falha no scanner.")));
    chamadasWorker.clear();
  };
  return scannerWorker;
}

function chamarWorker(action, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++workerSequencia;
    chamadasWorker.set(id, { resolve, reject });
    obterScannerWorker().postMessage({ id, action, payload }, transfer);
  });
}

async function detectarAutomaticamente(mostrarFalha = true) {
  if (!arquivoAtual || !bufferOriginal) return false;
  $("scannerAutoDetectar").disabled = true;
  setProgresso("Procurando as bordas do papel…", 18);
  atualizarEtapa(2);
  try {
    const copia = bufferOriginal.slice(0);
    const encontrados = await chamarWorker("detect", { buffer: copia, type: arquivoAtual.type }, [copia]);
    if (Array.isArray(encontrados) && encontrados.length === 4) pontos = encontrados;
    atualizarRecorteVisual();
    setProgresso("Papel encontrado. Ajustando imagem…", 34);
    return true;
  } catch (erro) {
    console.warn("Detecção automática indisponível:", erro);
    pontos = pontos.length === 4 ? pontos : pontosPadrao();
    atualizarRecorteVisual();
    if (mostrarFalha) setProgresso("Não detectei as bordas com precisão. Ajuste os círculos se necessário.", 25);
    return false;
  } finally {
    $("scannerAutoDetectar").disabled = false;
  }
}

function processarFallback() {
  return new Promise((resolve, reject) => {
    try {
      const xs = pontos.map(ponto => ponto.x);
      const ys = pontos.map(ponto => ponto.y);
      const esquerda = Math.max(0, Math.min(...xs));
      const topo = Math.max(0, Math.min(...ys));
      const larguraFonte = Math.max(1, Math.min(imagemOriginal.naturalWidth - esquerda, Math.max(...xs) - esquerda));
      const alturaFonte = Math.max(1, Math.min(imagemOriginal.naturalHeight - topo, Math.max(...ys) - topo));
      const escala = Math.min(1.4, 1800 / Math.max(larguraFonte, alturaFonte));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(320, Math.round(larguraFonte * escala));
      canvas.height = Math.max(420, Math.round(alturaFonte * escala));
      const contexto = canvas.getContext("2d", { alpha: false });
      contexto.fillStyle = "#ffffff";
      contexto.fillRect(0, 0, canvas.width, canvas.height);
      contexto.filter = "grayscale(1) contrast(1.55) brightness(1.08)";
      contexto.drawImage(imagemOriginal, esquerda, topo, larguraFonte, alturaFonte, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a imagem.")), "image/jpeg", 0.92);
    } catch (erro) { reject(erro); }
  });
}

async function melhorarImagem({ lerDepois = true } = {}) {
  if (!arquivoAtual || !bufferOriginal || pontos.length !== 4) return;
  $("scannerMelhorar").disabled = true;
  $("scannerLer").disabled = true;
  if ($("scannerLerRapido")) $("scannerLerRapido").disabled = true;
  setStatus("");
  setProgresso("Removendo o fundo e destacando o texto…", 42);
  try {
    try {
      const copia = bufferOriginal.slice(0);
      const resultado = await chamarWorker("process", { buffer: copia, type: arquivoAtual.type, points: pontos }, [copia]);
      blobTratado = new Blob([resultado.buffer], { type: resultado.type || "image/jpeg" });
    } catch (erroWorker) {
      console.warn("Usando melhoria compatível:", erroWorker);
      blobTratado = await processarFallback();
    }
    revogarUrl("tratado");
    urlTratado = URL.createObjectURL(blobTratado);
    $("scannerPreview").src = urlTratado;
    $("scannerResultadoTitulo").textContent = "Imagem pronta para leitura local";
    $("scannerResultadoBadge").textContent = "✓ melhorada";
    $("scannerResultado").hidden = false;
    $("scannerEditor").hidden = true;
    $("scannerLer").disabled = false;
    setProgresso("Imagem melhorada. Iniciando leitura…", 50);
    if (lerDepois) await processarOCR();
  } catch (erro) {
    console.error(erro);
    setProgresso("Não foi possível melhorar a foto. Você ainda pode ler a imagem original.", 0);
    $("scannerLer").disabled = false;
  } finally {
    $("scannerMelhorar").disabled = false;
    if ($("scannerLerRapido")) $("scannerLerRapido").disabled = modoAtual() !== "caixa" || !arquivoAtual;
  }
}

async function obterOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Não foi possível carregar o leitor de texto."));
      document.head.appendChild(script);
    });
  }
  ocrWorker = await window.Tesseract.createWorker("por", 1, {
    logger: evento => {
      if (evento.status === "recognizing text") {
        const percentual = Math.round((evento.progress || 0) * 100);
        setProgresso(`Lendo valor e pagamento… ${percentual}%`, 52 + percentual * 0.45);
      } else if (/loading|initializing/i.test(evento.status || "")) setProgresso("Preparando o leitor na primeira utilização…", 52);
    }
  });
  return ocrWorker;
}

async function processarOCR() {
  if (!arquivoAtual) return;
  $("scannerLer").disabled = true;
  if ($("scannerLerRapido")) $("scannerLerRapido").disabled = true;
  $("scannerConfirmar").disabled = true;
  setStatus("");
  setProgresso("Preparando a leitura…", 52);
  try {
    const leitor = await obterOcrWorker();
    const { data } = await leitor.recognize(blobTratado || arquivoAtual);
    const texto = data?.text || "";
    const valor = detectarValorTotal(texto);
    const pagamento = detectarPagamento(texto);
    const pagamentos = detectarPagamentosDetalhados(texto);
    $("scannerTextoBruto").value = texto;
    liberarRevisao(valor, pagamento, pagamentos, Number(data?.confidence || 0));
    setProgresso(valor > 0 ? "Leitura concluída. Confira os dados e confirme." : "Não encontrei o total com segurança. Digite o valor e confirme.", 100);
  } catch (erro) {
    console.error(erro);
    liberarRevisao(0, "Não informado", [], 0);
    setProgresso("A leitura automática falhou. Digite o valor manualmente para continuar.", 0);
  } finally {
    $("scannerLer").disabled = false;
    if ($("scannerLerRapido")) $("scannerLerRapido").disabled = modoAtual() !== "caixa" || !arquivoAtual;
  }
}

function exibirFotoParaLeituraRapida() {
  if (!arquivoAtual || !urlOriginal) return;
  $("scannerPreview").src = urlOriginal;
  $("scannerResultadoTitulo").textContent = "Foto pronta para leitura rápida";
  $("scannerResultadoBadge").textContent = "⚡ IA";
  $("scannerResultado").hidden = false;
  $("scannerEditor").hidden = true;
}

function gerarDataUrlParaIA(limite = 1800, qualidade = 0.84) {
  const escala = Math.min(1, limite / Math.max(imagemOriginal.naturalWidth, imagemOriginal.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imagemOriginal.naturalWidth * escala));
  canvas.height = Math.max(1, Math.round(imagemOriginal.naturalHeight * escala));
  const contexto = canvas.getContext("2d", { alpha: false });
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.filter = "contrast(1.08) brightness(1.03)";
  contexto.drawImage(imagemOriginal, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", qualidade);
}

function prepararImagemParaIA() {
  if (!imagemOriginal) throw new Error("A foto ainda não terminou de carregar.");
  let dataUrl = gerarDataUrlParaIA(1800, 0.84);
  if (dataUrl.length > 3_800_000) dataUrl = gerarDataUrlParaIA(1400, 0.76);
  if (dataUrl.length > 3_800_000) dataUrl = gerarDataUrlParaIA(1100, 0.7);
  return dataUrl;
}

function aplicarResultadoIa(resultado) {
  const linhas = [resultado?.textoReconhecido, resultado?.observacao]
    .map(item => String(item || "").trim())
    .filter(Boolean);
  $("scannerTextoBruto").value = linhas.join("\n");
  liberarRevisao(
    Number(resultado?.valor || 0),
    resultado?.pagamento || "Não informado",
    Array.isArray(resultado?.pagamentos) ? resultado.pagamentos : [],
    Number(resultado?.confianca || 0)
  );
}

async function processarLeituraRapidaIA({ forcar = false } = {}) {
  if (!arquivoAtual || modoAtual() !== "caixa") return;
  exibirFotoParaLeituraRapida();

  if (resultadoIaAtual && !forcar) {
    aplicarResultadoIa(resultadoIaAtual);
    setProgresso(resultadoIaAtual.valor > 0
      ? "Leitura concluída. Confira o valor e confirme a venda."
      : "Não consegui ler o valor com segurança. Digite-o manualmente ou use a leitura local.", 100);
    return;
  }

  controllerLeituraIa?.abort();
  const controller = new AbortController();
  const sequencia = ++leituraIaSequencia;
  controllerLeituraIa = controller;
  $("scannerLerRapido").disabled = true;
  $("scannerLer").disabled = true;
  $("scannerConfirmar").disabled = true;
  setStatus("");
  setProgresso("Otimizando a foto para uma leitura rápida…", 24);

  try {
    const imagem = prepararImagemParaIA();
    setProgresso("Lendo a escrita cursiva e procurando o valor…", 62);
    const resultado = await lerRegistroComIA(imagem, "venda", controller.signal);
    if (sequencia !== leituraIaSequencia || controller.signal.aborted) return;
    resultadoIaAtual = resultado;
    aplicarResultadoIa(resultado);
    setProgresso(resultado.valor > 0
      ? "Leitura concluída. Confira o valor e confirme a venda."
      : "Não consegui ler o valor com segurança. Digite-o manualmente ou use a leitura local.", 100);
  } catch (erro) {
    if (controller.signal.aborted || sequencia !== leituraIaSequencia) return;
    console.warn("Leitura inteligente indisponível:", erro?.codigo || erro?.message || erro);
    liberarRevisao(0, "Não informado", [], 0);
    setProgresso(erro?.message || "A leitura inteligente falhou. Use a leitura local ou digite o valor.", 0);
  } finally {
    if (sequencia === leituraIaSequencia) {
      controllerLeituraIa = null;
      $("scannerLer").disabled = !arquivoAtual;
      $("scannerLerRapido").disabled = !arquivoAtual || modoAtual() !== "caixa";
    }
  }
}

async function processarLeituraLocal() {
  if (!arquivoAtual) return;
  if (blobTratado) return processarOCR();
  pontos = pontos.length === 4 ? pontos : pontosPadrao();
  await melhorarImagem({ lerDepois: true });
}

async function carregarArquivo(arquivo) {
  if (!arquivo) return;
  if (!arquivo.type.startsWith("image/")) return setStatus("❌ Escolha uma imagem JPG, PNG ou WEBP.", "erro");
  if (arquivo.size > 18 * 1024 * 1024) return setStatus("❌ A imagem é muito grande. Escolha uma foto de até 18 MB.", "erro");
  limpar(false);
  arquivoAtual = arquivo;
  bufferOriginal = await arquivo.arrayBuffer();
  urlOriginal = URL.createObjectURL(arquivo);
  imagemOriginal = new Image();
  imagemOriginal.decoding = "async";
  imagemOriginal.src = urlOriginal;
  await imagemOriginal.decode();
  pontos = pontosPadrao();
  atualizarRotulos();
  atualizarEtapa(1);

  if (modoAtual() === "caixa") {
    exibirFotoParaLeituraRapida();
    setProgresso("Foto recebida. Iniciando a leitura da escrita…", 12);
    await processarLeituraRapidaIA();
    return;
  }

  $("scannerEditor").hidden = false;
  $("scannerResultado").hidden = true;
  desenharImagemOriginal();
  setProgresso("Foto recebida. Detectando o papel…", 8);
  await detectarAutomaticamente(false);
  await melhorarImagem({ lerDepois: true });
}

async function confirmar() {
  const valor = Number($("scannerValor")?.value || 0);
  const pagamento = $("scannerPagamento")?.value || "Não informado";
  const venda = modoAtual() === "caixa";
  const pagamentos = pagamento === "Pagamento misto" ? pagamentosMistosInformados() : [{ tipo: pagamento, valor }];
  const botao = $("scannerConfirmar");
  if (!Number.isFinite(valor) || valor <= 0) { setStatus("❌ Informe um valor válido.", "erro"); $("scannerValor").focus(); return; }
  if (pagamento === "Pagamento misto") {
    const soma = pagamentos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    if (pagamentos.length < 2) return setStatus("❌ Informe pelo menos duas formas de pagamento.", "erro");
    if (Math.abs(soma - valor) >= 0.01) return setStatus(`❌ A soma dos pagamentos (R$ ${soma.toFixed(2).replace(".", ",")}) deve ser igual ao total.`, "erro");
  }
  botao.disabled = true;
  setStatus(venda ? "Salvando a venda no caixa…" : "Salvando a compra no financeiro…", "carregando");
  try {
    if (venda) {
      const registro = await registrarVendaRapida({ itens: [], total: valor, pagamento, pagamentos, observacao: "Venda importada por foto — sem baixa automática de estoque", permitirSemItens: true, origem: "scanner-caixa" });
      setStatus(`✅ Venda salva no caixa. Registro ${registro.id.slice(-6).toUpperCase()}.`, "sucesso");
    } else {
      const id = await salvarMovimentoFinanceiro({ tipo: "saida", descricao: "Compra digitalizada por foto", categoria: "Compras", valor, pagamento, pagamentos, dataISO: hojeLocalISO(), observacao: "Compra importada pelo scanner de documentos", origem: "scanner-compra", ocrTexto: $("scannerTextoBruto")?.value || "" });
      setStatus(`✅ Compra salva no financeiro. Registro ${id.slice(-6).toUpperCase()}.`, "sucesso");
    }
    window.setTimeout(() => { window.abrirAbaPorNome?.(venda ? "caixa" : "financeiro"); limpar(false); }, 1100);
  } catch (erro) {
    console.error(erro);
    const bloqueado = /permission|permissions|insufficient/i.test(String(erro?.code || erro?.message || ""));
    setStatus(bloqueado ? "❌ O Firebase bloqueou o salvamento. Publique as regras do arquivo firestore.rules." : `❌ ${erro.message || "Não foi possível salvar."}`, "erro");
    botao.disabled = false;
  }
}

function limpar(limparStatus = true) {
  controllerLeituraIa?.abort();
  controllerLeituraIa = null;
  leituraIaSequencia += 1;
  resultadoIaAtual = null;
  arquivoAtual = null; bufferOriginal = null; imagemOriginal = null; pontos = []; blobTratado = null; indiceArrastando = null;
  revogarUrl("original"); revogarUrl("tratado");
  ["scannerArquivoCamera", "scannerArquivoGaleria"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("scannerEditor").hidden = true;
  $("scannerResultado").hidden = true;
  $("scannerPreview").removeAttribute("src");
  $("scannerResultadoTitulo").textContent = "Imagem pronta para leitura";
  $("scannerResultadoBadge").textContent = "✓ melhorada";
  $("scannerTextoBruto").value = "";
  $("scannerValor").value = "";
  $("scannerPagamento").value = "Não informado";
  preencherMistos([]);
  $("scannerConfianca").textContent = "Aguardando";
  $("scannerConfianca").dataset.tipo = "";
  $("scannerConfirmar").disabled = true;
  $("scannerLer").disabled = true;
  if ($("scannerLerRapido")) $("scannerLerRapido").disabled = true;
  setProgresso("", 0);
  atualizarEtapa(1);
  atualizarRotulos();
  if (limparStatus) setStatus("");
}

function voltarAoRecorte() {
  if (!arquivoAtual) return;
  $("scannerResultado").hidden = true;
  $("scannerEditor").hidden = false;
  desenharImagemOriginal();
  atualizarEtapa(2);
  setProgresso("Ajuste os círculos e toque em Remover fundo e melhorar.", 32);
}

function bindArquivo(id) {
  $(id)?.addEventListener("change", evento => {
    const arquivo = evento.target.files?.[0];
    if (arquivo) carregarArquivo(arquivo).catch(erro => {
      console.error(erro);
      setStatus("❌ Não foi possível abrir essa imagem.", "erro");
      setProgresso("Tente fotografar novamente.", 0);
    });
  });
}

bindArquivo("scannerArquivoCamera");
bindArquivo("scannerArquivoGaleria");
document.querySelectorAll(".scanner-handle").forEach(handle => handle.addEventListener("pointerdown", iniciarArraste));
window.addEventListener("pointermove", moverPonto);
window.addEventListener("pointerup", finalizarArraste);
window.addEventListener("pointercancel", finalizarArraste);
$("scannerAutoDetectar")?.addEventListener("click", () => detectarAutomaticamente(true));
$("scannerMelhorar")?.addEventListener("click", () => melhorarImagem({ lerDepois: true }));
$("scannerVoltarRecorte")?.addEventListener("click", voltarAoRecorte);
$("scannerLerRapido")?.addEventListener("click", () => processarLeituraRapidaIA({ forcar: true }));
$("scannerLer")?.addEventListener("click", processarLeituraLocal);
$("scannerConfirmar")?.addEventListener("click", confirmar);
$("scannerLimpar")?.addEventListener("click", () => limpar());
$("scannerPagamento")?.addEventListener("change", atualizarMisto);
$("scannerValor")?.addEventListener("input", atualizarMisto);
camposMistos().forEach(([, elemento]) => elemento?.addEventListener("input", atualizarMisto));
document.querySelectorAll('input[name="scannerTipo"]').forEach(radio => radio.addEventListener("change", async () => {
  controllerLeituraIa?.abort();
  atualizarRotulos();
  $("scannerValor").value = "";
  $("scannerPagamento").value = "Não informado";
  preencherMistos([]);
  $("scannerConfirmar").disabled = true;
  if (!arquivoAtual) return;
  try {
    if (modoAtual() === "caixa") {
      exibirFotoParaLeituraRapida();
      await processarLeituraRapidaIA();
    } else if (blobTratado) {
      await processarOCR();
    } else {
      $("scannerResultado").hidden = true;
      $("scannerEditor").hidden = false;
      desenharImagemOriginal();
      await detectarAutomaticamente(false);
      await melhorarImagem({ lerDepois: true });
    }
  } catch (erro) {
    console.error(erro);
    setProgresso("Não foi possível trocar o tipo da leitura. Tente novamente.", 0);
  }
}));
window.addEventListener("beforeunload", () => {
  controllerLeituraIa?.abort();
  scannerWorker?.terminate();
  ocrWorker?.terminate?.();
  revogarUrl("original"); revogarUrl("tratado");
});

atualizarRotulos();
limpar(false);
