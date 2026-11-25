import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeftRight,
  Download,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { MpesaIntegrationPanel } from '../MpesaIntegrationPanel';
import {
  createBrandedWorksheetFromObjects,
  parseExcelSheetRowsSmart,
} from '../../lib/documentBranding';
import { saasApi } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/format';
import type {
  ReconciliationChannel,
  ReconciliationLine,
  ReconciliationStatus,
  UserRole,
} from '../../shared/types';
import type { FinanceControlPanelProps } from './types';

export function ReconciliationPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: FinanceControlPanelProps) {
  const { tenant } = workspace;
  const lines = useMemo(
    () => (workspace.reconciliationLines || []).filter((l) => !l.voided),
    [workspace.reconciliationLines]
  );

  const [activeSection, setActiveSection] = useState<'reconciliation' | 'mpesa'>('reconciliation');
  const [channelFilter, setChannelFilter] = useState<'All' | ReconciliationChannel>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | ReconciliationStatus>('All');
  const [channel, setChannel] = useState<ReconciliationChannel>('M-Pesa');
  const [accountName, setAccountName] = useState('Paybill 522533 — School Fees');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statementRef, setStatementRef] = useState('');
  const [narration, setNarration] = useState('');
  const [direction, setDirection] = useState<'Credit' | 'Debit'>('Credit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [voidLineTarget, setVoidLineTarget] = useState<{ id: string; ref: string } | null>(null);
  const [voidLineReason, setVoidLineReason] = useState('');
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    let matchedCount = 0;
    let unmatchedCount = 0;
    let discrepancyCount = 0;
    let credits = 0;
    let debits = 0;
    for (const l of lines) {
      if (l.direction === 'Credit') credits += l.amount;
      else debits += l.amount;
      if (l.status === 'Matched') matchedCount += 1;
      else if (l.status === 'Discrepancy') discrepancyCount += 1;
      else unmatchedCount += 1;
    }
    return { matchedCount, unmatchedCount, discrepancyCount, credits, debits };
  }, [lines]);

  const filteredLines = useMemo(
    () =>
      lines.filter(
        (l) =>
          (channelFilter === 'All' || l.channel === channelFilter) &&
          (statusFilter === 'All' || l.status === statusFilter)
      ),
    [lines, channelFilter, statusFilter]
  );

  async function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      const res = await saasApi.importReconciliationLines(tenant.id, [
        {
          channel,
          accountName: accountName.trim(),
          transactionDate: txDate,
          statementRef: statementRef.trim(),
          narration: narration.trim(),
          direction,
          amount: Number(amount),
        },
      ]);
      await onRefresh();
      setStatementRef('');
      setNarration('');
      setAmount('');
      onNotify(
        `Imported statement line (${res.matchedCount > 0 ? 'Matched automatically' : 'Unmatched'}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add statement line', 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadTemplate() {
    const sample = [
      {
        Channel: 'M-Pesa',
        Account: `Paybill ${tenant.mpesaConfig?.paybillNumber || '522533'}`,
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'UBC99MP01A',
        Narration: 'TERM 1 FEE DEPOSIT',
        Direction: 'Credit',
        Amount: tenant.currency === 'KES' ? 15000 : 250,
      },
      {
        Channel: 'Bank',
        Account: tenant.mpesaConfig?.settlementBank || 'KCB Operating A/C',
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'EFT-CAT-4410',
        Narration: 'HIGHLAND FRESH PRODUCE CO',
        Direction: 'Debit',
        Amount: tenant.currency === 'KES' ? 144000 : 1200,
      },
    ];
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'M-Pesa & Bank Statement Import Template',
      sample,
      {
        subtitle: `Keep column headers intact when uploading statements | Currency: ${tenant.currency}`,
        colWidths: [14, 24, 14, 18, 30, 12, 16],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `${tenant.slug}-bank-mpesa-statement-template.xlsx`);
    onNotify('Downloaded M-Pesa / Bank statement Excel template.');
  }

  async function handleImportExcel(file: File | undefined) {
    if (!file || !canManage) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = parseExcelSheetRowsSmart(ws, ['Reference', 'Amount', 'Channel', 'StatementRef']);
      const parsed = rows
        .map((r) => {
          const chRaw = String(r.Channel || r.channel || 'Bank');
          const dirRaw = String(r.Direction || r.direction || 'Credit');
          return {
            channel: (/mpesa|m-pesa/i.test(chRaw) ? 'M-Pesa' : 'Bank') as ReconciliationChannel,
            accountName: String(r.Account || r.accountName || ''),
            transactionDate: String(r.Date || r.transactionDate || ''),
            statementRef: String(r.Reference || r.statementRef || r.Ref || '').trim(),
            narration: String(r.Narration || r.narration || r.Description || '').trim(),
            direction: (/debit|dr|out/i.test(dirRaw) ? 'Debit' : 'Credit') as 'Credit' | 'Debit',
            amount: Number(String(r.Amount || r.amount || '0').replace(/,/g, '')),
          };
        })
        .filter((x) => x.statementRef && Number.isFinite(x.amount) && x.amount > 0);

      if (parsed.length === 0) {
        onNotify('No valid statement rows with Reference and Amount found.', 'error');
        return;
      }
      const res = await saasApi.importReconciliationLines(tenant.id, parsed);
      await onRefresh();
      onNotify(
        `Imported ${res.imported.length} statement lines (${res.matchedCount} matched, ${res.unmatchedCount} unmatched).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Statement import failed', 'error');
    } finally {
      setBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }

  function handleExportReconExcel() {
    if (lines.length === 0) {
      onNotify('No reconciliation lines to export.', 'error');
      return;
    }
    const rows = lines.map((l) => ({
      Channel: l.channel,
      Account: l.accountName,
      Date: l.transactionDate,
      Reference: l.statementRef,
      Narration: l.narration,
      Direction: l.direction,
      Amount: l.amount,
      Status: l.status,
      Matched_Ledger_Record: l.matchedLabel || '',
      Notes: l.notes || '',
    }));
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'Bank & M-Pesa Reconciliation Statement',
      rows,
      {
        subtitle: `${lines.length} statement lines | Currency: ${tenant.currency}`,
        colWidths: [14, 24, 14, 18, 30, 12, 16, 16, 28, 28],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
    XLSX.writeFile(wb, `${tenant.slug}-reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported M-Pesa & Bank Reconciliation to Excel.');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5 text-xs">
          <Smartphone
            className={`h-4 w-4 shrink-0 ${
              tenant.mpesaConfig?.enabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          />
          {tenant.mpesaConfig?.enabled ? (
            <span className="text-slate-700 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-slate-100">M-Pesa Paybill Active:</strong>{' '}
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {tenant.mpesaConfig.paybillNumber}
              </span>{' '}
              ({tenant.mpesaConfig.accountName} · {tenant.mpesaConfig.environment}) — Payments isolated to {tenant.name}.
            </span>
          ) : (
            <span className="text-slate-700 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-slate-100">M-Pesa Paybill Not Configured:</strong>{' '}
              Connect {tenant.name}&apos;s unique Paybill &amp; C2B callback URL under Bank &amp; M-Pesa.
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1 sm:self-auto dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setActiveSection('reconciliation')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === 'reconciliation'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Statement Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('mpesa')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === 'mpesa'
                ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-700 dark:text-emerald-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            M-Pesa Integration
            {tenant.mpesaConfig?.enabled && (
              <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                ({tenant.mpesaConfig.paybillNumber})
              </span>
            )}
          </button>
        </div>
      </div>

      {activeSection === 'mpesa' ? (
        <MpesaIntegrationPanel
          workspace={workspace}
          currentRole={actorRole as UserRole}
          readOnly={!canManage}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Statement Credits</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCurrency(summary.credits, tenant.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Statement Debits</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">
                {formatCurrency(summary.debits, tenant.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Matched Transactions</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {summary.matchedCount} / {lines.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Unmatched / Variance</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {summary.unmatchedCount + summary.discrepancyCount}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Import M-Pesa / Bank Statement
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Upload Excel statements or capture single lines for automatic matching against Fee Receipts &amp; Expenses.
              </p>

              <div className="mt-3 flex flex-wrap gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  Template (.xlsx)
                </button>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleImportExcel(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={!canManage || busy}
                  onClick={() => excelInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Statement
                </button>
              </div>

              <form onSubmit={handleAddLine} className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Channel
                    </label>
                    <select
                      value={channel}
                      onChange={(e) => {
                        const ch = e.target.value as ReconciliationChannel;
                        setChannel(ch);
                        setAccountName(
                          ch === 'M-Pesa' ? 'Paybill 522533 — School Fees' : 'KCB Main Operating A/C'
                        );
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="M-Pesa">M-Pesa</option>
                      <option value="Bank">Bank</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Direction
                    </label>
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as 'Credit' | 'Debit')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="Credit">Credit (Inflow)</option>
                      <option value="Debit">Debit (Outflow)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Statement Ref *
                    </label>
                    <input
                      type="text"
                      required
                      value={statementRef}
                      onChange={(e) => setStatementRef(e.target.value)}
                      placeholder="UBC48KX91P"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Amount ({tenant.currency}) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Narration / Description *
                  </label>
                  <input
                    type="text"
                    required
                    value={narration}
                    onChange={(e) => setNarration(e.target.value)}
                    placeholder="e.g. MPESA FEE DEPOSIT ADM-2601"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Transaction Date
                  </label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canManage || busy}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add &amp; Auto-Match Line
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white xl:col-span-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={channelFilter}
                    onChange={(e) => setChannelFilter(e.target.value as 'All' | ReconciliationChannel)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Channels</option>
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Bank">Bank</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'All' | ReconciliationStatus)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Matched">Matched</option>
                    <option value="Unmatched">Unmatched</option>
                    <option value="Discrepancy">Discrepancy</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canManage || busy}
                    onClick={async () => {
                      const res = await saasApi.autoMatchReconciliation(tenant.id);
                      await onRefresh();
                      onNotify(`Auto-matched ${res.matchedCount} additional statement line(s).`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Auto-Match Ledger
                  </button>
                  <button
                    type="button"
                    onClick={handleExportReconExcel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export Excel
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[740px] text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Date &amp; Channel</th>
                      <th className="px-4 py-3">Ref &amp; Narration</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Ledger Match</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredLines.map((line: ReconciliationLine) => (
                      <tr key={line.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 align-top">
                          <div className="font-mono text-slate-800 dark:text-slate-200">
                            {formatDateShort(line.transactionDate)}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {line.channel} · {line.direction}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {line.statementRef}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {line.narration}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-right align-top font-mono font-bold tabular-nums ${
                            line.direction === 'Credit'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {line.direction === 'Credit' ? '+' : '-'}
                          {formatCurrency(line.amount, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 align-top text-[11px] text-slate-600 dark:text-slate-300">
                          {line.matchedLabel || line.notes || 'Awaiting match'}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              line.status === 'Matched'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : line.status === 'Discrepancy'
                                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            }`}
                          >
                            {line.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          {canManage && (
                            <div className="inline-flex items-center gap-1">
                              {line.status !== 'Matched' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await saasApi.updateReconciliationLine(tenant.id, line.id, {
                                      status: 'Matched',
                                      matchedLabel: 'Manually verified against cashbook',
                                    });
                                    await onRefresh();
                                    onNotify(`Marked ${line.statementRef} as Matched.`);
                                  }}
                                  className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                >
                                  Reconcile
                                </button>
                              )}
                              {line.status !== 'Discrepancy' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await saasApi.updateReconciliationLine(tenant.id, line.id, {
                                      status: 'Discrepancy',
                                      notes: 'Flagged for bank/M-Pesa investigation',
                                    });
                                    await onRefresh();
                                    onNotify(`Flagged ${line.statementRef} as Discrepancy.`);
                                  }}
                                  className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                >
                                  Flag
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidLineReason('');
                                  setVoidLineTarget({ id: line.id, ref: line.statementRef });
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                title="Void statement line"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {voidLineTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!voidLineReason.trim()) {
                onNotify('Please provide a reason to void this statement line.', 'error');
                return;
              }
              setBusy(true);
              try {
                await saasApi.deleteReconciliationLine(
                  tenant.id,
                  voidLineTarget.id,
                  voidLineReason.trim()
                );
                await onRefresh();
                onNotify(`Voided statement line ${voidLineTarget.ref}.`);
                setVoidLineTarget(null);
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Unable to void line', 'error');
              } finally {
                setBusy(false);
              }
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Void Reconciliation Line
            </h3>
            <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
              Ref: {voidLineTarget.ref}
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Void Reason *
              </label>
              <textarea
                rows={3}
                required
                value={voidLineReason}
                onChange={(e) => setVoidLineReason(e.target.value)}
                placeholder="e.g. Duplicate bank statement import row"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidLineTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
