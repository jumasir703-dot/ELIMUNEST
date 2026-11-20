import { useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { Download, FileText, Plus, RotateCcw, Trash2, Users, X } from 'lucide-react';
import {
  createBrandedWorksheetFromObjects,
  loadLogoPngDataUrl,
  resolveTenantDocumentMeta,
} from '../../lib/documentBranding';
import { saasApi } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import type { PayrollEntry, PayrollStatus } from '../../shared/types';
import type { FinanceControlPanelProps } from './types';

export function PayrollDeductionsPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: FinanceControlPanelProps) {
  const { tenant } = workspace;
  const payrollEntries = workspace.payrollEntries || [];
  const statutorySchedules = workspace.statutoryRateSchedules || [];

  const [payPeriod, setPayPeriod] = useState('2026-11');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [staffName, setStaffName] = useState('');
  const [staffCategory, setStaffCategory] = useState<'Teaching' | 'Non-Teaching'>('Teaching');
  const [designation, setDesignation] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [allowances, setAllowances] = useState('0');
  const [saccoOrLoan, setSaccoOrLoan] = useState('0');
  const [saving, setSaving] = useState(false);
  const [actionModal, setActionModal] = useState<{
    mode: 'void' | 'reverse';
    entry: PayrollEntry;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');

  const activeSchedule = useMemo(() => {
    const periodDate = `${payPeriod}-01`;
    const sorted = [...statutorySchedules].sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom)
    );
    return sorted.find((s) => s.effectiveFrom <= periodDate) || sorted[0] || null;
  }, [statutorySchedules, payPeriod]);

  const scopedEntries = useMemo(
    () => payrollEntries.filter((p) => p.payPeriod === payPeriod && !p.voided),
    [payrollEntries, payPeriod]
  );

  const totals = useMemo(
    () =>
      scopedEntries
        .filter((p) => !p.reversed)
        .reduce(
          (acc, p) => {
            const empNssf = p.employerNssf ?? p.nssf;
            const empHousing = p.employerHousingLevy ?? p.housingLevy;
            const empNita = p.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
            const empCost = p.totalEmployerCost ?? p.grossPay + empNssf + empHousing + empNita;
            acc.gross += p.grossPay;
            acc.paye += p.paye;
            acc.nssf += p.nssf;
            acc.shif += p.shif;
            acc.housing += p.housingLevy;
            acc.sacco += p.saccoOrLoan;
            acc.deductions += p.totalDeductions;
            acc.net += p.netPay;
            acc.employerNssf += empNssf;
            acc.employerHousing += empHousing;
            acc.employerNita += empNita;
            acc.totalEmployerCost += empCost;
            return acc;
          },
          {
            gross: 0,
            paye: 0,
            nssf: 0,
            shif: 0,
            housing: 0,
            sacco: 0,
            deductions: 0,
            net: 0,
            employerNssf: 0,
            employerHousing: 0,
            employerNita: 0,
            totalEmployerCost: 0,
          }
        ),
    [scopedEntries, activeSchedule]
  );

  function openEditModal(entry?: PayrollEntry) {
    if (entry && (entry.status === 'Disbursed' || entry.reversed)) {
      onNotify('Disbursed or reversed payroll entries cannot be edited. Use Reverse if needed.', 'error');
      return;
    }
    if (entry) {
      setEditingId(entry.id);
      setStaffName(entry.staffName);
      setStaffCategory(entry.staffCategory);
      setDesignation(entry.designation);
      setBasicSalary(String(entry.basicSalary));
      setAllowances(String(entry.allowances));
      setSaccoOrLoan(String(entry.saccoOrLoan));
    } else {
      setEditingId(undefined);
      setStaffName('');
      setStaffCategory('Teaching');
      setDesignation('');
      setBasicSalary('');
      setAllowances('0');
      setSaccoOrLoan('0');
    }
    setModalOpen(true);
  }

  async function handleSaveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      await saasApi.upsertPayrollEntry(tenant.id, {
        id: editingId,
        payPeriod,
        staffName: staffName.trim(),
        staffCategory,
        designation: designation.trim() || 'Staff',
        basicSalary: Number(basicSalary),
        allowances: Number(allowances || 0),
        saccoOrLoan: Number(saccoOrLoan || 0),
        autoComputeStatutory: true,
        status: 'Draft',
      });
      await onRefresh();
      setModalOpen(false);
      onNotify(`Saved payroll entry as Draft for ${staffName.trim()}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save payroll entry', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleExportPayrollExcel() {
    if (scopedEntries.length === 0) {
      onNotify('No payroll entries in this period to export.', 'error');
      return;
    }
    const wb = XLSX.utils.book_new();
    const masterRows = scopedEntries.map((p) => {
      const empNssf = p.employerNssf ?? p.nssf;
      const empHousing = p.employerHousingLevy ?? p.housingLevy;
      const empNita = p.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
      const empCost = p.totalEmployerCost ?? p.grossPay + empNssf + empHousing + empNita;
      return {
        Period: p.payPeriod,
        Staff_Name: p.staffName,
        Category: p.staffCategory,
        Designation: p.designation,
        Basic_Salary: p.basicSalary,
        Allowances: p.allowances,
        Gross_Pay: p.grossPay,
        PAYE: p.paye,
        Employee_NSSF: p.nssf,
        SHIF: p.shif,
        Employee_Housing_Levy: p.housingLevy,
        SACCO_Loan: p.saccoOrLoan,
        Total_Deductions: p.totalDeductions,
        Net_Pay: p.netPay,
        Employer_NSSF: empNssf,
        Employer_Housing_Levy: empHousing,
        NITA_Levy: empNita,
        Total_Employer_Cost: empCost,
        Status: p.reversed ? 'Reversed' : p.status,
      };
    });
    const statutoryRows = scopedEntries
      .filter((p) => !p.reversed)
      .map((p) => {
        const empNssf = p.employerNssf ?? p.nssf;
        const empHousing = p.employerHousingLevy ?? p.housingLevy;
        const empNita = p.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
        return {
          Period: p.payPeriod,
          Staff_Name: p.staffName,
          Gross_Pay: p.grossPay,
          PAYE_KRA: p.paye,
          NSSF_Employee: p.nssf,
          NSSF_Employer: empNssf,
          NSSF_Total: p.nssf + empNssf,
          SHIF_2_75_Pct: p.shif,
          Housing_Levy_Employee: p.housingLevy,
          Housing_Levy_Employer: empHousing,
          NITA_Levy: empNita,
          Total_Statutory_Remittance:
            p.paye + p.nssf + empNssf + p.shif + p.housingLevy + empHousing + empNita,
        };
      });

    const masterWs = createBrandedWorksheetFromObjects(
      tenant,
      `Staff Payroll Master Schedule (${payPeriod})`,
      masterRows,
      {
        subtitle: `Pay Period: ${payPeriod} | Schedule: ${activeSchedule?.label || 'Kenya Statutory'} | Currency: ${tenant.currency}`,
        colWidths: [12, 24, 14, 22, 14, 14, 14, 12, 14, 12, 16, 14, 16, 14, 14, 16, 12, 18, 14],
      }
    );
    const statutoryWs = createBrandedWorksheetFromObjects(
      tenant,
      `P9 & Statutory Returns Schedule — PAYE, NSSF, SHIF, AHL & NITA (${payPeriod})`,
      statutoryRows,
      {
        subtitle: `Pay Period: ${payPeriod} | Currency: ${tenant.currency}`,
        colWidths: [12, 24, 14, 14, 14, 14, 14, 14, 16, 16, 12, 24],
      }
    );

    XLSX.utils.book_append_sheet(wb, masterWs, 'Payroll Master');
    XLSX.utils.book_append_sheet(wb, statutoryWs, 'P9 & Statutory Returns');
    XLSX.writeFile(wb, `${tenant.slug}-payroll-statutory-${payPeriod}.xlsx`);
    onNotify(`Exported Payroll & Statutory Returns (${payPeriod}) to Excel.`);
  }

  async function handleExportPayslipPdf(entry: PayrollEntry) {
    const meta = resolveTenantDocumentMeta(tenant);
    const logoPng = await loadLogoPngDataUrl(meta.logoUrl, 120);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 595, 96, 'F');
    if (logoPng) {
      try {
        doc.addImage(logoPng, 'PNG', 36, 18, 56, 56);
      } catch {
        // fallback if image fails
      }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text(meta.schoolName.toUpperCase(), 106, 38);
    doc.setFontSize(9);
    doc.text(`${meta.location} · ${meta.postalAddress}`, 106, 54);
    doc.text(`Tel: ${meta.contactPhone} · Email: ${meta.contactEmail}`, 106, 68);
    doc.setFontSize(11);
    doc.text(`OFFICIAL STAFF PAYSLIP · ${entry.payPeriod}`, 40, 120);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.text(`Employee: ${entry.staffName}`, 40, 145);
    doc.text(`Designation: ${entry.designation} (${entry.staffCategory})`, 40, 162);
    doc.text(`Status: ${entry.reversed ? 'REVERSED' : entry.status}`, 400, 145);
    doc.text(`Currency: ${tenant.currency}`, 400, 162);
    if (entry.approvedBy) {
      doc.text(`Approved By: ${entry.approvedBy}`, 400, 178);
    }

    let y = 205;
    doc.setFillColor(241, 245, 249);
    doc.rect(40, y - 14, 515, 22, 'F');
    doc.setFontSize(10);
    doc.text('EARNINGS & GROSS PAY', 48, y);
    doc.text('AMOUNT', 540, y, { align: 'right' });

    const rowsA: Array<[string, number]> = [
      ['Basic Salary', entry.basicSalary],
      ['Allowances', entry.allowances],
      ['Gross Pay', entry.grossPay],
    ];
    y += 22;
    for (const [label, amt] of rowsA) {
      doc.text(label, 48, y);
      doc.text(formatCurrency(amt, tenant.currency), 540, y, { align: 'right' });
      y += 18;
    }

    y += 12;
    doc.setFillColor(241, 245, 249);
    doc.rect(40, y - 14, 515, 22, 'F');
    doc.text('STATUTORY & OTHER DEDUCTIONS', 48, y);
    doc.text('AMOUNT', 540, y, { align: 'right' });

    const rowsB: Array<[string, number]> = [
      ['PAYE (Income Tax after Personal Relief)', entry.paye],
      ['NSSF (Employee Tier I & II — 6%)', entry.nssf],
      ['SHIF (2.75% Deductible)', entry.shif],
      ['Affordable Housing Levy (1.5% Deductible)', entry.housingLevy],
      ['SACCO / Staff Loan Recovery', entry.saccoOrLoan],
      ['Total Deductions', entry.totalDeductions],
    ];
    y += 22;
    for (const [label, amt] of rowsB) {
      doc.text(label, 48, y);
      doc.text(formatCurrency(amt, tenant.currency), 540, y, { align: 'right' });
      y += 18;
    }

    y += 10;
    doc.setFillColor(220, 252, 231);
    doc.rect(40, y - 16, 515, 28, 'F');
    doc.setFontSize(12);
    doc.setTextColor(21, 128, 61);
    doc.text('NET PAY DISBURSED', 48, y + 3);
    doc.text(formatCurrency(entry.netPay, tenant.currency), 540, y + 3, { align: 'right' });

    const empNssf = entry.employerNssf ?? entry.nssf;
    const empHousing = entry.employerHousingLevy ?? entry.housingLevy;
    const empNita = entry.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
    const empTotalCost = entry.totalEmployerCost ?? entry.grossPay + empNssf + empHousing + empNita;

    y += 42;
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFillColor(241, 245, 249);
    doc.rect(40, y - 14, 515, 22, 'F');
    doc.text('EMPLOYER STATUTORY CONTRIBUTIONS (COST TO SCHOOL)', 48, y);
    doc.text('AMOUNT', 540, y, { align: 'right' });
    y += 22;
    const rowsC: Array<[string, number]> = [
      ['Employer NSSF Match (6%)', empNssf],
      ['Employer Affordable Housing Levy (1.5%)', empHousing],
      ['NITA Industrial Training Levy', empNita],
      ['Total Cost to School', empTotalCost],
    ];
    for (const [label, amt] of rowsC) {
      doc.text(label, 48, y);
      doc.text(formatCurrency(amt, tenant.currency), 540, y, { align: 'right' });
      y += 18;
    }

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Generated from ${meta.schoolName} Payroll Control · Statutory Schedule: ${
        activeSchedule?.label || 'Kenya Statutory'
      }`,
      40,
      790
    );
    doc.save(`${tenant.slug}-payslip-${entry.staffName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${entry.payPeriod}.pdf`);
    onNotify(`Downloaded Payslip PDF for ${entry.staffName}.`);
  }

  async function handleExportStatutoryPdf() {
    const active = scopedEntries.filter((p) => !p.reversed);
    if (active.length === 0) {
      onNotify('No active payroll entries in this period to export.', 'error');
      return;
    }
    const meta = resolveTenantDocumentMeta(tenant);
    const logoPng = await loadLogoPngDataUrl(meta.logoUrl, 120);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 842, 78, 'F');
    if (logoPng) {
      try {
        doc.addImage(logoPng, 'PNG', 28, 12, 50, 50);
      } catch {
        // ignore logo errors
      }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text(`${meta.schoolName.toUpperCase()} — P9 & STATUTORY REMITTANCE SCHEDULE`, 92, 34);
    doc.setFontSize(9);
    doc.text(
      `Pay Period: ${payPeriod} · ${active.length} Staff · Schedule: ${
        activeSchedule?.label || 'Feb 2026'
      } · Tel: ${meta.contactPhone}`,
      92,
      52
    );

    let y = 104;
    doc.setFillColor(241, 245, 249);
    doc.rect(28, y - 12, 786, 20, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8.5);
    doc.text('Staff Name', 34, y);
    doc.text('Gross Pay', 235, y, { align: 'right' });
    doc.text('PAYE', 305, y, { align: 'right' });
    doc.text('NSSF (Emp)', 380, y, { align: 'right' });
    doc.text('NSSF (Empr)', 455, y, { align: 'right' });
    doc.text('SHIF', 525, y, { align: 'right' });
    doc.text('AHL (Emp)', 600, y, { align: 'right' });
    doc.text('AHL (Empr)', 675, y, { align: 'right' });
    doc.text('NITA', 725, y, { align: 'right' });
    doc.text('Net Pay', 808, y, { align: 'right' });

    y += 18;
    for (const p of active) {
      if (y > 540) {
        doc.addPage();
        y = 48;
      }
      const empNssf = p.employerNssf ?? p.nssf;
      const empHousing = p.employerHousingLevy ?? p.housingLevy;
      const empNita = p.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
      doc.text(p.staffName.slice(0, 28), 34, y);
      doc.text(p.grossPay.toLocaleString(), 235, y, { align: 'right' });
      doc.text(p.paye.toLocaleString(), 305, y, { align: 'right' });
      doc.text(p.nssf.toLocaleString(), 380, y, { align: 'right' });
      doc.text(empNssf.toLocaleString(), 455, y, { align: 'right' });
      doc.text(p.shif.toLocaleString(), 525, y, { align: 'right' });
      doc.text(p.housingLevy.toLocaleString(), 600, y, { align: 'right' });
      doc.text(empHousing.toLocaleString(), 675, y, { align: 'right' });
      doc.text(empNita.toLocaleString(), 725, y, { align: 'right' });
      doc.text(p.netPay.toLocaleString(), 808, y, { align: 'right' });
      y += 16;
    }

    y += 6;
    doc.setFillColor(226, 232, 240);
    doc.rect(28, y - 12, 786, 20, 'F');
    doc.text('TOTALS', 34, y);
    doc.text(totals.gross.toLocaleString(), 235, y, { align: 'right' });
    doc.text(totals.paye.toLocaleString(), 305, y, { align: 'right' });
    doc.text(totals.nssf.toLocaleString(), 380, y, { align: 'right' });
    doc.text(totals.employerNssf.toLocaleString(), 455, y, { align: 'right' });
    doc.text(totals.shif.toLocaleString(), 525, y, { align: 'right' });
    doc.text(totals.housing.toLocaleString(), 600, y, { align: 'right' });
    doc.text(totals.employerHousing.toLocaleString(), 675, y, { align: 'right' });
    doc.text(totals.employerNita.toLocaleString(), 725, y, { align: 'right' });
    doc.text(totals.net.toLocaleString(), 808, y, { align: 'right' });

    doc.save(`${tenant.slug}-p9-statutory-schedule-${payPeriod}.pdf`);
    onNotify(`Downloaded P9 & Statutory Remittance PDF (${payPeriod}).`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Payroll &amp; Statutory Deductions
            </h2>
            {activeSchedule && (
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                {activeSchedule.label} (w.e.f {activeSchedule.effectiveFrom})
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            SHIF ({((activeSchedule?.shifRate ?? 0.0275) * 100).toFixed(2)}%) &amp; Housing Levy (
            {((activeSchedule?.housingLevyRate ?? 0.015) * 100).toFixed(1)}%) treated as pre-PAYE deductible, NSSF 6% (max{' '}
            {formatCurrency(activeSchedule?.nssfMaxEmployee ?? 6480, tenant.currency)}), plus Employer match &amp; NITA.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={payPeriod}
            onChange={(e) => setPayPeriod(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={!canManage}
            onClick={async () => {
              try {
                await saasApi.generatePayrollRun(tenant.id, payPeriod);
                await onRefresh();
                onNotify(`Synced active Teaching & Non-Teaching staff into ${payPeriod} payroll as Draft.`);
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Unable to sync staff roster', 'error');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
          >
            <Users className="h-3.5 w-3.5" />
            Sync Staff Roster
          </button>
          <button
            type="button"
            onClick={handleExportPayrollExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Statutory Excel
          </button>
          <button
            type="button"
            onClick={handleExportStatutoryPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <FileText className="h-3.5 w-3.5" />
            P9 / Statutory PDF
          </button>
          <button
            type="button"
            disabled={!canManage}
            onClick={() => openEditModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Staff Pay
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Gross Pay</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.gross, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">PAYE Tax</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(totals.paye, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">NSSF (Emp + Empr)</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.nssf + totals.employerNssf, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">SHIF (2.75%)</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.shif, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">AHL (Emp + Empr)</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.housing + totals.employerHousing, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">NITA Levy</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.employerNita, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Net Pay</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totals.net, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total School Cost</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-blue-700 dark:text-blue-400">
            {formatCurrency(totals.totalEmployerCost, tenant.currency)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-3 py-3 text-right">Gross Pay</th>
                <th className="px-3 py-3 text-right">PAYE</th>
                <th className="px-3 py-3 text-right">NSSF</th>
                <th className="px-3 py-3 text-right">SHIF</th>
                <th className="px-3 py-3 text-right">Housing</th>
                <th className="px-3 py-3 text-right">Net Pay</th>
                <th className="px-3 py-3 text-right">Employer Cost</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {scopedEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No payroll entries for {payPeriod}. Click Sync Staff Roster above to generate payroll.
                  </td>
                </tr>
              ) : (
                scopedEntries.map((p) => {
                  const empNssf = p.employerNssf ?? p.nssf;
                  const empHousing = p.employerHousingLevy ?? p.housingLevy;
                  const empNita = p.employerNita ?? (activeSchedule?.nitaLevy ?? 50);
                  const empCost = p.totalEmployerCost ?? p.grossPay + empNssf + empHousing + empNita;
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${
                        p.reversed ? 'opacity-65' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {p.staffName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.staffCategory} · {p.designation}
                          {p.saccoOrLoan > 0 ? ` · SACCO ${formatCurrency(p.saccoOrLoan, tenant.currency)}` : ''}
                        </div>
                        {p.reversed && p.reversalReason && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400">
                            Reversed: {p.reversalReason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(p.grossPay, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                        {formatCurrency(p.paye, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(p.nssf, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(p.shif, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(p.housingLevy, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(p.netPay, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-blue-700 dark:text-blue-400">
                        <div>{formatCurrency(empCost, tenant.currency)}</div>
                        <div className="text-[10px] text-slate-400">
                          +{formatCurrency(empNssf + empHousing + empNita, tenant.currency)} emplyr
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                            p.reversed
                              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                              : p.status === 'Disbursed'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : p.status === 'Approved'
                              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {p.reversed ? 'Reversed' : p.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleExportPayslipPdf(p)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                            title="Download Payslip PDF"
                          >
                            <FileText className="h-3 w-3" />
                            Payslip
                          </button>
                          {canManage && !p.reversed && p.status !== 'Disbursed' && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const next: PayrollStatus =
                                    p.status === 'Draft' ? 'Approved' : 'Disbursed';
                                  try {
                                    await saasApi.updatePayrollStatus(tenant.id, p.id, next);
                                    await onRefresh();
                                    onNotify(`${p.staffName} payroll marked ${next}.`);
                                  } catch (err) {
                                    onNotify(
                                      err instanceof Error
                                        ? err.message
                                        : 'Unable to advance payroll status',
                                      'error'
                                    );
                                  }
                                }}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              >
                                {p.status === 'Draft' ? 'Approve' : 'Pay'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionReason('');
                                  setActionModal({ mode: 'void', entry: p });
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                title="Void Draft/Approved Payroll Entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {canManage && !p.reversed && p.status === 'Disbursed' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionReason('');
                                setActionModal({ mode: 'reverse', entry: p });
                              }}
                              className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingId ? 'Edit Staff Payroll & Deductions' : 'Add Staff Payroll Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEntry} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Staff Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Staff Category
                  </label>
                  <select
                    value={staffCategory}
                    onChange={(e) =>
                      setStaffCategory(e.target.value as 'Teaching' | 'Non-Teaching')
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Teaching">Teaching</option>
                    <option value="Non-Teaching">Non-Teaching</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Senior Teacher"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Basic Salary ({tenant.currency}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Allowances
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={allowances}
                    onChange={(e) => setAllowances(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    SACCO / Loan
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={saccoOrLoan}
                    onChange={(e) => setSaccoOrLoan(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                Maker-Checker control: Saved entries enter <strong>Draft</strong> status and require approval by a different Bursar or Admin before disbursement.
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!actionReason.trim()) {
                onNotify('Please provide a clear audit reason.', 'error');
                return;
              }
              setSaving(true);
              try {
                if (actionModal.mode === 'reverse') {
                  await saasApi.reversePayrollEntry(
                    tenant.id,
                    actionModal.entry.id,
                    actionReason.trim()
                  );
                  onNotify(`Reversed disbursed payroll for ${actionModal.entry.staffName}.`);
                } else {
                  await saasApi.deletePayrollEntry(
                    tenant.id,
                    actionModal.entry.id,
                    actionReason.trim()
                  );
                  onNotify(`Voided payroll entry for ${actionModal.entry.staffName}.`);
                }
                await onRefresh();
                setActionModal(null);
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Unable to update payroll entry', 'error');
              } finally {
                setSaving(false);
              }
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {actionModal.mode === 'reverse'
                ? 'Reverse Disbursed Payroll Entry'
                : 'Void Payroll Entry'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {actionModal.entry.staffName} · {actionModal.entry.payPeriod} · Net{' '}
              {formatCurrency(actionModal.entry.netPay, tenant.currency)}
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Audit Reason *
              </label>
              <textarea
                rows={3}
                required
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder={
                  actionModal.mode === 'reverse'
                    ? 'e.g. Overstated allowance; creating reversal for corrected re-run'
                    : 'e.g. Duplicate draft staff entry'
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {saving
                  ? 'Processing...'
                  : actionModal.mode === 'reverse'
                  ? 'Confirm Reversal'
                  : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
