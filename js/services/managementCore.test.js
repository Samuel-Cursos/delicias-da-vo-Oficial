import assert from "node:assert/strict";
import test from "node:test";
import {
  consolidarPedidosGestao,
  gerarNecessidadesProducao,
  calcularAlertasEstoque,
  calcularResumoOperacao,
  calcularRelatorioGestao,
  avaliarPrazoPedido,
  avaliarJanelaEncomenda,
  filtrarPedidosOperacionais,
  consolidarClientesGestao,
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

test("marca pedido que ultrapassou o tempo de preparo", () => {
  const prazo = avaliarPrazoPedido({ status: "producao", criadoEmMs: 1_000 }, 40, 46 * 60_000 + 1_000);
  assert.equal(prazo.atrasado, true);
  assert.equal(prazo.minutos, 46);
  assert.match(prazo.texto, /6 min atrasado/);
});

test("não marca encomenda futura como atrasada", () => {
  const agora = Date.parse("2026-08-13T12:00:00-03:00");
  const prazo = avaliarPrazoPedido({ status: "confirmado", dataOperacao: "2026-08-20", criadoEmMs: agora - 86_400_000 }, 40, agora);
  assert.equal(prazo.atrasado, false);
  assert.equal(prazo.texto, "Agendado");
});

test("mantém encomenda distante somente na agenda", () => {
  const pedido = { origemTipo: "festa", status: "confirmado", dataOperacao: "2026-09-27" };
  const janela = avaliarJanelaEncomenda(pedido, 7, "2026-08-13");
  assert.equal(janela.preparoLiberado, false);
  assert.equal(janela.dataLiberacao, "2026-09-20");
  assert.match(janela.texto, /Preparo libera/);
  assert.equal(filtrarPedidosOperacionais([pedido], 7, "2026-08-13").length, 0);
});

test("libera encomenda na operação sete dias antes", () => {
  const pedido = { origemTipo: "festa", status: "confirmado", dataOperacao: "2026-09-27" };
  const janela = avaliarJanelaEncomenda(pedido, 7, "2026-09-20");
  assert.equal(janela.preparoLiberado, true);
  assert.equal(janela.diasParaEvento, 7);
  assert.equal(filtrarPedidosOperacionais([pedido], 7, "2026-09-20").length, 1);
});

test("aceita configurar a entrada da encomenda somente no próprio dia", () => {
  const pedido = { origemTipo: "festa", status: "confirmado", dataOperacao: "2026-09-27" };
  assert.equal(avaliarJanelaEncomenda(pedido, 0, "2026-09-26").preparoLiberado, false);
  assert.equal(avaliarJanelaEncomenda(pedido, 0, "2026-09-27").preparoLiberado, true);
});

test("não conta encomenda distante na capacidade operacional", () => {
  const pedidos = [{ origemTipo: "festa", status: "confirmado", dataOperacao: "2026-09-27", valor: 100, itens: [] }];
  const resumo = calcularResumoOperacao({ pedidos, dataISO: "2026-08-13", diasAntecedenciaEncomendas: 7 });
  assert.equal(resumo.pedidosAbertos, 0);
  assert.equal(resumo.encomendasAgendadas, 1);
});

test("junta clientes Google e clientes recebidos pelo WhatsApp", () => {
  const pedidos = consolidarPedidosGestao({
    site: [{ id: "s1", usuarioId: "u1", total: 25, status: "entregue", cliente: { nome: "Ana", telefone: "17999990000" }, itens: [] }],
    manuais: [{ id: "m1", total: 30, status: "entregue", cliente: { nome: "Bruno", telefone: "17988880000" }, itens: [] }]
  });
  const clientes = consolidarClientesGestao({ usuarios: [{ uid: "u1", tipo: "cliente", nome: "Ana", telefone: "17999990000" }], pedidos });
  assert.equal(clientes.length, 2);
  assert.equal(clientes.find(item => item.nome === "Ana").origemPerfil, "google");
  assert.equal(clientes.find(item => item.nome === "Bruno").origemPerfil, "atendimento");
  assert.equal(clientes.reduce((soma, item) => soma + item.total, 0), 55);
});
