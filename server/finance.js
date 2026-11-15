// Regras de negocio do modulo Financeiro: receitas, despesas, comissoes,
// lucro liquido, formas de pagamento e fechamento de caixa por barbearia.

import { all, get, run } from './db.js';
import { HttpError } from './http.js';
import { resolveRange } from './reports.js';
import { optionalString, requiredDate, requiredEnum, requiredNumber, requiredString } from './validate.js';

export const PAYMENT_METHODS = ['pix', 'credit_card', 'debit_card', 'cash', 'other'];

export async function buildFinancialSummary(query = {}, shopId = 1) {
  const { from, to } = resolveRange(query);
  const sid = Number(shopId) || 1;

  const [revRows, commRows, payRows, expRows, expCatRows, dailyRevRows, dailyExpRows] = await Promise.all([
    all(
      `SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END), 0) AS revenue_realized,
              COALESCE(SUM(CASE WHEN status IN ('pending','confirmed','completed') THEN price ELSE 0 END), 0) AS revenue_expected,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
         FROM appointments
        WHERE shop_id = ? AND date BETWEEN ? AND ?`,
      [sid, from, to]
    ),
    all(
      `SELECT COALESCE(SUM(a.price * (COALESCE(b.commission, 0) / 100.0)), 0) AS total_commissions
         FROM appointments a
         JOIN barbers b ON b.id = a.barber_id
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status = 'completed'`,
      [sid, from, to]
    ),
    all(
      `SELECT COALESCE(payment_method, 'pix') AS payment_method,
              COUNT(*) AS count,
              COALESCE(SUM(price), 0) AS total
         FROM appointments
        WHERE shop_id = ? AND date BETWEEN ? AND ? AND status = 'completed'
        GROUP BY COALESCE(payment_method, 'pix')
        ORDER BY total DESC`,
      [sid, from, to]
    ),
    all(
      `SELECT id, description, category, amount, payment_method, date, notes, created_at
         FROM expenses
        WHERE shop_id = ? AND date BETWEEN ? AND ?
        ORDER BY date DESC, id DESC`,
      [sid, from, to]
    ),
    all(
      `SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM expenses
        WHERE shop_id = ? AND date BETWEEN ? AND ?
        GROUP BY category
        ORDER BY total DESC`,
      [sid, from, to]
    ),
    all(
      `SELECT date,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END), 0) AS revenue
         FROM appointments
        WHERE shop_id = ? AND date BETWEEN ? AND ?
        GROUP BY date`,
      [sid, from, to]
    ),
    all(
      `SELECT date, COALESCE(SUM(amount), 0) AS expenses
         FROM expenses
        WHERE shop_id = ? AND date BETWEEN ? AND ?
        GROUP BY date`,
      [sid, from, to]
    ),
  ]);

  const revenueRealized = Number(revRows?.[0]?.revenue_realized || 0);
  const revenueExpected = Number(revRows?.[0]?.revenue_expected || 0);
  const completedCount = Number(revRows?.[0]?.completed_count || 0);
  const totalCommissions = Number(Number(commRows?.[0]?.total_commissions || 0).toFixed(2));
  const totalExpenses = Number(
    expRows.reduce((acc, row) => acc + Number(row.amount || 0), 0).toFixed(2)
  );
  const netProfit = Number((revenueRealized - totalCommissions - totalExpenses).toFixed(2));

  const dailyMap = new Map();
  for (const row of dailyRevRows) {
    dailyMap.set(row.date, { date: row.date, revenue: Number(row.revenue || 0), expenses: 0 });
  }
  for (const row of dailyExpRows) {
    const entry = dailyMap.get(row.date) || { date: row.date, revenue: 0, expenses: 0 };
    entry.expenses = Number(row.expenses || 0);
    dailyMap.set(row.date, entry);
  }
  const cashClosing = Array.from(dailyMap.values())
    .map((d) => ({
      ...d,
      net: Number((d.revenue - d.expenses).toFixed(2)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    range: { from, to },
    summary: {
      revenue_realized: revenueRealized,
      revenue_expected: revenueExpected,
      completed_count: completedCount,
      total_commissions: totalCommissions,
      total_expenses: totalExpenses,
      net_profit: netProfit,
    },
    by_payment_method: payRows.map((row) => ({
      payment_method: row.payment_method,
      count: Number(row.count),
      total: Number(row.total || 0),
    })),
    expenses_by_category: expCatRows.map((row) => ({
      category: row.category,
      count: Number(row.count),
      total: Number(row.total || 0),
    })),
    expenses: expRows.map((row) => ({
      ...row,
      id: Number(row.id),
      amount: Number(row.amount || 0),
    })),
    cash_closing: cashClosing,
  };
}

export async function createExpense(body, shopId = 1) {
  const sid = Number(shopId) || 1;
  const description = requiredString(body.description, 'descricao', { max: 140 });
  const category = optionalString(body.category, 'categoria', 60) || 'Geral';
  const amount = requiredNumber(body.amount, 'valor', { min: 0.01, max: 1000000 });
  const paymentMethod = body.payment_method
    ? requiredEnum(String(body.payment_method), PAYMENT_METHODS, 'forma de pagamento')
    : 'pix';
  const date = requiredDate(body.date, 'data');
  const notes = optionalString(body.notes, 'observacoes', 300);

  const info = await run(
    `INSERT INTO expenses (shop_id, description, category, amount, payment_method, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sid, description, category, Number(amount.toFixed(2)), paymentMethod, date, notes]
  );

  const created = await get('SELECT * FROM expenses WHERE id = ? AND shop_id = ?', [
    Number(info.lastInsertRowid),
    sid,
  ]);
  return { ...created, id: Number(created.id), amount: Number(created.amount) };
}

export async function deleteExpense(id, shopId = 1) {
  const sid = Number(shopId) || 1;
  const existing = await get('SELECT id FROM expenses WHERE id = ? AND shop_id = ?', [Number(id), sid]);
  if (!existing) throw new HttpError(404, 'Despesa nao encontrada.');
  await run('DELETE FROM expenses WHERE id = ? AND shop_id = ?', [Number(id), sid]);
  return { deleted: true, id: Number(id) };
}
