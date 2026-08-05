import { db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

export let produtos = [];

export const produtosBase = [
  { id: "coxinha", nome: "Coxinha", categoria: "salgados", descricao: "Salgado frito crocante e recheado.", preco: 8, emoji: "🍗", sabores: ["Frango", "Carne"], estoque: 40, minimo: 5, ativo: true, destaque: true, ordem: 1 },
  { id: "risoles", nome: "Risoles", categoria: "salgados", descricao: "Risoles frito com massa macia e recheio saboroso.", preco: 8, emoji: "🥟", sabores: ["Presunto e queijo", "Frango", "Carne"], estoque: 40, minimo: 5, ativo: true, destaque: true, ordem: 2 },
  { id: "bolinha-carne", nome: "Bolinha de carne", categoria: "salgados", descricao: "Bolinha frita com recheio de carne temperada.", preco: 8, emoji: "🥩", sabores: [], estoque: 40, minimo: 5, ativo: true, destaque: false, ordem: 3 },
  { id: "kibe", nome: "Kibe", categoria: "salgados", descricao: "Kibe frito bem temperado.", preco: 8, emoji: "🥟", sabores: [], estoque: 40, minimo: 5, ativo: true, destaque: false, ordem: 4 },
  { id: "enroladinho", nome: "Enroladinho", categoria: "salgados", descricao: "Salgado assado macio e recheado.", preco: 8, emoji: "🧀", sabores: ["Presunto e queijo"], estoque: 40, minimo: 5, ativo: true, destaque: false, ordem: 5 },
  { id: "esfirra", nome: "Esfirra", categoria: "salgados", descricao: "Salgado assado, muito recheado e saboroso.", preco: 8, emoji: "🥟", sabores: ["Carne", "Frango"], estoque: 40, minimo: 5, ativo: true, destaque: false, ordem: 6 },
  { id: "pao-caseiro", nome: "Pão caseiro", categoria: "paes", descricao: "Pão caseiro fresquinho.", preco: 20, emoji: "🍞", sabores: [], estoque: 40, minimo: 5, ativo: true, destaque: true, ordem: 7 },
  { id: "pao-recheado", nome: "Pão recheado", categoria: "paes", descricao: "Pão recheado sob encomenda.", preco: 30, emoji: "🥖", sabores: ["Presunto e queijo", "Calabresa"], estoque: 0, minimo: 0, ativo: true, destaque: true, sobEncomenda: true, ordem: 8 },
  { id: "refrigerante-lata", nome: "Refrigerante lata", categoria: "bebidas", descricao: "Bebida gelada para acompanhar.", preco: 6, emoji: "🥤", sabores: [], estoque: 60, minimo: 10, ativo: true, destaque: false, ordem: 9 },
  {
    id: "coca-cola",
    nome: "Coca-Cola",
    categoria: "bebidas",
    descricao: "Coca-Cola em diferentes tamanhos.",
    emoji: "🥤",
    preco: 6,
    estoque: 0,
    minimo: 0,
    ativo: true,
    destaque: false,
    ordem: 11,
    variacoes: [
      { id: "coca-350", nome: "350ml", preco: 6, estoque: 30, minimo: 5, ativa: true },
      { id: "coca-600", nome: "600ml", preco: 8, estoque: 20, minimo: 5, ativa: true },
      { id: "coca-2l", nome: "2L", preco: 12, estoque: 15, minimo: 5, ativa: true }
    ]
  },
  {
    id: "marmita",
    nome: "Marmita",
    categoria: "marmitas",
    descricao: "Marmita caseira com opções de tamanho.",
    emoji: "🍱",
    preco: 25,
    estoque: 0,
    minimo: 0,
    ativo: true,
    destaque: true,
    ordem: 12,
    variacoes: [
      { id: "marmita-p", nome: "P", preco: 25, estoque: 20, minimo: 1, ativa: true },
      { id: "marmita-m", nome: "M", preco: 35, estoque: 15, minimo: 1, ativa: true },
      { id: "marmita-g", nome: "G", preco: 45, estoque: 10, minimo: 1, ativa: true }
    ]
  },
  { id: "suco-natural", nome: "Suco natural", categoria: "bebidas", descricao: "Suco natural saboroso e refrescante.", preco: 7, emoji: "🧃", sabores: [], estoque: 40, minimo: 5, ativo: true, destaque: false, ordem: 13 }
];

export function observarProdutos(callback) {
  return onSnapshot(collection(db, "produtos"), (snapshot) => {
    produtos = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    callback(produtos);
  });
}

export async function criarProdutosBase() {
  if (!window.isAdmin) { alert("Entre como administrador."); return; }
  for (const produto of produtosBase) {
    await setDoc(doc(db, "produtos", produto.id), { ...produto, atualizadoEm: serverTimestamp() }, { merge: true });
  }
  alert("Produtos base criados/restaurados.");
}

export async function salvarProduto(produto) {
  await setDoc(doc(db, "produtos", produto.id), { ...produto, atualizadoEm: serverTimestamp() }, { merge: true });
}
export async function atualizarProduto(id, dados) {
  await updateDoc(doc(db, "produtos", id), { ...dados, atualizadoEm: serverTimestamp() });
}
export async function excluirProduto(id) { await deleteDoc(doc(db, "produtos", id)); }

export function statusEstoque(produto) {
  if (!produto.ativo) return { texto: "Indisponível", classe: "off", disponivel: false };

  if (Array.isArray(produto.variacoes) && produto.variacoes.length) {
    const disponiveis = produto.variacoes.filter(v => v.ativa !== false && (v.sobEncomenda || Number(v.estoque || 0) > 0));
    if (!disponiveis.length) return { texto: "Esgotado", classe: "off", disponivel: false };
    if (disponiveis.every(v => v.sobEncomenda)) return { texto: "Sob encomenda", classe: "ok", disponivel: true };
    return { texto: "Disponível", classe: "ok", disponivel: true };
  }

  if (produto.sobEncomenda) return { texto: "Sob encomenda", classe: "ok", disponivel: true };
  const estoque = Number(produto.estoque || 0);
  const minimo = Number(produto.minimo || 0);
  if (estoque <= 0) return { texto: "Esgotado", classe: "off", disponivel: false };
  if (estoque <= minimo) return { texto: "Estoque baixo", classe: "baixo", disponivel: true };
  return { texto: "Disponível", classe: "ok", disponivel: true };
}
