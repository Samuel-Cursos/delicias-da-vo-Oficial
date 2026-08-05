const PAYMENT_METHODS = new Set(["Pix", "Dinheiro", "Cartão débito", "Cartão crédito"]);

export const PAYMENT_STATUS = Object.freeze({
  PAID: "pago",
  PENDING: "pendente",
  PARTIALLY_PAID: "parcialmente_pago",
  CANCELED: "cancelado"
});

export function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Valor monetário inválido.");
  return Math.round(number * 100);
}

export function fromCents(cents) {
  const number = Number(cents);
  if (!Number.isInteger(number)) throw new Error("Centavos inválidos.");
  return number / 100;
}

export function requirePositiveCents(cents, field = "Valor") {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(field + " deve ser maior que zero.");
  }
  return cents;
}

export function calculateSaleTotalCents(items = []) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Uma venda precisa ter pelo menos um item.");
  }

  return items.reduce((total, item) => {
    const quantity = Number(item.quantity ?? item.quantidade);
    const unitPriceCents = Number(item.unitPriceCents ?? item.precoUnitarioCentavos ?? toCents(item.unitPrice ?? item.preco));

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantidade de item inválida.");
    }
    requirePositiveCents(unitPriceCents, "Preço unitário");
    return total + quantity * unitPriceCents;
  }, 0);
}

export function calculateChangeCents(receivedCents, totalCents) {
  requirePositiveCents(totalCents, "Total");
  if (!Number.isInteger(receivedCents) || receivedCents < totalCents) {
    throw new Error("O valor recebido deve cobrir o total da venda.");
  }
  return receivedCents - totalCents;
}

export function normalizePaymentMethod(paymentMethod) {
  const method = String(paymentMethod || "").trim();
  if (!PAYMENT_METHODS.has(method)) throw new Error("Forma de pagamento inválida.");
  return method;
}

export function isReceivedPayment(status) {
  return status === PAYMENT_STATUS.PAID || status === PAYMENT_STATUS.PARTIALLY_PAID;
}

export function calculateExpectedCashCents({
  openingBalanceCents = 0,
  cashSalesCents = 0,
  cashIncomeCents = 0,
  cashExpensesCents = 0,
  cashWithdrawalsCents = 0
} = {}) {
  const values = [openingBalanceCents, cashSalesCents, cashIncomeCents, cashExpensesCents, cashWithdrawalsCents];
  if (!values.every(Number.isInteger)) throw new Error("Os valores de caixa devem estar em centavos.");
  return openingBalanceCents + cashSalesCents + cashIncomeCents - cashExpensesCents - cashWithdrawalsCents;
}

export function calculateCashDifferenceCents(expectedCents, countedCents) {
  if (!Number.isInteger(expectedCents) || !Number.isInteger(countedCents)) {
    throw new Error("Os valores de conferência devem estar em centavos.");
  }
  return countedCents - expectedCents;
}

export function calculateAverageTicketCents(revenueCents, saleCount) {
  if (!Number.isInteger(revenueCents) || revenueCents < 0) throw new Error("Faturamento inválido.");
  if (!Number.isInteger(saleCount) || saleCount < 0) throw new Error("Quantidade de vendas inválida.");
  return saleCount === 0 ? 0 : Math.round(revenueCents / saleCount);
}
