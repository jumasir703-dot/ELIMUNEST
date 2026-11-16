import * as XLSX from 'xlsx';
import {
  EXPENSE_CATEGORIES,
  type CurrencyCode,
  type ExpenseCategory,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type PaymentMethod,
  type SchoolExpense,
  type Tenant,
} from '../shared/types';

export interface VoteheadRevenueLine {
  votehead: string;
  billedAmount: number;
  collectedAmount: number;
  receivableAmount: number;
  sharePct: number;
}

export interface ExpenseCategoryLine {
  category: ExpenseCategory;
  paidAmount: number;
  accruedAmount: number;
  totalAmount: number;
  voucherCount: number;
  documentedCount: number;
  sharePct: number;
}

export interface ChannelCashLine {
  method: PaymentMethod;
  inflows: number;
  outflows: number;
  netBalance: number;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: 'Asset' | 'Liability' | 'Revenue' | 'Expense';
  debit: number;
  credit: number;
}

export interface CashbookEntry {
  entryDate: string;
  voucherOrReceipt: string;
  entryType: 'Fee Receipt' | 'Expense Disbursement' | 'Accrued Expense';
  counterparty: string;
  account: string;
  method: PaymentMethod;
  reference: string;
  supportingDocsCount: number;
  supportingDocsLabel: string;
  cashIn: number;
  cashOut: number;
  runningCashBalance: number;
  status: string;
}

export interface DebtorAgingRow {
  invoiceNumber: string;
  studentCode: string;
  studentName: string;
  grade: string;
  term: string;
  dueDate: string;
  agingBucket: 'Current' | '1-30 Days Overdue' | '31-60 Days Overdue' | '60+ Days Overdue';
  totalBilled: number;
  paidAmount: number;
  balanceDue: number;
  status: string;
}

export interface PayableAuditRow {
  voucherNumber: string;
  expenseDate: string;
  title: string;
  category: ExpenseCategory;
  vendor: string;
  paymentMethod: PaymentMethod;
  reference: string;
  amount: number;
  status: string;
  attachmentsCount: number;
  attachmentNames: string;
}

export interface FinancialBooksReport {
  tenantName: string;
  currency: CurrencyCode;
  asOfDate: string;
  generatedAt: string;

  // Profit & Loss (Statement of Financial Performance)
  revenueLines: VoteheadRevenueLine[];
  totalRevenueBilled: number;
  totalCashCollected: number;
  expenseLines: ExpenseCategoryLine[];
  totalPaidExpenses: number;
  totalAccruedExpenses: number;
  totalOperatingExpenses: number;
  netOperatingSurplus: number;
  netCashOperatingSurplus: number;
  collectionEfficiencyPct: number;
  expenseToRevenuePct: number;

  // Balance Sheet (Statement of Financial Position)
  cashChannelLines: ChannelCashLine[];
  netCashPosition: number;
  cashAssetBalance: number;
  bankOverdraftLiability: number;
  accountsReceivable: number;
  totalCurrentAssets: number;
  accountsPayable: number;
  totalCurrentLiabilities: number;
  accumulatedSurplusEquity: number;
  totalLiabilitiesAndEquity: number;
  balanceSheetBalanced: boolean;

  // Trial Balance
  trialBalanceRows: TrialBalanceRow[];
  trialBalanceTotalDebits: number;
  trialBalanceTotalCredits: number;
  trialBalanceBalanced: boolean;

  // Supporting Schedules
  cashbookEntries: CashbookEntry[];
  debtorsSchedule: DebtorAgingRow[];
  payablesAndAuditSchedule: PayableAuditRow[];
  supportingDocCoveragePct: number;
  vouchersWithDocsCount: number;
  totalVouchersCount: number;
}

