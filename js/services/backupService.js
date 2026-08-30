
import {
  db, collection, collectionGroup, doc, getDocs, setDoc, Timestamp
} from "../core/firebase.js";

const COLECOES_RAIZ = [
  "produtos",
  "categorias",
  "promocoes",
  "configuracoes",
  "salgadosFesta",
  "encomendasFesta",
  "solicitacoesEmpresas",
  "pedidosManuais",
  "contadores",
  "contadoresPedidos",
  "vendas",
  "usuarios",
  "contasReceber",
  "movimentosFinanceiros",
  "custosProdutos",
  "fechamentosFinanceiros",
  "cardapiosDiarios",
  "estoqueInsumos",
  "movimentacoesEstoque",
  "fichasTecnicas",
  "fornecedores",
  "compras",
  "sessoesCaixa",
  "movimentosCaixa",
  "perdasEstoque",
  "equipe",
  "convitesEquipe",
  "solicitacoesAcesso"
];

const LIMITE_DOCUMENTOS_BACKUP = 10000;

function caminhoPermitido(segmentos = []) {
  if (segmentos.length === 2) return COLECOES_RAIZ.includes(segmentos[0]);
  return segmentos.length === 4
    && segmentos[0] === "pedidosSite"
    && /^\d{4}-\d{2}-\d{2}$/.test(segmentos[1])
    && segmentos[2] === "pedidos";
}

export function validarBackupCompleto(backup) {
  if (!backup || typeof backup !== "object" || !Array.isArray(backup.documentos)) {
    throw new Error("Arquivo de backup inválido.");
  }
  if (backup.aplicativo && backup.aplicativo !== "Delícias da Vó") {
    throw new Error("Este arquivo não pertence à Delícias da Vó.");
  }
  if (backup.formato !== undefined && ![2, 3].includes(Number(backup.formato))) {
    throw new Error("Formato de backup não reconhecido.");
  }
  if (backup.documentos.length > LIMITE_DOCUMENTOS_BACKUP) {
    throw new Error(`O backup ultrapassa o limite seguro de ${LIMITE_DOCUMENTOS_BACKUP} documentos.`);
  }
  backup.documentos.forEach((item, indice) => {
    if (!item || typeof item !== "object" || typeof item.caminho !== "string" || !item.dados || typeof item.dados !== "object" || Array.isArray(item.dados)) {
      throw new Error(`Documento inválido na posição ${indice + 1}.`);
    }
    const segmentos = item.caminho.split("/").filter(Boolean);
    if (!caminhoPermitido(segmentos) || segmentos.some(segmento => segmento === "." || segmento === ".." || segmento.length > 180)) {
      throw new Error(`Caminho não permitido no backup: ${item.caminho}`);
    }
  });
  return true;
}

function serializar(valor) {
  if (valor === null || valor === undefined) return valor;
  if (valor?.seconds !== undefined && valor?.nanoseconds !== undefined) {
    return { __tipo:"timestamp", seconds:valor.seconds, nanoseconds:valor.nanoseconds };
  }
  if (Array.isArray(valor)) return valor.map(serializar);
  if (typeof valor === "object") {
    const saida = {};
    Object.entries(valor).forEach(([chave,item]) => saida[chave] = serializar(item));
    return saida;
  }
  return valor;
}

function desserializar(valor) {
  if (valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map(desserializar);
  if (typeof valor === "object") {
    if (valor.__tipo === "timestamp") {
      return new Timestamp(Number(valor.seconds || 0), Number(valor.nanoseconds || 0));
    }
    const saida = {};
    Object.entries(valor).forEach(([chave,item]) => saida[chave] = desserializar(item));
    return saida;
  }
  return valor;
}

async function documentosColecao(nome) {
  const snapshot = await getDocs(collection(db, nome));
  return snapshot.docs.map(item => ({
    caminho:item.ref.path,
    dados:serializar(item.data())
  }));
}

export async function gerarBackupCompleto() {
  const documentos = [];

  for (const nome of COLECOES_RAIZ) {
    const itens = await documentosColecao(nome);
    documentos.push(...itens);
  }

  // Pedidos normais ficam em subcoleções: pedidosSite/{data}/pedidos/{id}
  const pedidosSnapshot = await getDocs(collectionGroup(db, "pedidos"));
  pedidosSnapshot.docs.forEach(item => {
    if (item.ref.path.startsWith("pedidosSite/")) {
      documentos.push({ caminho:item.ref.path, dados:serializar(item.data()) });
    }
  });

  return {
    aplicativo:"Delícias da Vó",
    formato:3,
    criadoEm:new Date().toISOString(),
    totalDocumentos:documentos.length,
    documentos
  };
}

export function baixarBackupJson(backup) {
  const blob = new Blob([JSON.stringify(backup,null,2)], { type:"application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `backup-delicias-da-vo-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

export async function restaurarBackupCompleto(backup, progresso) {
  validarBackupCompleto(backup);

  let concluido = 0;
  const total = backup.documentos.length;

  for (let indice=0; indice<backup.documentos.length; indice+=20) {
    const bloco = backup.documentos.slice(indice,indice+20);
    await Promise.all(bloco.map(item => {
      const segmentos = String(item.caminho || "").split("/").filter(Boolean);
      return setDoc(doc(db, ...segmentos), desserializar(item.dados), { merge:true });
    }));
    concluido += bloco.length;
    if (progresso) progresso(concluido,total);
  }

  return total;
}
