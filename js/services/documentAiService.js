import { auth } from "../core/firebase.js";

export async function lerRegistroComIA(imagemDataUrl, modo = "venda", signal) {
  const token = await auth.currentUser?.getIdToken?.();

  if (!token) {
    throw new Error("Entre como administrador para usar a leitura inteligente.");
  }

  const resposta = await fetch("/api/ler-registro", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ imagem: imagemDataUrl, modo }),
    signal
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    const erro = new Error(dados?.erro || "A leitura inteligente não respondeu agora.");
    erro.codigo = dados?.codigo || "";
    throw erro;
  }

  return dados;
}
