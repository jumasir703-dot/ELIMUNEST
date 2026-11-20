import type { FormEvent } from 'react';
import { formatCurrency } from '../../lib/format';
import type {
  CurrencyCode,
  FeeInvoice,
  FeeWaiverKind,
  FeeWaiverMode,
  IndependentVotelineItem,
  PaymentRecord,
  Student,
} from '../../shared/types';

export interface WaiverFormState {
  studentId: string;
  kind: FeeWaiverKind;
  mode: FeeWaiverMode;
  value: string;
  term: string;
  reason: string;
}

export interface SiblingFormState {
  enabled: boolean;
  percentage: string;
  minSiblings: string;
}

export interface CarryForwardFormState {
  fromTerm: string;
  toTerm: string;
  dueDate: string;
}

interface FeeAdjustmentsModalsProps {
  currency: CurrencyCode;
  students: Student[];
  saving: boolean;

  voidPaymentTarget: { invoice: FeeInvoice; payment: PaymentRecord } | null;
  voidPaymentReason: string;
  setVoidPaymentReason: (val: string) => void;
  onCloseVoidPayment: () => void;
  onSubmitVoidPayment: (e: FormEvent) => void;

  creditNoteModalInvoice: FeeInvoice | null;
  creditNoteAmount: string;
  setCreditNoteAmount: (val: string) => void;
  creditNoteReason: string;
  setCreditNoteReason: (val: string) => void;
  onCloseCreditNote: () => void;
  onSubmitCreditNote: (e: FormEvent) => void;

  waiverModalOpen: boolean;
  waiverForm: WaiverFormState;
  setWaiverForm: (val: WaiverFormState) => void;
  onCloseWaiver: () => void;
  onSubmitWaiver: (e: FormEvent) => void;

  siblingModalOpen: boolean;
  siblingForm: SiblingFormState;
  setSiblingForm: (val: SiblingFormState) => void;
  onCloseSibling: () => void;
  onSubmitSibling: (e: FormEvent) => void;

  carryForwardModalOpen: boolean;
  carryForwardForm: CarryForwardFormState;
  setCarryForwardForm: (val: CarryForwardFormState) => void;
  onCloseCarryForward: () => void;
  onSubmitCarryForward: (e: FormEvent) => void;

  ivlVoidTarget: IndependentVotelineItem | null;
  ivlVoidReason: string;
  setIvlVoidReason: (val: string) => void;
  onCloseIvlVoid: () => void;
  onSubmitIvlVoid: (e: FormEvent) => void;
}

