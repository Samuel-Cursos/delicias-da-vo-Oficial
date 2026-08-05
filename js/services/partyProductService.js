import { db, collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "../core/firebase.js";

export const salgadosFestaBase = [
  { id:"festa-risoles", nome:"Risoles", emoji:"🥟", categoria:"fritos", descricao:"Crocante por fora e bem recheado por dentro.", sabores:["Carne","Frango","Presunto e queijo","Calabresa e queijo"], ativo:true, ordem:1, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:75 },
  { id:"festa-bolinha-queijo", nome:"Bolinha de queijo", emoji:"🧀", categoria:"fritos", descricao:"Pequena, douradinha e com muito queijo.", sabores:["Queijo"], ativo:true, ordem:2, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:75 },
  { id:"festa-coxinha", nome:"Coxinha", emoji:"🍗", categoria:"fritos", descricao:"A queridinha das festas, sequinha e saborosa.", sabores:["Frango","Carne"], ativo:true, ordem:3, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:75 },
  { id:"festa-kibe", nome:"Kibe", emoji:"🟤", categoria:"fritos", descricao:"Tradicional, crocante e muito saboroso.", sabores:["Carne"], ativo:true, ordem:4, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:75 },
  { id:"festa-esfirra", nome:"Esfirra", emoji:"🥙", categoria:"assados", descricao:"Massa macia com recheio caprichado.", sabores:["Carne","Frango"], ativo:true, ordem:5, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:80 },
  { id:"festa-enroladinho", nome:"Enroladinho", emoji:"🌭", categoria:"assados", descricao:"Assado macio e perfeito para qualquer comemoração.", sabores:["Presunto e queijo","Salsicha"], ativo:true, ordem:6, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"cento", precoCento:80 },
  { id:"festa-empadinha", nome:"Empadinha", emoji:"🥧", categoria:"assados", descricao:"Massa delicada e recheio cremoso.", sabores:["Frango","Palmito"], ativo:true, ordem:7, quantidadeInicial:50, incrementoQuantidade:50, quantidadeMaxima:500, tipoPreco:"unitario", precoUnitario:1.50 }
];


export function normalizarPrecoFesta(produto = {}) {
  const nome = String(produto.nome || "").toLowerCase();

  if (produto.tipoPreco === "unitario" || nome.includes("empad")) {
    const precoUnitario = Number(produto.precoUnitario || 1.50);
    return { tipoPreco:"unitario", precoUnitario };
  }

  const precoCentoPadrao = produto.categoria === "assados" ? 80 : 75;
  const precoCento = Number(produto.precoCento || 0) > 0
    ? Number(produto.precoCento)
    : precoCentoPadrao;

  return { tipoPreco:"cento", precoCento };
}

export function calcularPrecoFesta(produto = {}, quantidade = 0) {
  const regra = normalizarPrecoFesta(produto);
  const qtd = Number(quantidade || 0);

  if (regra.tipoPreco === "unitario") {
    return regra.precoUnitario * qtd;
  }

  return regra.precoCento * (qtd / 100);
}

export function textoPrecoFesta(produto = {}) {
  const regra = normalizarPrecoFesta(produto);
  return regra.tipoPreco === "unitario"
    ? `R$ ${regra.precoUnitario.toFixed(2).replace(".", ",")} por unidade`
    : `R$ ${regra.precoCento.toFixed(2).replace(".", ",")} o cento`;
}

export let salgadosFesta = salgadosFestaBase.map(p => ({...p, __origem:"codigo"}));

function mesclar(remotos = []) {
  const mapa = new Map(salgadosFestaBase.map(p => [p.id, {...p, __origem:"codigo"}]));
  remotos.forEach(p => mapa.set(p.id, {...(mapa.get(p.id)||{}), ...p, __origem:"firestore"}));
  return [...mapa.values()].sort((a,b)=>(a.ordem||999)-(b.ordem||999));
}

function prepararParaSalvar(item) {
  const { __origem, criadoEm, atualizadoEm, ...dados } = item || {};
  return dados;
}

export function descreverErroFirestore(erro) {
  const codigo = String(erro?.code || "").toLowerCase();
  if (codigo.includes("permission-denied")) return "O Firestore bloqueou a alteração por falta de permissão nas regras do banco.";
  if (codigo.includes("unauthenticated")) return "Entre com a conta administradora antes de alterar os produtos.";
  if (codigo.includes("unavailable") || codigo.includes("network")) return "O banco está temporariamente indisponível ou o aparelho está sem conexão.";
  return erro?.message || "Não foi possível concluir a operação no Firestore.";
}

export function observarSalgadosFesta(callback) {
  try {
    return onSnapshot(collection(db,"salgadosFesta"), snap => {
      const remotos=snap.docs.map(d=>({id:d.id,...d.data()}));
      salgadosFesta=mesclar(remotos); callback(salgadosFesta, null);
    }, erro => {
      console.warn("Salgados de festa em modo padrão:", erro);
      salgadosFesta=mesclar([]); callback(salgadosFesta, erro);
    });
  } catch (erro) { salgadosFesta=mesclar([]); callback(salgadosFesta, erro); return ()=>{}; }
}

export async function salvarSalgadoFesta(item) {
  const dados = prepararParaSalvar(item);
  await setDoc(doc(db,"salgadosFesta",item.id), {...dados, atualizadoEm:serverTimestamp()}, {merge:true});
}

export async function enviarProdutosBaseParaFirestore() {
  const resultados = await Promise.allSettled(
    salgadosFestaBase.map(item => setDoc(
      doc(db, "salgadosFesta", item.id),
      {...prepararParaSalvar(item), migradoEm: serverTimestamp(), atualizadoEm: serverTimestamp()},
      {merge:true}
    ))
  );
  const falhas = resultados.filter(r => r.status === "rejected");
  if (falhas.length) throw falhas[0].reason;
  return salgadosFestaBase.length;
}
export async function excluirSalgadoFesta(id) {
  const base=salgadosFestaBase.find(p=>p.id===id);
  if(base) await setDoc(doc(db,"salgadosFesta",id), {...base, ativo:false, atualizadoEm:serverTimestamp()}, {merge:true});
  else await deleteDoc(doc(db,"salgadosFesta",id));
}
