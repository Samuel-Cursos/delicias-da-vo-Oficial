import {
  PAYMENT_STATUS,
  calculateAverageTicketCents,
  calculateCashDifferenceCents,
  calculateChangeCents,
  calculateExpectedCashCents,
  calculateSaleTotalCents,
  isReceivedPayment,
  toCents
} from "./financialCore.js";

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": esperado " + expected + ", recebido " + actual);
}

assertEqual(calculateSaleTotalCents([{ quantidade: 2, preco: 12.5 }, { quantidade: 1, preco: 8 }]), 3300, "total da venda");
assertEqual(calculateChangeCents(toCents(50), toCents(32.75)), 1725, "troco");
assertEqual(calculateExpectedCashCents({ openingBalanceCents: 10000, cashSalesCents: 25000, cashIncomeCents: 5000, cashExpensesCents: 7200, cashWithdrawalsCents: 3000 }), 29800, "caixa esperado");
assertEqual(calculateCashDifferenceCents(29800, 29500), -300, "diferença de caixa");
assertEqual(calculateAverageTicketCents(10000, 4), 2500, "ticket médio");
assertEqual(isReceivedPayment(PAYMENT_STATUS.PAID), true, "pagamento recebido");
assertEqual(isReceivedPayment(PAYMENT_STATUS.PENDING), false, "pendência não recebida");

console.log("Testes financeiros aprovados.");
