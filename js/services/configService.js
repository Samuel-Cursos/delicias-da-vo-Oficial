import { db, doc, setDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

export let lojaConfig = {
  nomeLoja: "Delícias da Vó",
  slogan: "Feito com carinho",
  instagram: "@deliciasda_vo",
  whatsapp: "5518991178906",
  endereco: "",
  horario: "",
  entrega: "Taxa conforme distância",
  retirada: "Retirada na loja",
  statusLoja: "aberta"
};

const CACHE_CONFIG_LOJA = "deliciasConfigLojaV52";

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

export function observarConfiguracoesLoja(callback) {
  return onSnapshot(doc(db, "configuracoes", "loja"), (snapshot) => {
    if (snapshot.exists()) {
      lojaConfig = { ...lojaConfig, ...snapshot.data() };
    }

    salvarCache(lojaConfig);
    callback(lojaConfig, null);
  }, erro => {
    const cache = carregarCache();
    if (cache) lojaConfig = { ...lojaConfig, ...cache };
    callback(lojaConfig, erro);
  });
}

export async function salvarConfiguracoes(dados) {
  await setDoc(doc(db, "configuracoes", "loja"), {
    ...dados,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}
