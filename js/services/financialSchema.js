export const FINANCIAL_MOVEMENT_TYPE = Object.freeze({ INCOME: "entrada", EXPENSE: "saida", WITHDRAWAL: "retirada" });
export const CASH_SESSION_STATUS = Object.freeze({ OPEN: "aberto", CLOSED: "fechado" });

export function createSaleRecord({ id, items, totalCents, paymentMethod, paymentStatus, businessDate, userId = null, customer = null, note = "" }) {
  return { id, items, totalCents, paymentMethod, paymentStatus, businessDate, userId, customer, note, status: "concluida", createdAt: null, updatedAt: null };
}

export function createFinancialMovementRecord({ id, type, amountCents, businessDate, paymentMethod = null, categoryId = null, saleId = null, cashSessionId = null, description = "", userId = null }) {
  return { id, type, amountCents, businessDate, paymentMethod, categoryId, saleId, cashSessionId, description, userId, status: "valido", createdAt: null, updatedAt: null };
}

export function createCashSessionRecord({ businessDate, openingBalanceCents, openedBy }) {
  return { id: businessDate, businessDate, openingBalanceCents, status: CASH_SESSION_STATUS.OPEN, openedBy, openedAt: null, closedBy: null, closedAt: null, countedCashCents: null, differenceCents: null, note: "" };
}

export function createReceivableRecord({ id, saleId, totalCents, customer = null, dueDate = null }) {
  return { id, saleId, totalCents, paidCents: 0, balanceCents: totalCents, customer, dueDate, status: "pendente", payments: [], createdAt: null, updatedAt: null };
}