function getStructureVotelines(fs: FeeStructure): FeeVoteline[] {
  if (Array.isArray(fs.votelines) && fs.votelines.length > 0) {
    return fs.votelines;
  }
  return [
    { id: 'vl-tuition', name: 'Tuition Fee', amount: fs.tuitionFee || 0 },
    { id: 'vl-lab', name: 'Laboratory Fee', amount: fs.labFee || 0 },
    { id: 'vl-tech', name: 'Technology & ICT', amount: fs.technologyFee || 0 },
    { id: 'vl-act', name: 'Co-Curricular & Activities', amount: fs.activitiesFee || 0 },
  ];
}

function allocateProportionally(totalAmount: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.round(totalAmount));
  if (weights.length === 0) return [];
  const cleanWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = cleanWeights.reduce((sum, w) => sum + w, 0);

  if (weightSum <= 0) {
    const equalBase = Math.floor(safeTotal / cleanWeights.length);
    const rem = safeTotal - equalBase * cleanWeights.length;
    return cleanWeights.map((_, idx) => equalBase + (idx < rem ? 1 : 0));
  }

  const shares = cleanWeights.map((w, idx) => {
    const exact = (safeTotal * w) / weightSum;
    const base = Math.floor(exact);
    return { idx, base, frac: exact - base };
  });

  const allocatedSum = shares.reduce((sum, item) => sum + item.base, 0);
  const remainder = safeTotal - allocatedSum;
  const sortedByFrac = [...shares].sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  const result = shares.map((s) => s.base);
  for (let i = 0; i < remainder && i < sortedByFrac.length; i += 1) {
    result[sortedByFrac[i].idx] += 1;
  }
  return result;
}

function computeAgingBucket(dueDate: string, asOfDate: string): DebtorAgingRow['agingBucket'] {
  const dueMs = Date.parse(dueDate);
  const refMs = Date.parse(asOfDate);
  if (Number.isNaN(dueMs) || Number.isNaN(refMs) || refMs <= dueMs) {
    return 'Current';
  }
  const days = Math.floor((refMs - dueMs) / (1000 * 60 * 60 * 24));
  if (days <= 30) return '1-30 Days Overdue';
  if (days <= 60) return '31-60 Days Overdue';
  return '60+ Days Overdue';
}

