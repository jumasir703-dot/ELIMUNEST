import {
  Copy,
  Download,
  FileSpreadsheet,
  MessageCircle,
  Plus,
  Printer,
  X,
} from 'lucide-react';
import { TenantDocumentHeader } from '../TenantDocumentHeader';
import { formatCurrency } from '../../lib/format';
import {
  getStructureVotelines,
  summarizeIndependentVotelinesForStructure,
} from '../../lib/feesHelpers';
import { downloadFeeStructurePdf } from '../../lib/pdfDocuments';
import type {
  FeeStructure,
  IndependentVotelineItem,
  Tenant,
} from '../../shared/types';

interface PrintableFeeStructureModalProps {
  tenant: Tenant;
  structure: FeeStructure;
  independentVotelines: IndependentVotelineItem[];
  copiedStructureId: string | null;
  onClose: () => void;
  onExportExcel: (fs: FeeStructure) => void;
  onCopyText: (fs: FeeStructure) => void;
  buildWhatsAppHref: (fs: FeeStructure) => string;
  onAddIndependentVoteline: (fs: FeeStructure) => void;
  onNotify?: (title: string, tone?: 'success' | 'error') => void;
}

export function PrintableFeeStructureModal({
  tenant,
  structure,
  independentVotelines,
  copiedStructureId,
  onClose,
  onExportExcel,
  onCopyText,
  buildWhatsAppHref,
  onAddIndependentVoteline,
  onNotify,
}: PrintableFeeStructureModalProps) {
  const modalLines = getStructureVotelines(structure);
  const independentSummary = summarizeIndependentVotelinesForStructure(
    structure,
    independentVotelines
  );

  async function handleDownloadPdf() {
    try {
      const fileName = await downloadFeeStructurePdf(
        tenant,
        structure,
        independentVotelines
      );
      onNotify?.(`Downloaded Fee Structure PDF (${fileName}).`);
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Unable to generate Fee Structure PDF',
        'error'
      );
    }
  }

  return (
    <div className="print-modal-root fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
      <div className="print-modal-sheet my-6 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={() => onExportExcel(structure)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Download Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => onCopyText(structure)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              {copiedStructureId === structure.id ? 'Copied' : 'Copy Text'}
            </button>
            <a
              href={buildWhatsAppHref(structure)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Share WhatsApp
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close fee structure preview"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <TenantDocumentHeader
          tenant={tenant}
          documentTitle="Official Fee Structure"
          subtitle={`${structure.grade} · ${structure.term}`}
          rightMeta={[
            { label: 'Academic Year', value: tenant.academicYear },
            { label: 'Currency', value: tenant.currency },
          ]}
        />

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-10 px-3.5 py-2.5">#</th>
                <th className="px-3.5 py-2.5">Votehead / Voteline Description</th>
                <th className="px-3.5 py-2.5 text-right">
                  Amount ({tenant.currency})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {modalLines.map((line, idx) => (
                <tr key={line.id}>
                  <td className="px-3.5 py-2 font-mono text-slate-400 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-3.5 py-2 font-medium text-slate-900 dark:text-slate-100">
                    {line.name}
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatCurrency(line.amount, tenant.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50/80 font-bold dark:border-slate-800 dark:bg-slate-800/60">
              <tr>
                <td colSpan={2} className="px-3.5 py-3 text-slate-900 dark:text-slate-100">
                  Total Term Fee ({structure.grade} · {structure.term})
                </td>
                <td className="px-3.5 py-3 text-right font-mono text-sm text-blue-700 tabular-nums dark:text-blue-400">
                  {formatCurrency(structure.totalFee, tenant.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-5 break-inside-avoid">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Independent / Auxiliary Votelines (Separate from Main Fee Structure)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Optional or route-specific charges (e.g. Transport Fee, Academic Trip Fee) billed separately with an independent subtotal.
              </p>
            </div>
            {independentSummary.lines.length === 0 && (
              <button
                type="button"
                onClick={() => onAddIndependentVoteline(structure)}
                className="no-print inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
              >
                <Plus className="h-3 w-3" />
                Add Independent Voteline
              </button>
            )}
          </div>

          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="w-10 px-3.5 py-2">#</th>
                  <th className="px-3.5 py-2">Independent Voteline</th>
                  <th className="px-3.5 py-2">Scope / Description</th>
                  <th className="px-3.5 py-2 text-right">
                    Amount ({tenant.currency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {independentSummary.lines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3.5 py-3 text-center text-[11px] text-slate-500 dark:text-slate-400"
                    >
                      No independent votelines assigned for {structure.grade} ({structure.term}).
                    </td>
                  </tr>
                ) : (
                  independentSummary.lines.map((item, idx) => (
                    <tr key={item.key}>
                      <td className="px-3.5 py-2 font-mono text-slate-400 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-3.5 py-2 font-medium text-slate-900 dark:text-slate-100">
                        {item.name}
                      </td>
                      <td className="px-3.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {item.note ||
                          `${item.learnerCount} ${
                            item.learnerCount === 1 ? 'learner' : 'learners'
                          } assigned`}
                      </td>
                      <td className="px-3.5 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {formatCurrency(item.unitAmount, tenant.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50/80 font-bold dark:border-slate-800 dark:bg-slate-800/60">
                <tr>
                  <td colSpan={3} className="px-3.5 py-2.5 text-slate-900 dark:text-slate-100">
                    Independent Votelines Total (Separate · Excluded from Main Fee Structure)
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-sm text-emerald-700 tabular-nums dark:text-emerald-400">
                    {formatCurrency(
                      independentSummary.separateScheduleTotal,
                      tenant.currency
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Main Fee Structure Total
              </span>
              <span className="mt-0.5 block font-mono text-sm font-bold text-blue-700 tabular-nums dark:text-blue-400">
                {formatCurrency(structure.totalFee, tenant.currency)}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Independent Votelines Total (Separate)
              </span>
              <span className="mt-0.5 block font-mono text-sm font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                {formatCurrency(
                  independentSummary.separateScheduleTotal,
                  tenant.currency
                )}
              </span>
            </div>
          </div>
        </div>

        {tenant.mpesaConfig?.enabled && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Settlement Instructions
            </p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              Lipa na M-Pesa Paybill:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {tenant.mpesaConfig.paybillNumber}
              </strong>{' '}
              ({tenant.mpesaConfig.accountName}) · Account Number:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                Learner Admission Code
              </strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
