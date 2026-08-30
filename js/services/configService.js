import { db, doc, setDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

export let lojaConfig = {
  nomeLoja: "Delícias da Vó",
  slogan: "Sabor caseiro que conquista!",
  instagram: "@deliciasdavo_alailda",
  instagramNome: "@deliciasdavo_alailda",
  instagramUrl: "https://www.instagram.com/deliciasdavo_alailda/",
  whatsapp: "5518991178906",
  endereco: "",
  enderecoNome: "Endereço da loja",
  enderecoUrl: "",
  horario: "Segunda a sexta, das 9h às 18h.",
  entrega: "Grátis até 3 km • acima disso, taxa conforme distância",
  retirada: "Retirada na loja",
  taxasEntrega: {
    ate3Km: 0,
    ate5Km: 7,
    limiteKm: 5
  },
  statusLoja: "aberta"
};

const CACHE_CONFIG_LOJA = "deliciasConfigLojaV53";

function salvarCache(dados) {
  try {
    localStorage.setItem(CACHE_CONFIG_LOJA, JSON.stringify(dados));
  } catch {}
}

function carregarCache() {
  try {
    const dados = JSON.parse(localStorage.getItem(CACHE_CONFIG_LOJA) || "null");
    return dados && typeof dados === "object" ? dados : null;
  } catch {
    return null;
  }
}

function normalizarConfiguracaoPublica(dados = {}) {
  const configuracao = { ...lojaConfig, ...dados };
  const taxas = { ...lojaConfig.taxasEntrega, ...(dados.taxasEntrega || {}) };
  // A primeira faixa é uma regra comercial fixa da loja e não deve voltar a
  // aparecer com o valor antigo por causa de um cache ou configuração legada.
  taxas.ate3Km = 0;
  configuracao.taxasEntrega = taxas;
  if (!configuracao.slogan || /feito com carinho/i.test(configuracao.slogan)) configuracao.slogan = "Sabor caseiro que conquista!";
  if (!configuracao.instagram || configuracao.instagram === "@deliciasda_vo") configuracao.instagram = "@deliciasdavo_alailda";
  if (!configuracao.instagramNome || configuracao.instagramNome === "Instagram da loja") configuracao.instagramNome = configuracao.instagram;
  if (!configuracao.instagramUrl || /deliciasdavo\.com/i.test(configuracao.instagramUrl)) configuracao.instagramUrl = "https://www.instagram.com/deliciasdavo_alailda/";
  if (!configuracao.horario) configuracao.horario = "Segunda a sexta, das 9h às 18h.";
  if (!configuracao.entrega) configuracao.entrega = "Grátis até 3 km • acima disso, taxa conforme distância";
  return configuracao;
}

export function observarConfiguracoesLoja(callback) {
  return onSnapshot(doc(db, "configuracoes", "loja"), (snapshot) => {
    if (snapshot.exists()) {
      lojaConfig = normalizarConfiguracaoPublica(snapshot.data());
    } else {
      lojaConfig = normalizarConfiguracaoPublica();
    }

    salvarCache(lojaConfig);
    callback(lojaConfig, null);
  }, erro => {
    const cache = carregarCache();
    if (cache) lojaConfig = normalizarConfiguracaoPublica(cache);
    callback(lojaConfig, erro);
  });
}

export async function salvarConfiguracoes(dados) {
  await setDoc(doc(db, "configuracoes", "loja"), {
    ...dados,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}
