import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  Search,
  Send,
  Smartphone,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatCurrency, formatDateShort } from '../lib/format';
import type {
  MpesaEnvironment,
  TenantWorkspaceData,
  UserRole,
} from '../shared/types';

interface MpesaIntegrationPanelProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

export function MpesaIntegrationPanel({
  workspace,
  currentRole,
  onRefresh,
  onNotify,
}: MpesaIntegrationPanelProps) {
  const { tenant, invoices } = workspace;
  const transactions = workspace.mpesaTransactions || [];
  const canConfigure =
    currentRole === 'Admin' ||
    currentRole === 'Super Admin' ||
    currentRole === 'Developer' ||
    currentRole === 'Bursar';

  const existing = tenant.mpesaConfig;
  const openInvoices = useMemo(
    () => invoices.filter((inv) => inv.balance > 0),
    [invoices]
  );

  // Configuration form state
  const [enabled, setEnabled] = useState<boolean>(existing ? existing.enabled : true);
  const [environment, setEnvironment] = useState<MpesaEnvironment>(
    existing?.environment || 'Sandbox'
  );
  const [paybillNumber, setPaybillNumber] = useState<string>(existing?.paybillNumber || '');
  const [accountName, setAccountName] = useState<string>(
    existing?.accountName || `${tenant.name} Fees`
  );
  const [accountReferenceFormat, setAccountReferenceFormat] = useState<string>(
    existing?.accountReferenceFormat || 'Student Code (e.g. ADM-2601)'
  );
  const [settlementBank, setSettlementBank] = useState<string>(existing?.settlementBank || '');
  const [revealedWebhookUrl, setRevealedWebhookUrl] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Live Paybill Payment Settlement / Isolation Tester state
  const [testPaybill, setTestPaybill] = useState<string>(existing?.paybillNumber || '');
  const [testAccountRef, setTestAccountRef] = useState<string>(
    openInvoices[0]?.studentCode || ''
  );
  const [testMsisdn, setTestMsisdn] = useState<string>('254712345678');
  const [testAmount, setTestAmount] = useState<string>(
    openInvoices[0] ? String(Math.min(10000, openInvoices[0].balance)) : '5000'
  );
  const [testReceipt, setTestReceipt] = useState<string>('');
  const [postingPayment, setPostingPayment] = useState(false);
  const [paymentFeedback, setPaymentFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  // Ledger filter state
  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState<
    'All' | 'Settled' | 'Rejected' | 'Duplicate' | 'Unverified'
  >('All');

  useEffect(() => {
    const cfg = tenant.mpesaConfig;
    setEnabled(cfg ? cfg.enabled : true);
    setEnvironment(cfg?.environment || 'Sandbox');
    setPaybillNumber(cfg?.paybillNumber || '');
    setAccountName(cfg?.accountName || `${tenant.name} Fees`);
    setAccountReferenceFormat(cfg?.accountReferenceFormat || 'Student Code (e.g. ADM-2601)');
    setSettlementBank(cfg?.settlementBank || '');
    setRevealedWebhookUrl(null);
    setConfigError(null);
    setTestPaybill(cfg?.paybillNumber || '');
  }, [tenant.id, tenant.name, tenant.mpesaConfig]);

  useEffect(() => {
    if (!testAccountRef && openInvoices[0]) {
      setTestAccountRef(openInvoices[0].studentCode);
      setTestAmount(String(Math.min(10000, openInvoices[0].balance)));
    }
  }, [openInvoices, testAccountRef]);

  const cleanPaybillPreview = paybillNumber.replace(/\s+/g, '').trim() || '<PAYBILL>';
  const callbackPath =
    revealedWebhookUrl ||
    existing?.callbackUrl ||
    '/api/mpesa/c2b-callback/<generated-after-save>';
  const fullCallbackUrl =
    typeof window !== 'undefined' && callbackPath.startsWith('/')
      ? `${window.location.origin}${callbackPath}`
      : callbackPath;

  const filteredTransactions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (txStatusFilter !== 'All' && tx.status !== txStatusFilter) return false;
      if (!q) return true;
      return (
        tx.mpesaReceipt.toLowerCase().includes(q) ||
        tx.paybillNumber.toLowerCase().includes(q) ||
        tx.accountReference.toLowerCase().includes(q) ||
        (tx.studentName || '').toLowerCase().includes(q) ||
        (tx.invoiceNumber || '').toLowerCase().includes(q) ||
        tx.msisdn.toLowerCase().includes(q)
      );
    });
  }, [transactions, txSearch, txStatusFilter]);

  const settledTotal = useMemo(
    () =>
      transactions
        .filter((tx) => tx.status === 'Settled')
        .reduce((sum, tx) => sum + tx.amount, 0),
    [transactions]
  );

  async function handleCopyCallbackUrl() {
    try {
      await navigator.clipboard.writeText(fullCallbackUrl);
      onNotify('M-Pesa C2B callback URL copied to clipboard.');
    } catch {
      onNotify('Unable to copy automatically. Copy the callback URL manually.', 'error');
    }
  }

  async function saveConfigWithOptions(regenerateSecret = false) {
    if (!canConfigure) {
      onNotify('Only School Admin or Bursar accounts can save M-Pesa settings.', 'error');
      return;
    }
    setConfigError(null);
    setSavingConfig(true);
    try {
      const res = await saasApi.saveMpesaConfig(tenant.id, {
        enabled,
        environment,
        paybillNumber: paybillNumber.trim(),
        accountName: accountName.trim(),
        accountReferenceFormat: accountReferenceFormat.trim(),
        settlementBank: settlementBank.trim() || undefined,
        regenerateSecret,
      });
      if (res.webhookCallbackUrl) {
        setRevealedWebhookUrl(res.webhookCallbackUrl);
      }
      setTestPaybill(res.mpesaConfig.paybillNumber);
      await onRefresh();
      onNotify(
        regenerateSecret
          ? `Rotated M-Pesa webhook secret for Paybill ${res.mpesaConfig.paybillNumber}. Copy the new callback URL now.`
          : `M-Pesa Paybill ${res.mpesaConfig.paybillNumber} saved for ${tenant.name} (${res.mpesaConfig.environment}).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save M-Pesa integration';
      setConfigError(msg);
      onNotify(msg, 'error');
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    await saveConfigWithOptions(false);
  }

  async function handleReceiveTestPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfigure) {
      onNotify('Only School Admin or Bursar accounts can log manual M-Pesa entries.', 'error');
      return;
    }
    setPaymentFeedback(null);
    const numericAmount = Number(testAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setPaymentFeedback({ tone: 'error', message: 'Enter a valid positive payment amount.' });
      return;
    }

    setPostingPayment(true);
    try {
      const res = await saasApi.receiveMpesaPaybillPayment(tenant.id, {
        paybillNumber: testPaybill.trim(),
        accountReference: testAccountRef.trim(),
        amount: numericAmount,
        msisdn: testMsisdn.trim(),
        mpesaReceipt: testReceipt.trim() || undefined,
      });
      setTestReceipt('');
      await onRefresh();
      const msg = `Recorded manual M-Pesa entry (${res.status}) for ${formatCurrency(
        res.transaction.amount,
        tenant.currency
      )} via Paybill ${res.paybillNumber}. Receipt: ${res.transaction.mpesaReceipt}. Match this entry in Reconciliation before applying to a student invoice.`;
      setPaymentFeedback({ tone: 'success', message: msg });
      onNotify(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Manual M-Pesa entry failed';
      setPaymentFeedback({ tone: 'error', message: msg });
      onNotify(msg, 'error');
      await onRefresh();
    } finally {
      setPostingPayment(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Tenant Isolation Overview Strip */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                M-Pesa Paybill Integration — {tenant.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  existing?.enabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300'
                }`}
              >
                {existing?.enabled
                  ? `ACTIVE · PAYBILL ${existing.paybillNumber}`
                  : existing
                  ? `DISABLED · PAYBILL ${existing.paybillNumber}`
                  : 'NOT CONFIGURED'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Each onboarded school registers a globally unique M-Pesa Paybill shortcode. Incoming Safaricom Daraja C2B &amp; STK Push payments are routed exclusively to this school&apos;s student ledger using the Paybill as the tenant differentiator.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-slate-100 pt-3 lg:border-t-0 lg:pt-0 dark:border-slate-800">
          <div className="text-left lg:text-right">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Settled via Paybill
            </span>
            <span className="font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatCurrency(settledTotal, tenant.currency)}
            </span>
          </div>
        </div>
      </div>

      {!canConfigure && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
          Viewing in read-only mode as <span className="font-semibold">{currentRole}</span>. Only School Admin or Bursar accounts can configure Paybill numbers or rotate webhook secrets.
        </div>
      )}

      {/* Configuration & Live Paybill Routing Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left 7 Cols: Paybill & Webhook Configuration Form */}
        <form
          onSubmit={handleSaveConfig}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 xl:col-span-7 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                School Paybill &amp; C2B Webhook Settings
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Configure your school&apos;s Paybill shortcode, account format, and tenant-scoped C2B webhook URL.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={enabled}
                disabled={!canConfigure}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-emerald-600"
              />
              <span>{enabled ? 'Integration Enabled' : 'Integration Disabled'}</span>
            </label>
          </div>

          {configError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{configError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Paybill Number (Unique Business Shortcode) *
              </label>
              <input
                required
                type="text"
                inputMode="numeric"
                pattern="[0-9]{5,8}"
                disabled={!canConfigure}
                value={paybillNumber}
                onChange={(e) => {
                  setPaybillNumber(e.target.value);
                  setConfigError(null);
                }}
                placeholder="e.g. 522533"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                5–8 digits. Enforced unique across all schools on the platform.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Daraja API Environment *
              </label>
              <select
                disabled={!canConfigure}
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as MpesaEnvironment)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="Sandbox">Sandbox (Testing / UAT)</option>
                <option value="Production">Production (Live Paybill)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Paybill Account Display Name *
              </label>
              <input
                required
                type="text"
                disabled={!canConfigure}
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder={`${tenant.name} Fees`}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Account Reference Format
              </label>
              <input
                type="text"
                disabled={!canConfigure}
                value={accountReferenceFormat}
                onChange={(e) => setAccountReferenceFormat(e.target.value)}
                placeholder="Student Code (e.g. ADM-2601)"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Settlement Bank / Collection Account (Optional)
              </label>
              <input
                type="text"
                disabled={!canConfigure}
                value={settlementBank}
                onChange={(e) => setSettlementBank(e.target.value)}
                placeholder="e.g. KCB School Fee Collection A/C 1104829104"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Tenant-Scoped Secret Callback URL */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Authenticated C2B Confirmation Callback URL
              </span>
              <div className="flex items-center gap-1.5">
                {canConfigure && existing?.hasWebhookSecret && (
                  <button
                    type="button"
                    disabled={savingConfig}
                    onClick={() => saveConfigWithOptions(true)}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Rotate Secret
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyCallbackUrl}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Copy className="h-3 w-3" />
                  Copy URL
                </button>
              </div>
            </div>
            <p className="mt-1.5 break-all font-mono text-[11px] text-slate-600 dark:text-slate-400">
              {fullCallbackUrl}
            </p>
            {revealedWebhookUrl ? (
              <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
                Secret token shown once — copy and register this full URL in Safaricom Daraja C2B now. Only a masked path is displayed after reload.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Each tenant uses a unique hashed callback secret. Duplicate <code className="font-mono">TransID</code> payloads are automatically de-duplicated.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {existing?.updatedAt
                ? `Last updated ${formatDateShort(existing.updatedAt)} by ${existing.updatedBy || 'Admin'}`
                : 'Not yet linked to a Paybill shortcode'}
            </div>
            <button
              type="submit"
              disabled={!canConfigure || savingConfig}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {savingConfig ? 'Saving Paybill Integration...' : 'Save M-Pesa Integration'}
            </button>
          </div>
        </form>

        {/* Right 5 Cols: Parent Instructions & Paybill-Separated Payment Terminal */}
        <div className="space-y-5 xl:col-span-5">
          {/* Parent Payment Instructions Preview */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Guardian Payment Slip &amp; Routing Key
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Automatically embedded into Fee Reminders &amp; Official Fee Receipts when active.
            </p>

            <div className="mt-3.5 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/70 text-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-slate-500 dark:text-slate-400">School Tenant</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {tenant.name}
                </span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-slate-500 dark:text-slate-400">M-Pesa Paybill</span>
                <span className="font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {cleanPaybillPreview}
                </span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-slate-500 dark:text-slate-400">Account Number</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {openInvoices[0]?.studentCode || 'Student Code'}
                </span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-slate-500 dark:text-slate-400">Paybill Account Name</span>
                <span className="truncate pl-4 font-medium text-slate-800 dark:text-slate-200">
                  {accountName || `${tenant.name} Fees`}
                </span>
              </div>
            </div>
          </div>

          {/* Manual M-Pesa Entry (Unverified until Reconciliation) */}
          <form
            onSubmit={handleReceiveTestPayment}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Manual M-Pesa Entry (Unverified)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Record a manual M-Pesa confirmation slip for {tenant.name}. Entries stay marked as <span className="font-semibold">Unverified</span> until matched on the Bank &amp; M-Pesa Reconciliation screen.
              </p>
            </div>

            {paymentFeedback && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  paymentFeedback.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300'
                }`}
              >
                {paymentFeedback.message}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Target Paybill Shortcode *
                </label>
                <input
                  required
                  type="text"
                  value={testPaybill}
                  onChange={(e) => setTestPaybill(e.target.value)}
                  placeholder="e.g. 522522"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Amount ({tenant.currency}) *
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  value={testAmount}
                  onChange={(e) => setTestAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Account Reference (Student Code or Invoice #) *
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  required
                  type="text"
                  value={testAccountRef}
                  onChange={(e) => setTestAccountRef(e.target.value)}
                  placeholder="e.g. ADM-2601"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {openInvoices.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const inv = openInvoices.find((i) => i.id === e.target.value);
                      if (inv) {
                        setTestAccountRef(inv.studentCode);
                        setTestAmount(String(inv.balance));
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">Pick open student...</option>
                    {openInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.studentCode} · {inv.studentName} (Bal:{' '}
                        {formatCurrency(inv.balance, tenant.currency)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Payer Phone (MSISDN)
                </label>
                <input
                  type="text"
                  value={testMsisdn}
                  onChange={(e) => setTestMsisdn(e.target.value)}
                  placeholder="254712345678"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  M-Pesa Receipt Code (Optional)
                </label>
                <input
                  type="text"
                  value={testReceipt}
                  onChange={(e) => setTestReceipt(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canConfigure || postingPayment}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {postingPayment ? 'Logging Unverified Entry...' : 'Log Manual M-Pesa Entry'}
            </button>
          </form>
        </div>
      </div>

      {/* Tenant-Isolated M-Pesa Paybill Transactions Ledger */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              M-Pesa Paybill Settlement Log ({transactions.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Transactions routed strictly to {tenant.name} via Paybill {existing?.paybillNumber || '—'}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['All', 'Settled', 'Unverified', 'Duplicate', 'Rejected'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setTxStatusFilter(status)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    txStatusFilter === status
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Search receipt, student, MSISDN..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Date &amp; Receipt</th>
                <th className="px-4 py-3">Paybill</th>
                <th className="px-4 py-3">Account Ref &amp; Student</th>
                <th className="px-4 py-3">Payer MSISDN</th>
                <th className="px-4 py-3">Channel &amp; Note</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    {transactions.length === 0
                      ? 'No M-Pesa Paybill transactions received for this school yet. Configure your Paybill above and post or receive a C2B payment.'
                      : 'No M-Pesa transactions match the active filter.'}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {tx.mpesaReceipt}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {formatDateShort(tx.receivedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                      {tx.paybillNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {tx.studentName || 'Unmatched Reference'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        Acct: {tx.accountReference}
                        {tx.invoiceNumber ? ` · ${tx.invoiceNumber}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums dark:text-slate-400">
                      {tx.msisdn}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700 dark:text-slate-300">
                        {tx.channel}
                      </div>
                      {tx.note && (
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {tx.note}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(tx.amount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-semibold ${
                          tx.status === 'Settled'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : tx.status === 'Unverified' || tx.status === 'Duplicate'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
