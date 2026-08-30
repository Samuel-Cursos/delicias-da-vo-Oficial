import {
  db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../core/firebase.js";
import { APP_CONFIG } from "../core/config.js";
import { PEDIDO_MINIMO_EMPRESA, formatarEnderecoEmpresa, normalizarDiasEmpresa } from "./businessProposal.js";

export const CONFIG_EMPRESAS_PADRAO = Object.freeze({
  ativo: true,
  pedidoMinimo: PEDIDO_MINIMO_EMPRESA,
  diasAtendimento: ["segunda", "terca", "quarta", "quinta", "sexta", "sabado"],
  entregaTexto: "Grátis até 3 km • após 3 km, há taxa.",
  observacao: "Cardápio, valores, pagamento e demais condições são confirmados no atendimento.",
  titulo: "O almoço da equipe organizado, caseiro e sem complicação.",
  respostaPrazo: "Retorno pelo WhatsApp conforme a disponibilidade da loja."
});

export let configuracaoEmpresas = { ...CONFIG_EMPRESAS_PADRAO };
export let solicitacoesEmpresas = [];

function codigoAleatorio(tamanho = 5) {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const valores = new Uint32Array(tamanho);
  globalThis.crypto?.getRandomValues?.(valores);
  return Array.from(valores, valor => alfabeto[valor % alfabeto.length]).join("");
}

function dataLojaCompacta(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data).map(parte => [parte.type, parte.value]));
  return `${partes.year}${partes.month}${partes.day}`;
}

export function observarConfiguracaoEmpresas(callback) {
  return onSnapshot(doc(db, "configuracoes", "empresas"), snapshot => {
    configuracaoEmpresas = {
      ...CONFIG_EMPRESAS_PADRAO,
      ...(snapshot.exists() ? snapshot.data() : {})
    };
    callback?.(configuracaoEmpresas, null);
  }, erro => callback?.(configuracaoEmpresas, erro));
}

