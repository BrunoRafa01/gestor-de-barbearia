// Regras de negocio do modulo Financeiro: receitas, despesas, comissoes,
// lucro liquido, formas de pagamento e fechamento de caixa por barbearia.

import { all, get, run } from './db.js';
import { HttpError } from './http.js';
import { resolveRange } from './reports.js';
import type { PaymentMethod } from './types.js';
import {
  optionalString,
  requiredDate,
  requiredEnum,
  requiredNumber,
  requiredString,
} from './validate.js';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'pix',
  'credit_card',
  'debit_card',
  'cash',
  'other',
];

export interface ExpenseRecord {
  id: number;
  shop_id?: number;
  description: string;
  category: string;
  amount: number;
  payment_method: string;
  date: string;
  notes: string | null;
  created_at: string;
}

export interface FinancialSummaryResult {
  range: { from: string; to: string };
  summary: {
    revenue_realized: number;
    revenue_expected: number;
    completed_count: number;
    total_commissions: number;
    total_expenses: number;
    net_profit: number;
  };
  by_payment_method: Array<{
    payment_method: string;
    count: number;
    total: number;
  }>;
  expenses_by_category: Array<{
    category: string;
    count: number;
    total: number;
  }>;
  expenses: ExpenseRecord[];
  cash_closing: Array<{
    date: string;
    revenue: number;
    expenses: number;
    net: number;
  }>;
}

function mapExpenseRow(row: Record<string, unknown>): ExpenseRecord {
  return {
    id: Number(row['id']),
    shop_id: row['shop_id'] !== undefined ? Number(row['shop_id']) : undefined,
    description: String(row['description'] ?? ''),
    category: String(row['category'] ?? 'Geral'),
    amount: Number(row['amount'] || 0),
    payment_method: String(row['payment_method'] ?? 'pix'),
    date: String(row['date'] ?? ''),
    notes: row['notes'] ? String(row['notes']) : null,
    created_at: String(row['created_at'] ?? ''),
  };
}

export async function buildFinancialSummary(
  query: Record<string, unknown> = {},
  shopId: number = 1
): Promise<FinancialSummaryResult> {
  const { from, to } = resolveRange(query);
  const sid = Number(shopId) || 1;

  const [revRows, commRows, payRows, expRows, expCatRows, dailyRevRows, dailyExpRows] =
    await Promise.all([
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

  const revenueRealized = Number(revRows[0]?.['revenue_realized'] || 0);
  const revenueExpected = Number(revRows[0]?.['revenue_expected'] || 0);
  const completedCount = Number(revRows[0]?.['completed_count'] || 0);
  const totalCommissions = Number(Number(commRows[0]?.['total_commissions'] || 0).toFixed(2));
  const totalExpenses = Number(
    expRows.reduce((acc, row) => acc + Number(row['amount'] || 0), 0).toFixed(2)
  );
  const netProfit = Number((revenueRealized - totalCommissions - totalExpenses).toFixed(2));

  const dailyMap = new Map<string, { date: string; revenue: number; expenses: number }>();
  for (const row of dailyRevRows) {
    const dateKey = String(row['date'] ?? '');
    dailyMap.set(dateKey, { date: dateKey, revenue: Number(row['revenue'] || 0), expenses: 0 });
  }
  for (const row of dailyExpRows) {
    const dateKey = String(row['date'] ?? '');
    const entry = dailyMap.get(dateKey) || { date: dateKey, revenue: 0, expenses: 0 };
    entry.expenses = Number(row['expenses'] || 0);
    dailyMap.set(dateKey, entry);
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
      payment_method: String(row['payment_method'] ?? 'pix'),
      count: Number(row['count'] || 0),
      total: Number(row['total'] || 0),
    })),
    expenses_by_category: expCatRows.map((row) => ({
      category: String(row['category'] ?? 'Geral'),
      count: Number(row['count'] || 0),
      total: Number(row['total'] || 0),
    })),
    expenses: expRows.map(mapExpenseRow),
    cash_closing: cashClosing,
  };
}

export async function createExpense(
  body: Record<string, unknown>,
  shopId: number = 1
): Promise<ExpenseRecord> {
  const sid = Number(shopId) || 1;
  const description = requiredString(body['description'], 'descricao', { max: 140 });
  const category = optionalString(body['category'], 'categoria', 60) || 'Geral';
  const amount = requiredNumber(body['amount'], 'valor', { min: 0.01, max: 1000000 });
  const paymentMethod: PaymentMethod = body['payment_method']
    ? requiredEnum(String(body['payment_method']), PAYMENT_METHODS, 'forma de pagamento')
    : 'pix';
  const date = requiredDate(body['date'], 'data');
  const notes = optionalString(body['notes'], 'observacoes', 300);

  const info = await run(
    `INSERT INTO expenses (shop_id, description, category, amount, payment_method, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sid, description, category, Number(amount.toFixed(2)), paymentMethod, date, notes]
  );

  const created = await get('SELECT * FROM expenses WHERE id = ? AND shop_id = ?', [
    Number(info.lastInsertRowid),
    sid,
  ]);
  if (!created) {
    throw new HttpError(500, 'Nao foi possivel carregar a despesa criada.');
  }
  return mapExpenseRow(created);
}

export async function deleteExpense(
  id: number | string,
  shopId: number = 1
): Promise<{ deleted: true; id: number }> {
  const sid = Number(shopId) || 1;
  const numericId = Number(id);
  const existing = await get('SELECT id FROM expenses WHERE id = ? AND shop_id = ?', [
    numericId,
    sid,
  ]);
  if (!existing) throw new HttpError(404, 'Despesa nao encontrada.');
  await run('DELETE FROM expenses WHERE id = ? AND shop_id = ?', [numericId, sid]);
  return { deleted: true, id: numericId };
}
