
import { db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction } from "../core/firebase.js";

export let encomendasFesta = [];

function formatarNumeroPedido(numero) {
  return `DV-${String(numero).padStart(4, "0")}`;
}

export function observarEncomendasFesta(callback) {
  return onSnapshot(collection(db, "encomendasFesta"), snapshot => {
    encomendasFesta = snapshot.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => {
        const ta = a.criadoEm?.toMillis?.() || a.criadoEmMs || 0;
        const tb = b.criadoEm?.toMillis?.() || b.criadoEmMs || 0;
        return tb - ta;
      });
    callback(encomendasFesta, null);
  }, erro => callback(encomendasFesta, erro));
}

export async function registrarEncomendaFesta(dados) {
  const contadorRef = doc(db, "contadores", "encomendasFesta");
  const pedidoRef = doc(collection(db, "encomendasFesta"));

  const pedido = await runTransaction(db, async (transaction) => {
    const contadorSnap = await transaction.get(contadorRef);
    const ultimoNumero = contadorSnap.exists() ? Number(contadorSnap.data().ultimoNumero || 0) : 0;
    const proximoNumero = ultimoNumero + 1;

    const novoPedido = {
      ...dados,
      numero: formatarNumeroPedido(proximoNumero),
      numeroSequencial: proximoNumero,
      status: "aguardando_confirmacao",
      visualizado: false,
      criadoEmMs: Date.now(),
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    };

    transaction.set(contadorRef, {
      ultimoNumero: proximoNumero,
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    transaction.set(pedidoRef, novoPedido);
    return novoPedido;
  });

  return { id: pedidoRef.id, ...pedido };
}

export async function atualizarStatusEncomendaFesta(id, status) {
  await updateDoc(doc(db, "encomendasFesta", id), {
    status,
    atualizadoEm: serverTimestamp()
  });
}

export async function marcarEncomendaVisualizada(id) {
  await updateDoc(doc(db, "encomendasFesta", id), {
    visualizado: true,
    visualizadoEm: serverTimestamp()
  });
}


export async function excluirEncomendaFesta(id) {
  await deleteDoc(doc(db, "encomendasFesta", id));
}
