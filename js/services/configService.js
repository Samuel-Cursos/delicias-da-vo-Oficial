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

export function observarConfiguracoesLoja(callback) {
  return onSnapshot(doc(db, "configuracoes", "loja"), (snapshot) => {
    if (snapshot.exists()) {
      lojaConfig = { ...lojaConfig, ...snapshot.data() };
    }

    callback(lojaConfig);
  });
}

export async function salvarConfiguracoes(dados) {
  await setDoc(doc(db, "configuracoes", "loja"), {
    ...dados,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}