export async function salvarConfiguracaoEmpresas(dados = {}) {
  const pedidoMinimo = Math.max(PEDIDO_MINIMO_EMPRESA, Math.min(500, Number(dados.pedidoMinimo || PEDIDO_MINIMO_EMPRESA)));
  const diasAtendimento = normalizarDiasEmpresa(dados.diasAtendimento);
  await setDoc(doc(db, "configuracoes", "empresas"), {
    ativo: dados.ativo !== false,
    pedidoMinimo,
    diasAtendimento: diasAtendimento.length ? diasAtendimento : [...CONFIG_EMPRESAS_PADRAO.diasAtendimento],
    entregaTexto: String(dados.entregaTexto || CONFIG_EMPRESAS_PADRAO.entregaTexto).trim().slice(0, 220),
    observacao: String(dados.observacao || CONFIG_EMPRESAS_PADRAO.observacao).trim().slice(0, 300),
    titulo: String(dados.titulo || CONFIG_EMPRESAS_PADRAO.titulo).trim().slice(0, 180),
    respostaPrazo: String(dados.respostaPrazo || CONFIG_EMPRESAS_PADRAO.respostaPrazo).trim().slice(0, 220),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export function observarSolicitacoesEmpresas(callback) {
  return onSnapshot(collection(db, "solicitacoesEmpresas"), snapshot => {
    solicitacoesEmpresas = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Number(b.criadoEmMs || 0) - Number(a.criadoEmMs || 0));
    callback?.(solicitacoesEmpresas, null);
  }, erro => callback?.(solicitacoesEmpresas, erro));
}

export async function registrarSolicitacaoEmpresa(dados = {}) {
  const referencia = doc(collection(db, "solicitacoesEmpresas"));
  const agora = Date.now();
  const endereco = {
    cep: String(dados.endereco?.cep || "").trim().slice(0, 9),
    rua: String(dados.endereco?.rua || "").trim().slice(0, 160),
    numero: String(dados.endereco?.numero || "").trim().slice(0, 30),
    bairro: String(dados.endereco?.bairro || "").trim().slice(0, 100),
    complemento: String(dados.endereco?.complemento || "").trim().slice(0, 180),
    cidade: String(dados.endereco?.cidade || "").trim().slice(0, 100),
    uf: String(dados.endereco?.uf || "").trim().toUpperCase().slice(0, 2)
  };
  const solicitacao = {
    empresa: String(dados.empresa || "").trim().slice(0, 160),
    responsavel: String(dados.responsavel || "").trim().slice(0, 120),
    telefone: String(dados.telefone || "").trim().slice(0, 30),
    quantidade: Math.max(PEDIDO_MINIMO_EMPRESA, Math.round(Number(dados.quantidade || PEDIDO_MINIMO_EMPRESA))),
    frequenciaTipo: String(dados.frequenciaTipo || "combinar").trim().slice(0, 30),
    frequencia: String(dados.frequencia || "A combinar").trim().slice(0, 220),
    diasSemana: normalizarDiasEmpresa(dados.diasSemana),
    recebimento: String(dados.recebimento || "A combinar").trim().slice(0, 60),
    endereco,
    enderecoTexto: formatarEnderecoEmpresa(endereco).slice(0, 600),
    horario: String(dados.horario || "").trim().slice(0, 100),
    dataInicio: String(dados.dataInicio || "").trim().slice(0, 10),
    observacoes: String(dados.observacoes || "").trim().slice(0, 1200),
    numero: `DV-E-${dataLojaCompacta()}-${codigoAleatorio()}`,
    status: "nova",
    visualizado: false,
    criadoEmMs: agora,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };
  if (APP_CONFIG.previewMode) {
    const simulada = { id: `preview-${agora}`, ...solicitacao, criadoEm: new Date(agora).toISOString(), atualizadoEm: new Date(agora).toISOString(), preview: true };
    try {
      const chave = `${APP_CONFIG.storagePreview}:empresas`;
      const anteriores = JSON.parse(localStorage.getItem(chave) || "[]");
      localStorage.setItem(chave, JSON.stringify([simulada, ...anteriores].slice(0, 20)));
    } catch {}
    return simulada;
  }
  await setDoc(referencia, solicitacao);
  return { id: referencia.id, ...solicitacao };
}

export async function atualizarSolicitacaoEmpresa(id, dados = {}) {
  const permitido = {};
  if (dados.status !== undefined) permitido.status = String(dados.status).slice(0, 40);
  if (dados.visualizado !== undefined) permitido.visualizado = Boolean(dados.visualizado);
  if (dados.notasInternas !== undefined) permitido.notasInternas = String(dados.notasInternas).trim().slice(0, 2000);
  if (dados.quantidadeConfirmada !== undefined) permitido.quantidadeConfirmada = Math.max(0, Number(dados.quantidadeConfirmada || 0));
  if (dados.valorUnitario !== undefined) permitido.valorUnitario = Math.max(0, Number(dados.valorUnitario || 0));
  if (dados.dataInicioConfirmada !== undefined) permitido.dataInicioConfirmada = String(dados.dataInicioConfirmada || "").slice(0, 10);
  if (dados.diasConfirmados !== undefined) permitido.diasConfirmados = normalizarDiasEmpresa(dados.diasConfirmados);
  if (dados.horarioConfirmado !== undefined) permitido.horarioConfirmado = String(dados.horarioConfirmado || "").trim().slice(0, 100);
  if (dados.proximoContato !== undefined) permitido.proximoContato = String(dados.proximoContato || "").slice(0, 10);
  if (dados.frequenciaPagamento !== undefined) permitido.frequenciaPagamento = String(dados.frequenciaPagamento || "").trim().slice(0, 100);
  if (dados.formaPagamento !== undefined) permitido.formaPagamento = String(dados.formaPagamento || "").trim().slice(0, 100);
  if (dados.emailFinanceiro !== undefined) permitido.emailFinanceiro = String(dados.emailFinanceiro || "").trim().slice(0, 180);
  if (dados.cnpj !== undefined) permitido.cnpj = String(dados.cnpj || "").trim().slice(0, 30);
  if (dados.observacoesProducao !== undefined) permitido.observacoesProducao = String(dados.observacoesProducao || "").trim().slice(0, 1200);
  if (dados.historico !== undefined) permitido.historico = (Array.isArray(dados.historico) ? dados.historico : []).slice(-50).map(item => ({
    status: String(item.status || "").slice(0, 40),
    texto: String(item.texto || "").slice(0, 300),
    emMs: Math.max(0, Number(item.emMs || 0))
  }));
  await updateDoc(doc(db, "solicitacoesEmpresas", id), {
    ...permitido,
    atualizadoEm: serverTimestamp()
  });
}

export async function excluirSolicitacaoEmpresa(id) {
  await deleteDoc(doc(db, "solicitacoesEmpresas", id));
}