export function FeeAdjustmentsModals({
  currency,
  students,
  saving,
  voidPaymentTarget,
  voidPaymentReason,
  setVoidPaymentReason,
  onCloseVoidPayment,
  onSubmitVoidPayment,
  creditNoteModalInvoice,
  creditNoteAmount,
  setCreditNoteAmount,
  creditNoteReason,
  setCreditNoteReason,
  onCloseCreditNote,
  onSubmitCreditNote,
  waiverModalOpen,
  waiverForm,
  setWaiverForm,
  onCloseWaiver,
  onSubmitWaiver,
  siblingModalOpen,
  siblingForm,
  setSiblingForm,
  onCloseSibling,
  onSubmitSibling,
  carryForwardModalOpen,
  carryForwardForm,
  setCarryForwardForm,
  onCloseCarryForward,
  onSubmitCarryForward,
  ivlVoidTarget,
  ivlVoidReason,
  setIvlVoidReason,
  onCloseIvlVoid,
  onSubmitIvlVoid,
}: FeeAdjustmentsModalsProps) {
  return (
    <>
      {voidPaymentTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitVoidPayment}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Void Fee Payment &amp; Create Reversal
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {voidPaymentTarget.payment.receiptNumber} ·{' '}
              {formatCurrency(voidPaymentTarget.payment.amount, currency)} for{' '}
              {voidPaymentTarget.invoice.studentName}
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Mandatory Void Reason *
              </label>
              <textarea
                rows={3}
                required
                value={voidPaymentReason}
                onChange={(e) => setVoidPaymentReason(e.target.value)}
                placeholder="e.g. Posted to wrong learner admission number or bounced cheque"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseVoidPayment}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {saving ? 'Voiding...' : 'Void & Reverse Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {creditNoteModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitCreditNote}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Issue Fee Credit Note
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {creditNoteModalInvoice.invoiceNumber} · {creditNoteModalInvoice.studentName} (Bal:{' '}
              {formatCurrency(creditNoteModalInvoice.balance, currency)})
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Credit Note Amount ({currency}) *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={creditNoteAmount}
                  onChange={(e) => setCreditNoteAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Reason *
                </label>
                <textarea
                  rows={2}
                  required
                  value={creditNoteReason}
                  onChange={(e) => setCreditNoteReason(e.target.value)}
                  placeholder="e.g. Boarding fee adjustment after switching to day scholar"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseCreditNote}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Issuing...' : 'Issue Credit Note'}
              </button>
            </div>
          </form>
        </div>
      )}

      {waiverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitWaiver}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Apply Fee Waiver / Bursary / Scholarship
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Student *
                </label>
                <select
                  value={waiverForm.studentId}
                  onChange={(e) => setWaiverForm({ ...waiverForm, studentId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.fullName} ({st.studentCode} · {st.grade})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Category
                </label>
                <select
                  value={waiverForm.kind}
                  onChange={(e) =>
                    setWaiverForm({ ...waiverForm, kind: e.target.value as FeeWaiverKind })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Bursary">Bursary</option>
                  <option value="Scholarship">Scholarship</option>
                  <option value="Waiver">Fee Waiver</option>
                  <option value="Sibling Discount">Sibling Discount</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Calculation Mode
                </label>
                <select
                  value={waiverForm.mode}
                  onChange={(e) =>
                    setWaiverForm({ ...waiverForm, mode: e.target.value as FeeWaiverMode })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Percentage">Percentage (%)</option>
                  <option value="Fixed">Fixed ({currency})</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {waiverForm.mode === 'Percentage' ? 'Percentage (%)' : `Amount (${currency})`} *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={waiverForm.value}
                  onChange={(e) => setWaiverForm({ ...waiverForm, value: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Term
                </label>
                <input
                  type="text"
                  value={waiverForm.term}
                  onChange={(e) => setWaiverForm({ ...waiverForm, term: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Authorization / Reason *
                </label>
                <textarea
                  rows={2}
                  required
                  value={waiverForm.reason}
                  onChange={(e) => setWaiverForm({ ...waiverForm, reason: e.target.value })}
                  placeholder="e.g. NG-CDF Bursary Cheque #4419 or BOM Merit Scholarship"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseWaiver}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Applying...' : 'Apply Waiver / Bursary'}
              </button>
            </div>
          </form>
        </div>
      )}

      {siblingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitSibling}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Sibling Discount Policy
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Automatically applies when generating new invoices for guardians with multiple enrolled learners.
            </p>
            <div className="mt-4 space-y-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={siblingForm.enabled}
                  onChange={(e) => setSiblingForm({ ...siblingForm, enabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                Enable automatic sibling discount
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Discount Percentage (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={siblingForm.percentage}
                    onChange={(e) =>
                      setSiblingForm({ ...siblingForm, percentage: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Minimum Siblings
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={siblingForm.minSiblings}
                    onChange={(e) =>
                      setSiblingForm({ ...siblingForm, minSiblings: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseSibling}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Rule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {carryForwardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitCarryForward}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Carry Forward Term Balances &amp; Credits
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Rolls unpaid arrears and unapplied student credit balances into new term invoices based on configured Fee Structures.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  From Term
                </label>
                <input
                  type="text"
                  value={carryForwardForm.fromTerm}
                  onChange={(e) =>
                    setCarryForwardForm({ ...carryForwardForm, fromTerm: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  To Term *
                </label>
                <input
                  type="text"
                  required
                  value={carryForwardForm.toTerm}
                  onChange={(e) =>
                    setCarryForwardForm({ ...carryForwardForm, toTerm: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  New Term Due Date
                </label>
                <input
                  type="date"
                  value={carryForwardForm.dueDate}
                  onChange={(e) =>
                    setCarryForwardForm({ ...carryForwardForm, dueDate: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseCarryForward}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? 'Processing...' : 'Run Carry-Forward'}
              </button>
            </div>
          </form>
        </div>
      )}

      {ivlVoidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={onSubmitIvlVoid}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Void Independent Voteline
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {ivlVoidTarget.name} · {ivlVoidTarget.studentName} (
              {formatCurrency(ivlVoidTarget.amount, currency)})
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Void Reason *
              </label>
              <textarea
                rows={3}
                required
                value={ivlVoidReason}
                onChange={(e) => setIvlVoidReason(e.target.value)}
                placeholder="e.g. Student withdrew from optional school transport"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCloseIvlVoid}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {saving ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
