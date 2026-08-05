export async function sugerirProdutoComIA(nome) {
  const resposta = await fetch("/api/sugerir-produto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome })
  });

  const data = await resposta.json();

  if (!resposta.ok) {
    throw new Error(data?.erro || "Erro ao gerar sugestão com IA.");
  }

  return data;
}
