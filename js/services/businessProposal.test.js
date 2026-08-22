import test from "node:test";
import assert from "node:assert/strict";
import {
  PEDIDO_MINIMO_EMPRESA,
  descreverFrequenciaEmpresa,
  formatarDataEmpresa,
  montarMensagemPropostaEmpresa,
  validarPropostaEmpresa
} from "./businessProposal.js";

const propostaValida = {
  empresa: "Empresa Silva",
  responsavel: "Samuel",
  telefone: "(17) 99999-9999",
  quantidade: 5,
  frequenciaTipo: "todos",
  frequencia: "Todos os dias (segunda a sábado)",
  diasSemana: ["segunda", "terca", "quarta", "quinta", "sexta", "sabado"],
  recebimento: "Entrega na empresa",
  endereco: {
    cep: "15500-000",
    rua: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    complemento: "Portaria lateral",
    cidade: "Votuporanga",
    uf: "SP"
  },
  horario: "11h30",
  dataInicio: "2026-08-25",
  observacoes: "Portaria lateral"
};

test("mantém o mínimo empresarial em 5 marmitas por dia", () => {
  assert.equal(PEDIDO_MINIMO_EMPRESA, 5);
  assert.deepEqual(validarPropostaEmpresa(propostaValida), { valido: true });
  assert.deepEqual(validarPropostaEmpresa({ ...propostaValida, quantidade: 4 }), {
    valido: false,
    campo: "empresaQuantidade",
    mensagem: "A modalidade empresarial exige no mínimo 5 marmitas por dia."
  });
});

test("rejeita um WhatsApp sem DDD", () => {
  assert.equal(validarPropostaEmpresa({ ...propostaValida, telefone: "9999-9999" }).campo, "empresaWhatsapp");
});

test("exige os dias quando a empresa escolhe frequência parcial", () => {
  const resultado = validarPropostaEmpresa({
    ...propostaValida,
    frequenciaTipo: "alguns",
    frequencia: "",
    diasSemana: []
  });
  assert.equal(resultado.campo, "empresaDiasSemanaCampo");
});

test("descreve os dias escolhidos sem incluir domingo", () => {
  assert.equal(
    descreverFrequenciaEmpresa("alguns", ["segunda", "quarta", "sabado", "domingo"]),
    "Segunda-feira, Quarta-feira, Sábado"
  );
});

test("monta uma mensagem completa para o atendimento", () => {
  const mensagem = montarMensagemPropostaEmpresa(propostaValida);
  assert.match(mensagem, /Empresa: Empresa Silva/);
  assert.match(mensagem, /Quantidade estimada: 5 marmitas por dia/);
  assert.match(mensagem, /CEP: 15500-000/);
  assert.match(mensagem, /Rua das Flores, 120/);
  assert.match(mensagem, /Previsão de início: 25\/08\/2026/);
  assert.match(mensagem, /Observações: Portaria lateral/);
  assert.match(mensagem, /cardápio, disponibilidade, valores e condições/);
});

test("trata a data vazia como informação a combinar", () => {
  assert.equal(formatarDataEmpresa(""), "A combinar");
});
