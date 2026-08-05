import { auth } from "../core/firebase.js";

export async function sugerirProdutoComIA(nome) {
  const token = await auth.currentUser?.getIdToken?.();

  if (!token) {
    throw new Error("Entre como administrador para usar a IA.");
  }

  const resposta = await fetch("/api/sugerir-produto", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ nome })
  });

  const data = await resposta.json();

  if (!resposta.ok) {
    throw new Error(data?.erro || "Erro ao gerar sugestão com IA.");
  }

  return data;
}