export function buildFinancialBooksReport(params: {
  tenant: Tenant;
  feeStructures: FeeStructure[];
  invoices: FeeInvoice[];
  expenses: SchoolExpense[];
  asOfDate?: string;
}): FinancialBooksReport {
  const { tenant, feeStructures, invoices, expenses } = params;
  const effectiveAsOfDate =
    params.asOfDate && params.asOfDate.trim()
      ? params.asOfDate.trim()
      : new Date().toISOString().slice(0, 10);
  const filterByAsOf = Boolean(params.asOfDate && params.asOfDate.trim());

  const scopedInvoices = invoices
    .filter((inv) => !filterByAsOf || inv.createdAt.slice(0, 10) <= effectiveAsOfDate)
    .map((inv) => {
      const payments = (inv.payments || []).filter(
        (p) => !filterByAsOf || p.paidAt.slice(0, 10) <= effectiveAsOfDate
      );
      const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      const balance = Math.max(0, inv.totalAmount - paidAmount);
      return {
        ...inv,
        payments,
        paidAmount,
        balance,
        status: balance === 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Pending',
      } as FeeInvoice;
    });

  const scopedExpenses = expenses.filter(
    (exp) => !filterByAsOf || exp.expenseDate <= effectiveAsOfDate
  );

  // 1. Apportion Fee Revenue across Fee Structure Votelines
  const voteheadMap = new Map<string, { billed: number; collected: number }>();
  for (const inv of scopedInvoices) {
    const matchedStructure =
      feeStructures.find((fs) => fs.grade === inv.grade && fs.term === inv.term) ||
      feeStructures.find((fs) => fs.grade === inv.grade);
    const votelines = matchedStructure
      ? getStructureVotelines(matchedStructure)
      : [{ id: 'vl-general', name: 'Tuition & General Fees', amount: inv.totalAmount }];
    const weights = votelines.map((v) => v.amount);
    const billedAlloc = allocateProportionally(inv.totalAmount, weights);
    const paidAlloc = allocateProportionally(inv.paidAmount, weights);

    votelines.forEach((vl, idx) => {
      const key = vl.name.trim() || 'General Tuition';
      const curr = voteheadMap.get(key) || { billed: 0, collected: 0 };
      curr.billed += billedAlloc[idx] || 0;
      curr.collected += paidAlloc[idx] || 0;
      voteheadMap.set(key, curr);
    });
  }

  const totalRevenueBilled = scopedInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
  const totalCashCollected = scopedInvoices.reduce((s, inv) => s + inv.paidAmount, 0);
  const accountsReceivable = scopedInvoices.reduce((s, inv) => s + inv.balance, 0);

  const revenueLines: VoteheadRevenueLine[] = Array.from(voteheadMap.entries())
    .map(([votehead, val]) => ({
      votehead,
      billedAmount: val.billed,
      collectedAmount: val.collected,
      receivableAmount: Math.max(0, val.billed - val.collected),
      sharePct: totalRevenueBilled > 0 ? (val.billed / totalRevenueBilled) * 100 : 0,
    }))
    .sort((a, b) => b.billedAmount - a.billedAmount);

  // 2. Operating Expenses by Category
  const expenseMap = new Map<
    ExpenseCategory,
    { paid: number; accrued: number; count: number; docs: number }
  >();
  for (const cat of EXPENSE_CATEGORIES) {
    expenseMap.set(cat, { paid: 0, accrued: 0, count: 0, docs: 0 });
  }

  for (const exp of scopedExpenses) {
    const curr = expenseMap.get(exp.category) || { paid: 0, accrued: 0, count: 0, docs: 0 };
    if (exp.status === 'Paid') curr.paid += exp.amount;
    else curr.accrued += exp.amount;
    curr.count += 1;
    if ((exp.attachments || []).length > 0) curr.docs += 1;
    expenseMap.set(exp.category, curr);
  }

  const totalPaidExpenses = scopedExpenses
    .filter((e) => e.status === 'Paid')
    .reduce((s, e) => s + e.amount, 0);
  const totalAccruedExpenses = scopedExpenses
    .filter((e) => e.status !== 'Paid')
    .reduce((s, e) => s + e.amount, 0);
  const totalOperatingExpenses = totalPaidExpenses + totalAccruedExpenses;

  const expenseLines: ExpenseCategoryLine[] = Array.from(expenseMap.entries())
    .filter(([, val]) => val.count > 0 || val.paid > 0 || val.accrued > 0)
    .map(([category, val]) => {
      const total = val.paid + val.accrued;
      return {
        category,
        paidAmount: val.paid,
        accruedAmount: val.accrued,
        totalAmount: total,
        voucherCount: val.count,
        documentedCount: val.docs,
        sharePct: totalOperatingExpenses > 0 ? (total / totalOperatingExpenses) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const netOperatingSurplus = totalRevenueBilled - totalOperatingExpenses;
  const netCashOperatingSurplus = totalCashCollected - totalPaidExpenses;
  const collectionEfficiencyPct =
    totalRevenueBilled > 0 ? (totalCashCollected / totalRevenueBilled) * 100 : 0;
  const expenseToRevenuePct =
    totalRevenueBilled > 0 ? (totalOperatingExpenses / totalRevenueBilled) * 100 : 0;

  // 3. Cash Channels & Balance Sheet Position
  const channels: PaymentMethod[] = ['Bank Transfer', 'Mobile Money', 'Card', 'Cash'];
  const cashChannelLines: ChannelCashLine[] = channels.map((method) => {
    const inflows = scopedInvoices.reduce(
      (sum, inv) =>
        sum +
        (inv.payments || [])
          .filter((p) => p.method === method)
          .reduce((pSum, p) => pSum + p.amount, 0),
      0
    );
    const outflows = scopedExpenses
      .filter((e) => e.status === 'Paid' && e.paymentMethod === method)
      .reduce((sum, e) => sum + e.amount, 0);
    return {
      method,
      inflows,
      outflows,
      netBalance: inflows - outflows,
    };
  });

  const netCashPosition = totalCashCollected - totalPaidExpenses;
  const cashAssetBalance = netCashPosition >= 0 ? netCashPosition : 0;
  const bankOverdraftLiability = netCashPosition < 0 ? Math.abs(netCashPosition) : 0;
  const totalCurrentAssets = cashAssetBalance + accountsReceivable;
  const accountsPayable = totalAccruedExpenses;
  const totalCurrentLiabilities = accountsPayable + bankOverdraftLiability;
  const accumulatedSurplusEquity = netOperatingSurplus;
  const totalLiabilitiesAndEquity = totalCurrentLiabilities + accumulatedSurplusEquity;
  const balanceSheetBalanced = totalCurrentAssets === totalLiabilitiesAndEquity;

  // 4. Trial Balance (Double-Entry Ledger)
  const trialBalanceRows: TrialBalanceRow[] = [];
  if (netCashPosition >= 0) {
    trialBalanceRows.push({
      accountCode: '1010',
      accountName: 'Cash & Bank Equivalents (All Channels)',
      accountType: 'Asset',
      debit: cashAssetBalance,
      credit: 0,
    });
  } else {
    trialBalanceRows.push({
      accountCode: '2050',
      accountName: 'Bank / Treasury Overdraft',
      accountType: 'Liability',
      debit: 0,
      credit: bankOverdraftLiability,
    });
  }

  trialBalanceRows.push({
    accountCode: '1200',
    accountName: 'Accounts Receivable — Student Fee Debtors',
    accountType: 'Asset',
    debit: accountsReceivable,
    credit: 0,
  });

  if (accountsPayable > 0) {
    trialBalanceRows.push({
      accountCode: '2010',
      accountName: 'Accounts Payable — Unpaid Expense Vouchers',
      accountType: 'Liability',
      debit: 0,
      credit: accountsPayable,
    });
  }

  revenueLines.forEach((line, idx) => {
    trialBalanceRows.push({
      accountCode: String(4010 + idx * 10),
      accountName: `Fee Income — ${line.votehead}`,
      accountType: 'Revenue',
      debit: 0,
      credit: line.billedAmount,
    });
  });

  expenseLines.forEach((line, idx) => {
    trialBalanceRows.push({
      accountCode: String(5010 + idx * 10),
      accountName: `Operating Expense — ${line.category}`,
      accountType: 'Expense',
      debit: line.totalAmount,
      credit: 0,
    });
  });

  const trialBalanceTotalDebits = trialBalanceRows.reduce((s, r) => s + r.debit, 0);
  const trialBalanceTotalCredits = trialBalanceRows.reduce((s, r) => s + r.credit, 0);
  const trialBalanceBalanced = trialBalanceTotalDebits === trialBalanceTotalCredits;

  // 5. Chronological General Cashbook & Ledger
  const rawCashbook: Array<Omit<CashbookEntry, 'runningCashBalance'>> = [];
  for (const inv of scopedInvoices) {
    for (const pay of inv.payments || []) {
      rawCashbook.push({
        entryDate: pay.paidAt.slice(0, 10),
        voucherOrReceipt: pay.receiptNumber,
        entryType: 'Fee Receipt',
        counterparty: `${inv.studentName} (${inv.studentCode})`,
        account: `Student Fees · ${inv.grade}`,
        method: pay.method,
        reference: pay.reference,
        supportingDocsCount: 1,
        supportingDocsLabel: `Receipt ${pay.receiptNumber}`,
        cashIn: pay.amount,
        cashOut: 0,
        status: 'Cleared',
      });
    }
  }

  for (const exp of scopedExpenses) {
    const attCount = (exp.attachments || []).length;
    const isPaid = exp.status === 'Paid';
    rawCashbook.push({
      entryDate: exp.expenseDate,
      voucherOrReceipt: exp.voucherNumber,
      entryType: isPaid ? 'Expense Disbursement' : 'Accrued Expense',
      counterparty: exp.vendor,
      account: exp.category,
      method: exp.paymentMethod,
      reference: exp.reference,
      supportingDocsCount: attCount,
      supportingDocsLabel:
        attCount > 0 ? `${attCount} document(s) attached` : 'No document attached',
      cashIn: 0,
      cashOut: isPaid ? exp.amount : 0,
      status: exp.status,
    });
  }

  rawCashbook.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  let running = 0;
  const cashbookEntries: CashbookEntry[] = rawCashbook.map((item) => {
    running += item.cashIn - item.cashOut;
    return {
      ...item,
      runningCashBalance: running,
    };
  });

  // 6. Debtors Aging Schedule
  const debtorsSchedule: DebtorAgingRow[] = scopedInvoices
    .filter((inv) => inv.balance > 0)
    .map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      studentCode: inv.studentCode,
      studentName: inv.studentName,
      grade: inv.grade,
      term: inv.term,
      dueDate: inv.dueDate,
      agingBucket: computeAgingBucket(inv.dueDate, effectiveAsOfDate),
      totalBilled: inv.totalAmount,
      paidAmount: inv.paidAmount,
      balanceDue: inv.balance,
      status: inv.status,
    }))
    .sort((a, b) => b.balanceDue - a.balanceDue);

  // 7. Creditors & Supporting Document Audit Schedule
  const payablesAndAuditSchedule: PayableAuditRow[] = scopedExpenses
    .map((exp) => ({
      voucherNumber: exp.voucherNumber,
      expenseDate: exp.expenseDate,
      title: exp.title,
      category: exp.category,
      vendor: exp.vendor,
      paymentMethod: exp.paymentMethod,
      reference: exp.reference,
      amount: exp.amount,
      status: exp.status,
      attachmentsCount: (exp.attachments || []).length,
      attachmentNames:
        (exp.attachments || []).map((a) => `${a.docType}: ${a.fileName}`).join('; ') ||
        'Missing supporting receipt/voucher',
    }))
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));

  const totalVouchersCount = scopedExpenses.length;
  const vouchersWithDocsCount = scopedExpenses.filter(
    (e) => (e.attachments || []).length > 0
  ).length;
  const supportingDocCoveragePct =
    totalVouchersCount > 0 ? (vouchersWithDocsCount / totalVouchersCount) * 100 : 100;

  return {
    tenantName: tenant.name,
    currency: tenant.currency,
    asOfDate: effectiveAsOfDate,
    generatedAt: new Date().toISOString(),

    revenueLines,
    totalRevenueBilled,
    totalCashCollected,
    expenseLines,
    totalPaidExpenses,
    totalAccruedExpenses,
    totalOperatingExpenses,
    netOperatingSurplus,
    netCashOperatingSurplus,
    collectionEfficiencyPct,
    expenseToRevenuePct,

    cashChannelLines,
    netCashPosition,
    cashAssetBalance,
    bankOverdraftLiability,
    accountsReceivable,
    totalCurrentAssets,
    accountsPayable,
    totalCurrentLiabilities,
    accumulatedSurplusEquity,
    totalLiabilitiesAndEquity,
    balanceSheetBalanced,

    trialBalanceRows,
    trialBalanceTotalDebits,
    trialBalanceTotalCredits,
    trialBalanceBalanced,

    cashbookEntries,
    debtorsSchedule,
    payablesAndAuditSchedule,
    supportingDocCoveragePct,
    vouchersWithDocsCount,
    totalVouchersCount,
  };
}

