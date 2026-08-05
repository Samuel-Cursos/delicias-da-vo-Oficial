import { db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";
import { hojeISO } from "../core/utils.js";

export let promocoes = [];

export function observarPromocoes(callback) {
  return onSnapshot(collection(db, "promocoes"), (snapshot) => {
    promocoes = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));

    callback(promocoes);
  });
}

export function promocaoValida(promocao) {
  if (!promocao || !promocao.ativa) return false;
  const hoje = hojeISO();
  const inicioOk = !promocao.inicio || promocao.inicio <= hoje;
  const fimOk = !promocao.fim || promocao.fim >= hoje;
  return inicioOk && fimOk;
}

export function promocaoAtivaParaProduto(produto, variacaoId) {
  const regras = promocoes.filter(promocaoValida);

  if (!produto) return null;

  if (variacaoId) {
    const promoVariacao = regras.find(p => p.variacaoId === variacaoId && p.produtoId === produto.id);
    if (promoVariacao) return promoVariacao;
  }

  const promoProduto = regras.find(p => p.produtoId === produto.id && !p.variacaoId);
  if (promoProduto) return promoProduto;

  const promoCategoria = regras.find(p => p.categoria === produto.categoria && !p.produtoId && !p.variacaoId);
  if (promoCategoria) return promoCategoria;

  return null;
}

export async function salvarPromocao(promocao) {
  await setDoc(doc(db, "promocoes", promocao.id), {
    ...promocao,
    atualizadoEm: serverTimestamp(),
    criadoEm: promocao.criadoEm || serverTimestamp()
  }, { merge: true });
}

export async function atualizarPromocao(id, dados) {
  await updateDoc(doc(db, "promocoes", id), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function excluirPromocao(id) {
  await deleteDoc(doc(db, "promocoes", id));
}
