import { db, collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

export let categorias = [];

export const categoriasBase = [
  { id: "salgados", nome: "Salgados", emoji: "🥟", ordem: 1, ativa: true, tituloSelecao: "Escolha o sabor" },
  { id: "marmitas", nome: "Marmitas", emoji: "🍱", ordem: 2, ativa: true, tituloSelecao: "Escolha o tamanho" },
  { id: "paes", nome: "Pães", emoji: "🍞", ordem: 3, ativa: true, tituloSelecao: "Escolha a opção" },
  { id: "bebidas", nome: "Bebidas", emoji: "🥤", ordem: 4, ativa: true, tituloSelecao: "Escolha a opção" },
  { id: "outros", nome: "Outros", emoji: "🍽️", ordem: 5, ativa: true, tituloSelecao: "Escolha a opção" }
];

export function normalizarCategorias(lista) {
  return (lista && lista.length ? lista : categoriasBase)
    .map(categoria => ({
      ...categoria,
      tituloSelecao: categoria.tituloSelecao || "Escolha uma opção"
    }))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

export function categoriaPorId(id) {
  const todas = normalizarCategorias(categorias.length ? categorias : categoriasBase);
  return todas.find(categoria => categoria.id === id) || null;
}

export function observarCategorias(callback) {
  return onSnapshot(collection(db, "categorias"), (snapshot) => {
    categorias = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    callback(categorias);
  });
}

export async function salvarCategoria(categoria) {
  await setDoc(doc(db, "categorias", categoria.id), {
    ...categoria,
    tituloSelecao: categoria.tituloSelecao || "Escolha uma opção",
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function excluirCategoria(id) {
  await deleteDoc(doc(db, "categorias", id));
}

export async function criarCategoriasBase() {
  for (const categoria of categoriasBase) {
    await salvarCategoria(categoria);
  }
}
