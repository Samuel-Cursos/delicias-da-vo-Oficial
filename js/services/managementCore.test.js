import assert from "node:assert/strict";
import test from "node:test";
import {
  consolidarPedidosGestao,
  gerarNecessidadesProducao,
  calcularAlertasEstoque,
  calcularResumoOperacao,
  calcularRelatorioGestao,
  infoStatus,
  normalizarStatusGestao
} from "./managementCore.js";

test("consolida pedidos das três origens", () => {
  const lista = consolidarPedidosGestao({
    site: [{ id: "s1", caminho: "pedidosSite/2026-08-12/pedidos/s1", total: 25, status: "confirmado", dataISO: "2026-08-12", cliente: { nome: "Ana" }, itens: [] }],
    manuais: [{ id: "m1", total: 30, dataISO: "2026-08-12", cliente: { nome: "Bia" }, itens: [] }],
    encomendas: [{ id: "f1", totalEstimado: 100, dataFesta: "2026-08-14", cliente: { nome: "Caio" }, itens: [] }]
  });
  assert.equal(lista.length, 3);
  assert.equal(lista.find(item => item.id === "s1").origemNome, "Site");
  assert.equal(lista.find(item => item.id === "f1").valor, 100);
});

test("soma produção por item e variação", () => {
  const pedidos = consolidarPedidosGestao({ site: [
    { id: "1", status: "confirmado", itens: [{ nome: "Marmita", sabor: "Bife", quantidade: 2 }] },
    { id: "2", status: "producao", itens: [{ nome: "Marmita", sabor: "Bife", quantidade: 3 }] },
    { id: "3", status: "entregue", itens: [{ nome: "Marmita", sabor: "Bife", quantidade: 10 }] }
  ] });
  const producao = gerarNecessidadesProducao(pedidos);
  assert.equal(producao.length, 1);
  assert.equal(producao[0].quantidade, 5);
});

test("identifica estoque baixo em produtos e insumos", () => {
  const alertas = calcularAlertasEstoque(
    [{ id: "p", nome: "Coxinha", ativo: true, estoque: 2, minimo: 5 }],
    [{ id: "i", nome: "Arroz", ativo: true, quantidade: 3, minimo: 4, unidade: "kg" }]
  );
  assert.equal(alertas.length, 2);
});

test("calcula resumo operacional sem contar cancelados", () => {
  const pedidos = consolidarPedidosGestao({ site: [
    { id: "1", status: "entregue", total: 25, dataISO: "2026-08-12", itens: [] },
    { id: "2", status: "cancelado", total: 100, dataISO: "2026-08-12", itens: [] }
  ] });
  const resumo = calcularResumoOperacao({ pedidos, vendas: [], movimentos: [], dataISO: "2026-08-12" });
  assert.equal(resumo.receita, 25);
  assert.equal(resumo.pedidosHoje, 2);
  assert.equal(resumo.pedidosAbertos, 0);
});

test("calcula relatório e ticket médio", () => {
  const pedidos = consolidarPedidosGestao({ site: [
    { id: "1", status: "entregue", total: 20, pagamento: "Pix", dataISO: "2026-08-12", itens: [{ nome: "Marmita", quantidade: 1 }] }
  ] });
  const relatorio = calcularRelatorioGestao({ pedidos, vendas: [{ id: "v", status: "concluida", total: 30, pagamento: "Dinheiro", dataISO: "2026-08-12", itens: [] }], movimentos: [] });
  assert.equal(relatorio.receita, 50);
  assert.equal(relatorio.ticketMedio, 25);
  assert.equal(relatorio.produtos[0].nome, "Marmita");
  assert.equal(infoStatus("producao").nome, "Em produção");
});

test("não duplica receita do pedido com seu lançamento automático", () => {
  const pedidos = consolidarPedidosGestao({ site: [
    { id: "1", status: "entregue", total: 20, pagamento: "Pix", dataISO: "2026-08-12", itens: [] }
  ] });
  const movimentos = [
    { tipo: "entrada", origem: "pedido-site", valor: 20, dataISO: "2026-08-12" },
    { tipo: "entrada", origem: "gestao-manual", valor: 5, dataISO: "2026-08-12" }
  ];
  const resumo = calcularResumoOperacao({ pedidos, movimentos, dataISO: "2026-08-12" });
  const relatorio = calcularRelatorioGestao({ pedidos, movimentos, inicio: "2026-08-12", fim: "2026-08-12" });
  assert.equal(resumo.receita, 25);
  assert.equal(relatorio.receita, 25);
});

test("normaliza os status usados pelo painel antigo", () => {
  assert.equal(normalizarStatusGestao("em_producao"), "producao");
  assert.equal(normalizarStatusGestao("preparando"), "producao");
  assert.equal(normalizarStatusGestao("concluida"), "entregue");
  assert.equal(normalizarStatusGestao("cancelada"), "cancelado");
});
