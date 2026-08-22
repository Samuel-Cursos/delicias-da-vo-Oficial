export const PEDIDO_MINIMO_EMPRESA = 5;

export const DIAS_EMPRESA = Object.freeze({
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado"
});

export function formatarDataEmpresa(valor = "") {
  const [ano, mes, dia] = String(valor).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "A combinar";
}

export function normalizarDiasEmpresa(dias = []) {
  return [...new Set((Array.isArray(dias) ? dias : []).filter(dia => DIAS_EMPRESA[dia]))];
}

export function descreverFrequenciaEmpresa(tipo = "", dias = []) {
  const selecionados = normalizarDiasEmpresa(dias);
  if (tipo === "todos") return "Todos os dias (segunda a sábado)";
  if (tipo === "alguns") return selecionados.map(dia => DIAS_EMPRESA[dia]).join(", ");
  if (tipo === "especifico") return selecionados[0] ? DIAS_EMPRESA[selecionados[0]] : "";
  if (tipo === "combinar") return "A combinar";
  return String(tipo || "").trim();
}

export function formatarEnderecoEmpresa(endereco = {}) {
  const linha = [endereco.rua, endereco.numero].filter(Boolean).join(", ");
  const local = [endereco.bairro, endereco.cidade, endereco.uf].filter(Boolean).join(" • ");
  return [linha, endereco.complemento, local].filter(Boolean).join(" — ");
}

export function validarPropostaEmpresa(dados = {}) {
  const minimoConfigurado = Math.max(PEDIDO_MINIMO_EMPRESA, Number(dados.pedidoMinimo || PEDIDO_MINIMO_EMPRESA));
  const frequenciaTipo = String(dados.frequenciaTipo || dados.frequencia || "").trim();
  const dias = normalizarDiasEmpresa(dados.diasSemana);

  if (!dados.empresa) {
    return { valido: false, campo: "empresaNome", mensagem: "Digite o nome da empresa." };
  }
  if (!dados.responsavel) {
    return { valido: false, campo: "empresaResponsavel", mensagem: "Digite o nome da pessoa responsável pelo contato." };
  }
  if (String(dados.telefone || "").replace(/\D/g, "").length < 10) {
    return { valido: false, campo: "empresaWhatsapp", mensagem: "Digite um WhatsApp válido com DDD." };
  }
  if (!Number.isInteger(dados.quantidade) || dados.quantidade < minimoConfigurado) {
    return {
      valido: false,
      campo: "empresaQuantidade",
      mensagem: `A modalidade empresarial exige no mínimo ${minimoConfigurado} marmitas por dia.`
    };
  }
  if (!frequenciaTipo) {
    return { valido: false, campo: "empresaFrequencia", mensagem: "Selecione a frequência pretendida." };
  }
  if (frequenciaTipo === "alguns" && !dias.length) {
    return { valido: false, campo: "empresaDiasSemanaCampo", mensagem: "Marque pelo menos um dia da semana." };
  }
  if (frequenciaTipo === "especifico" && dias.length !== 1) {
    return { valido: false, campo: "empresaDiaEspecifico", mensagem: "Escolha o dia específico da semana." };
  }
  if (!dados.recebimento) {
    return { valido: false, campo: "empresaRecebimento", mensagem: "Selecione como a empresa prefere receber." };
  }
  if (dados.recebimento === "Entrega na empresa") {
    if (String(dados.endereco?.cep || "").replace(/\D/g, "").length !== 8) {
      return { valido: false, campo: "empresaCep", mensagem: "Digite o CEP completo da empresa." };
    }
    if (!dados.endereco?.rua) {
      return { valido: false, campo: "empresaRua", mensagem: "Informe a rua da empresa." };
    }
    if (!dados.endereco?.numero) {
      return { valido: false, campo: "empresaNumero", mensagem: "Informe o número da empresa." };
    }
    if (!dados.endereco?.bairro) {
      return { valido: false, campo: "empresaBairro", mensagem: "Informe o bairro da empresa." };
    }
  }
  return { valido: true };
}

export function montarMensagemPropostaEmpresa(dados = {}) {
  const frequencia = dados.frequencia || descreverFrequenciaEmpresa(dados.frequenciaTipo, dados.diasSemana);
  const endereco = formatarEnderecoEmpresa(dados.endereco);
  const cep = String(dados.endereco?.cep || "").trim();

  return [
    "Olá! Vim pelo site da Delícias da Vó e gostaria de receber uma proposta de marmitas para empresa.",
    "",
    "*SOLICITAÇÃO EMPRESARIAL*",
    `Empresa: ${dados.empresa}`,
    `Responsável: ${dados.responsavel}`,
    `WhatsApp: ${dados.telefone}`,
    `Quantidade estimada: ${dados.quantidade} marmitas por dia`,
    `Frequência: ${frequencia}`,
    `Recebimento: ${dados.recebimento}`,
    dados.recebimento === "Entrega na empresa" ? `CEP: ${cep || "A informar"}` : "",
    dados.recebimento === "Entrega na empresa" ? `Endereço: ${endereco || "A informar"}` : "",
    `Horário desejado: ${dados.horario || "A combinar"}`,
    `Previsão de início: ${formatarDataEmpresa(dados.dataInicio)}`,
    dados.observacoes ? `Observações: ${dados.observacoes}` : "",
    "",
    "Aguardo informações sobre cardápio, disponibilidade, valores e condições."
  ].filter(Boolean).join("\n");
}