export type AccountingExportBook =
  | 'ALL_BOOKS'
  | 'PL_STATEMENT'
  | 'BALANCE_SHEET'
  | 'TRIAL_BALANCE'
  | 'CASH_FLOW'
  | 'CASHBOOK'
  | 'DEBTORS_PAYABLES';

function buildProfitAndLossSheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows: Array<Array<string | number>> = [
    [`${report.tenantName} — Statement of Profit & Loss (Income & Expenditure)`],
    [`Reporting Currency: ${report.currency}`, `As of Date: ${report.asOfDate}`],
    [],
    ['Section', 'Account / Votehead', 'Billed / Incurred', 'Cash Settled', 'Uncollected / Accrued', 'Share (%)'],
    ...report.revenueLines.map((r) => [
      'Operating Revenue',
      r.votehead,
      r.billedAmount,
      r.collectedAmount,
      r.receivableAmount,
      Number(r.sharePct.toFixed(1)),
    ]),
    [
      'TOTAL REVENUE',
      'Gross School Fee Income',
      report.totalRevenueBilled,
      report.totalCashCollected,
      report.accountsReceivable,
      100,
    ],
    [],
    ...report.expenseLines.map((e) => [
      'Operating Expenditure',
      e.category,
      e.totalAmount,
      e.paidAmount,
      e.accruedAmount,
      Number(e.sharePct.toFixed(1)),
    ]),
    [
      'TOTAL EXPENDITURE',
      'Total Operating Expenses',
      report.totalOperatingExpenses,
      report.totalPaidExpenses,
      report.totalAccruedExpenses,
      100,
    ],
    [],
    [
      'NET SURPLUS / (DEFICIT)',
      'Accrual Operating Surplus (Revenue - Total Expenses)',
      report.netOperatingSurplus,
      report.netCashOperatingSurplus,
      report.accountsReceivable - report.totalAccruedExpenses,
      '',
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 12 }];
  return ws;
}

function buildBalanceSheetWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows: Array<Array<string | number>> = [
    [`${report.tenantName} — Statement of Financial Position (Balance Sheet)`],
    [`Reporting Currency: ${report.currency}`, `As of Date: ${report.asOfDate}`],
    [],
    ['Classification', 'Account Line Item', `Amount (${report.currency})`],
    ['CURRENT ASSETS', 'Cash & Bank Equivalents (Positive Treasury)', report.cashAssetBalance],
    ['CURRENT ASSETS', 'Accounts Receivable — Student Fee Debtors', report.accountsReceivable],
    ['TOTAL ASSETS', 'Total Current & School Assets', report.totalCurrentAssets],
    [],
    ['CURRENT LIABILITIES', 'Accounts Payable — Unpaid Expense Vouchers', report.accountsPayable],
    ['CURRENT LIABILITIES', 'Bank / Treasury Overdraft', report.bankOverdraftLiability],
    ['TOTAL LIABILITIES', 'Total Current Liabilities', report.totalCurrentLiabilities],
    [],
    ['NET ASSETS / EQUITY', 'Accumulated Operating Surplus / (Deficit)', report.accumulatedSurplusEquity],
    ['TOTAL LIABILITIES & EQUITY', 'Total Liabilities + Net Equity', report.totalLiabilitiesAndEquity],
    [],
    ['Reconciliation Status', report.balanceSheetBalanced ? 'BALANCED (Assets = Liabilities + Equity)' : 'OUT OF BALANCE', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 46 }, { wch: 22 }];
  return ws;
}

function buildTrialBalanceWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows: Array<Array<string | number>> = [
    [`${report.tenantName} — General Ledger Trial Balance`],
    [`Reporting Currency: ${report.currency}`, `As of Date: ${report.asOfDate}`],
    [],
    ['Account Code', 'Account Name', 'Account Class', `Debit (${report.currency})`, `Credit (${report.currency})`],
    ...report.trialBalanceRows.map((r) => [
      r.accountCode,
      r.accountName,
      r.accountType,
      r.debit,
      r.credit,
    ]),
    [],
    [
      'TOTAL',
      report.trialBalanceBalanced ? 'TRIAL BALANCE RECONCILED' : 'UNBALANCED',
      '',
      report.trialBalanceTotalDebits,
      report.trialBalanceTotalCredits,
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 44 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
  return ws;
}

function buildCashFlowWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows: Array<Array<string | number>> = [
    [`${report.tenantName} — Statement of Cash Flows`],
    [`Reporting Currency: ${report.currency}`, `As of Date: ${report.asOfDate}`],
    [],
    ['Payment Channel', `Cash Inflows (${report.currency})`, `Cash Outflows (${report.currency})`, `Net Cash Balance (${report.currency})`],
    ...report.cashChannelLines.map((c) => [c.method, c.inflows, c.outflows, c.netBalance]),
    [
      'NET OPERATING CASH FLOW',
      report.totalCashCollected,
      report.totalPaidExpenses,
      report.netCashPosition,
    ],
    [],
    ['Operating Expense Cash Disbursed by Category', 'Paid Cash', 'Pending / Approved Payable', 'Voucher Count'],
    ...report.expenseLines.map((e) => [e.category, e.paidAmount, e.accruedAmount, e.voucherCount]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 42 }, { wch: 22 }, { wch: 24 }, { wch: 22 }];
  return ws;
}

function buildCashbookWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows = report.cashbookEntries.map((c) => ({
    Date: c.entryDate,
    Voucher_or_Receipt: c.voucherOrReceipt,
    Entry_Type: c.entryType,
    Counterparty: c.counterparty,
    Account_Category: c.account,
    Payment_Method: c.method,
    Reference: c.reference,
    Supporting_Documents: c.supportingDocsLabel,
    Cash_In: c.cashIn,
    Cash_Out: c.cashOut,
    Running_Cash_Balance: c.runningCashBalance,
    Status: c.status,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 20 },
    { wch: 28 },
    { wch: 26 },
    { wch: 16 },
    { wch: 18 },
    { wch: 26 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
  ];
  return ws;
}

function buildDebtorsWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows = report.debtorsSchedule.map((d) => ({
    Invoice_No: d.invoiceNumber,
    Student_Code: d.studentCode,
    Student_Name: d.studentName,
    Grade: d.grade,
    Term: d.term,
    Due_Date: d.dueDate,
    Aging_Bucket: d.agingBucket,
    Total_Billed: d.totalBilled,
    Paid_Amount: d.paidAmount,
    Balance_Due: d.balanceDue,
    Status: d.status,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 26 },
    { wch: 12 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
  ];
  return ws;
}

function buildPayablesAndAuditWorksheet(report: FinancialBooksReport): XLSX.WorkSheet {
  const rows = report.payablesAndAuditSchedule.map((p) => ({
    Voucher_No: p.voucherNumber,
    Expense_Date: p.expenseDate,
    Description: p.title,
    Category: p.category,
    Vendor: p.vendor,
    Payment_Method: p.paymentMethod,
    Reference: p.reference,
    Amount: p.amount,
    Status: p.status,
    Attached_Doc_Count: p.attachmentsCount,
    Supporting_Documents: p.attachmentNames,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 32 },
    { wch: 24 },
    { wch: 24 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 42 },
  ];
  return ws;
}

export function downloadFinancialBooksExcel(
  report: FinancialBooksReport,
  book: AccountingExportBook
): string {
  const wb = XLSX.utils.book_new();
  const safeSlug = report.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dateTag = report.asOfDate;

  if (book === 'ALL_BOOKS') {
    const execRows: Array<Array<string | number>> = [
      [`${report.tenantName} — Complete Financial Books Pack`],
      [`Currency: ${report.currency}`, `As of Date: ${report.asOfDate}`],
      [],
      ['Key Financial Metric', `Value (${report.currency})`],
      ['Total Billed School Revenue', report.totalRevenueBilled],
      ['Cash Collected from Fees', report.totalCashCollected],
      ['Accounts Receivable (Fee Debtors)', report.accountsReceivable],
      ['Total Operating Expenses (Paid + Accrued)', report.totalOperatingExpenses],
      ['Disbursed (Paid) Expenses', report.totalPaidExpenses],
      ['Accounts Payable (Unpaid Vouchers)', report.accountsPayable],
      ['Net Operating Surplus / (Deficit)', report.netOperatingSurplus],
      ['Net Cash & Bank Position', report.netCashPosition],
      ['Supporting Document Audit Coverage (%)', Number(report.supportingDocCoveragePct.toFixed(1))],
      ['Balance Sheet Equation Check', report.balanceSheetBalanced ? 'Balanced' : 'Check Variance'],
    ];
    const execWs = XLSX.utils.aoa_to_sheet(execRows);
    execWs['!cols'] = [{ wch: 44 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, execWs, 'Executive Summary');
    XLSX.utils.book_append_sheet(wb, buildProfitAndLossSheet(report), 'Profit & Loss');
    XLSX.utils.book_append_sheet(wb, buildBalanceSheetWorksheet(report), 'Balance Sheet');
    XLSX.utils.book_append_sheet(wb, buildTrialBalanceWorksheet(report), 'Trial Balance');
    XLSX.utils.book_append_sheet(wb, buildCashFlowWorksheet(report), 'Cash Flow');
    XLSX.utils.book_append_sheet(wb, buildCashbookWorksheet(report), 'General Cashbook');
    XLSX.utils.book_append_sheet(wb, buildDebtorsWorksheet(report), 'Fee Debtors');
    XLSX.utils.book_append_sheet(wb, buildPayablesAndAuditWorksheet(report), 'Expense & Audit');

    const fileName = `${safeSlug}-financial-books-${dateTag}.xlsx`;
    XLSX.writeFile(wb, fileName);
    return fileName;
  }

  let fileName = `${safeSlug}-accounting-${dateTag}.xlsx`;
  if (book === 'PL_STATEMENT') {
    XLSX.utils.book_append_sheet(wb, buildProfitAndLossSheet(report), 'Profit & Loss');
    fileName = `${safeSlug}-profit-and-loss-${dateTag}.xlsx`;
  } else if (book === 'BALANCE_SHEET') {
    XLSX.utils.book_append_sheet(wb, buildBalanceSheetWorksheet(report), 'Balance Sheet');
    fileName = `${safeSlug}-balance-sheet-${dateTag}.xlsx`;
  } else if (book === 'TRIAL_BALANCE') {
    XLSX.utils.book_append_sheet(wb, buildTrialBalanceWorksheet(report), 'Trial Balance');
    fileName = `${safeSlug}-trial-balance-${dateTag}.xlsx`;
  } else if (book === 'CASH_FLOW') {
    XLSX.utils.book_append_sheet(wb, buildCashFlowWorksheet(report), 'Cash Flow');
    fileName = `${safeSlug}-cash-flow-${dateTag}.xlsx`;
  } else if (book === 'CASHBOOK') {
    XLSX.utils.book_append_sheet(wb, buildCashbookWorksheet(report), 'General Cashbook');
    fileName = `${safeSlug}-general-cashbook-${dateTag}.xlsx`;
  } else if (book === 'DEBTORS_PAYABLES') {
    XLSX.utils.book_append_sheet(wb, buildDebtorsWorksheet(report), 'Fee Debtors');
    XLSX.utils.book_append_sheet(wb, buildPayablesAndAuditWorksheet(report), 'Payables & Audit');
    fileName = `${safeSlug}-debtors-payables-${dateTag}.xlsx`;
  }

  XLSX.writeFile(wb, fileName);
  return fileName;
}
