import { jsPDF } from 'jspdf';
import {
  loadLogoPngDataUrl,
  resolveTenantDocumentMeta,
} from './documentBranding';
import { formatCurrency, formatDateShort } from './format';
import {
  getStructureVotelines,
  summarizeIndependentVotelinesForStructure,
} from './feesHelpers';
import type { FinancialBooksReport } from './accounting';
import type {
  CbcLearnerMasteryLevel,
  ExamCycle,
  ExamResultStatus,
  FeeInvoice,
  FeeStructure,
  IndependentVotelineItem,
  LessonPlan,
  PaymentRecord,
  RecordOfWork,
  SchemeOfWork,
  Student,
  TeacherLeaveOutChit,
  Tenant,
} from '../shared/types';

function safeFileSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document'
  );
}

/**
 * Normalizes strings for jsPDF built-in Helvetica (WinAnsiEncoding)
 * so glyphs like arrows, triangles, and em-dashes render cleanly.
 */
function pdfText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/×/g, 'x')
    .replace(/Δ/g, 'Dev')
    .replace(/✓/g, '[OK]')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  return [37, 99, 235];
}

interface PdfTableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

interface PdfTableRowStyle {
  bold?: boolean;
  fillRgb?: [number, number, number];
  textRgb?: [number, number, number];
}

class BrandedPdfCanvas {
  readonly doc: jsPDF;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margin = 36;
  readonly contentWidth: number;
  readonly primaryRgb: [number, number, number];
  readonly schoolName: string;
  y = 36;

  constructor(
    tenant: Partial<Tenant> | null | undefined,
    orientation: 'portrait' | 'landscape' = 'portrait'
  ) {
    const meta = resolveTenantDocumentMeta(tenant);
    this.doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.contentWidth = this.pageWidth - this.margin * 2;
    this.primaryRgb = hexToRgb(meta.primaryColor);
    this.schoolName = pdfText(meta.schoolName);
  }

  ensureSpace(requiredHeight: number) {
    if (this.y + requiredHeight > this.pageHeight - 44) {
      this.doc.addPage();
      this.y = 40;
    }
  }

  async drawHeader(
    tenant: Partial<Tenant> | null | undefined,
    documentTitle: string,
    subtitle: string,
    rightMeta: Array<{ label: string; value: string }> = []
  ) {
    const meta = resolveTenantDocumentMeta(tenant);
    const logoPng = await loadLogoPngDataUrl(meta.logoUrl, 128);
    const [pr, pg, pb] = this.primaryRgb;

    // Top dark slate letterhead band + primary accent bar
    this.doc.setFillColor(15, 23, 42);
    this.doc.rect(0, 0, this.pageWidth, 82, 'F');
    this.doc.setFillColor(pr, pg, pb);
    this.doc.rect(0, 82, this.pageWidth, 4, 'F');

    let leftX = this.margin;
    if (logoPng) {
      try {
        this.doc.addImage(logoPng, 'PNG', this.margin, 15, 50, 50);
        leftX = this.margin + 62;
      } catch {
        // continue cleanly without image
      }
    }

    this.doc.setTextColor(255, 255, 255);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(14);
    this.doc.text(pdfText(meta.schoolName.toUpperCase()), leftX, 34);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(203, 213, 225);
    this.doc.text(
      pdfText(`${meta.location} | ${meta.postalAddress}`),
      leftX,
      49
    );
    this.doc.text(
      pdfText(`Tel: ${meta.contactPhone} | Email: ${meta.contactEmail}`),
      leftX,
      62
    );

    if (rightMeta.length > 0) {
      let ry = 26;
      const rightX = this.pageWidth - this.margin;
      this.doc.setFontSize(8);
      for (const item of rightMeta.slice(0, 3)) {
        this.doc.setTextColor(148, 163, 184);
        this.doc.setFont('helvetica', 'normal');
        const labelStr = `${pdfText(item.label)}: `;
        const valStr = pdfText(item.value);
        this.doc.setFont('helvetica', 'bold');
        const valW = this.doc.getTextWidth(valStr);
        this.doc.setTextColor(255, 255, 255);
        this.doc.text(valStr, rightX, ry, { align: 'right' });
        this.doc.setFont('helvetica', 'normal');
        this.doc.setTextColor(148, 163, 184);
        this.doc.text(labelStr, rightX - valW, ry, { align: 'right' });
        ry += 14;
      }
    }

    this.y = 104;
    this.doc.setTextColor(15, 23, 42);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(13);
    this.doc.text(pdfText(documentTitle), this.margin, this.y);

    if (subtitle) {
      this.y += 15;
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.5);
      this.doc.setTextColor(71, 85, 105);
      const subLines = this.doc.splitTextToSize(
        pdfText(subtitle),
        this.contentWidth
      ) as string[];
      this.doc.text(subLines, this.margin, this.y);
      this.y += (subLines.length - 1) * 12;
    }

    this.y += 12;
    this.doc.setDrawColor(226, 232, 240);
    this.doc.line(this.margin, this.y, this.pageWidth - this.margin, this.y);
    this.y += 14;
  }

  drawKpiGrid(
    items: Array<{ label: string; value: string; note?: string; accent?: 'blue' | 'emerald' | 'amber' | 'rose' }>
  ) {
    if (items.length === 0) return;
    const cols = Math.min(4, items.length);
    const gap = 8;
    const boxW = (this.contentWidth - gap * (cols - 1)) / cols;
    const boxH = items.some((i) => i.note) ? 52 : 40;
    this.ensureSpace(boxH + 10);

    items.slice(0, 4).forEach((item, idx) => {
      const bx = this.margin + idx * (boxW + gap);
      this.doc.setFillColor(248, 250, 252);
      this.doc.setDrawColor(226, 232, 240);
      this.doc.roundedRect(bx, this.y, boxW, boxH, 4, 4, 'FD');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(100, 116, 139);
      this.doc.text(pdfText(item.label.toUpperCase()), bx + 8, this.y + 13);

      this.doc.setFontSize(11);
      if (item.accent === 'emerald') this.doc.setTextColor(21, 128, 61);
      else if (item.accent === 'amber') this.doc.setTextColor(180, 83, 9);
      else if (item.accent === 'rose') this.doc.setTextColor(190, 18, 60);
      else if (item.accent === 'blue') this.doc.setTextColor(29, 78, 216);
      else this.doc.setTextColor(15, 23, 42);

      const valLines = this.doc.splitTextToSize(pdfText(item.value), boxW - 16) as string[];
      this.doc.text(valLines[0] || '', bx + 8, this.y + 28);

      if (item.note) {
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(100, 116, 139);
        const noteLines = this.doc.splitTextToSize(pdfText(item.note), boxW - 16) as string[];
        this.doc.text(noteLines[0] || '', bx + 8, this.y + 42);
      }
    });

    this.y += boxH + 12;
  }

  drawSectionTitle(title: string, note?: string) {
    this.ensureSpace(28);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(10);
    this.doc.setTextColor(15, 23, 42);
    this.doc.text(pdfText(title), this.margin, this.y);
    if (note) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(100, 116, 139);
      this.doc.text(pdfText(note), this.pageWidth - this.margin, this.y, {
        align: 'right',
      });
    }
    this.y += 12;
  }

  drawKeyValuePanel(title: string, text: string, tint: 'slate' | 'blue' = 'slate') {
    const body = pdfText(text).trim();
    if (!body) return;
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    const lines = this.doc.splitTextToSize(body, this.contentWidth - 20) as string[];
    const boxH = 26 + lines.length * 11;
    this.ensureSpace(boxH + 8);

    if (tint === 'blue') {
      this.doc.setFillColor(239, 246, 255);
      this.doc.setDrawColor(191, 219, 254);
    } else {
      this.doc.setFillColor(248, 250, 252);
      this.doc.setDrawColor(226, 232, 240);
    }
    this.doc.roundedRect(this.margin, this.y, this.contentWidth, boxH, 4, 4, 'FD');

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(tint === 'blue' ? 30 : 30, tint === 'blue' ? 64 : 41, tint === 'blue' ? 175 : 59);
    this.doc.text(pdfText(title), this.margin + 10, this.y + 14);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(51, 65, 85);
    lines.forEach((line, idx) => {
      this.doc.text(line, this.margin + 10, this.y + 27 + idx * 11);
    });

    this.y += boxH + 8;
  }

  drawTable(
    columns: PdfTableColumn[],
    rows: Array<{ cells: Array<string | number>; style?: PdfTableRowStyle }>,
    options?: { fontSize?: number; emptyText?: string }
  ) {
    const fontSize = options?.fontSize ?? 8;
    const totalColWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const scale = totalColWidth > 0 ? this.contentWidth / totalColWidth : 1;
    const scaledCols = columns.map((c) => ({ ...c, width: c.width * scale }));

    const drawHeaderRow = () => {
      const headerH = 20;
      this.ensureSpace(headerH + 18);
      this.doc.setFillColor(241, 245, 249);
      this.doc.setDrawColor(203, 213, 225);
      this.doc.rect(this.margin, this.y, this.contentWidth, headerH, 'FD');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(Math.max(7, fontSize - 0.5));
      this.doc.setTextColor(71, 85, 105);

      let cx = this.margin;
      for (const col of scaledCols) {
        const align = col.align || 'left';
        const tx =
          align === 'right'
            ? cx + col.width - 5
            : align === 'center'
            ? cx + col.width / 2
            : cx + 5;
        this.doc.text(pdfText(col.header), tx, this.y + 13, { align });
        cx += col.width;
      }
      this.y += headerH;
    };

    drawHeaderRow();

    if (rows.length === 0) {
      this.doc.setDrawColor(226, 232, 240);
      this.doc.rect(this.margin, this.y, this.contentWidth, 24, 'S');
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8.5);
      this.doc.setTextColor(100, 116, 139);
      this.doc.text(
        pdfText(options?.emptyText || 'No records available.'),
        this.margin + this.contentWidth / 2,
        this.y + 15,
        { align: 'center' }
      );
      this.y += 32;
      return;
    }

    const lineHeight = fontSize + 3;
    rows.forEach((row, rIdx) => {
      const isBold = Boolean(row.style?.bold);
      this.doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      this.doc.setFontSize(fontSize);

      const cellWrapped: string[][] = scaledCols.map((col, cIdx) => {
        const raw = pdfText(row.cells[cIdx] ?? '');
        const maxW = Math.max(12, col.width - 10);
        return (this.doc.splitTextToSize(raw, maxW) as string[]) || [''];
      });
      const maxLines = Math.max(1, ...cellWrapped.map((l) => l.length));
      const rowH = Math.max(18, maxLines * lineHeight + 8);

      if (this.y + rowH > this.pageHeight - 44) {
        this.doc.addPage();
        this.y = 40;
        drawHeaderRow();
        this.doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        this.doc.setFontSize(fontSize);
      }

      if (row.style?.fillRgb) {
        this.doc.setFillColor(...row.style.fillRgb);
        this.doc.rect(this.margin, this.y, this.contentWidth, rowH, 'F');
      } else if (rIdx % 2 === 1) {
        this.doc.setFillColor(248, 250, 252);
        this.doc.rect(this.margin, this.y, this.contentWidth, rowH, 'F');
      }

      this.doc.setDrawColor(226, 232, 240);
      this.doc.line(this.margin, this.y + rowH, this.pageWidth - this.margin, this.y + rowH);

      const [tr, tg, tb] = row.style?.textRgb || [30, 41, 59];
      this.doc.setTextColor(tr, tg, tb);

      let cx = this.margin;
      scaledCols.forEach((col, cIdx) => {
        const align = col.align || 'left';
        const tx =
          align === 'right'
            ? cx + col.width - 5
            : align === 'center'
            ? cx + col.width / 2
            : cx + 5;
        const lines = cellWrapped[cIdx];
        lines.forEach((line, lIdx) => {
          this.doc.text(line, tx, this.y + 12 + lIdx * lineHeight, { align });
        });
        cx += col.width;
      });

      this.y += rowH;
    });

    this.y += 12;
  }

  saveWithFooters(fileName: string, leftFooterNote?: string) {
    const totalPages = this.doc.getNumberOfPages();
    const generated = new Date().toISOString().slice(0, 10);
    for (let i = 1; i <= totalPages; i += 1) {
      this.doc.setPage(i);
      this.doc.setDrawColor(226, 232, 240);
      this.doc.line(this.margin, this.pageHeight - 30, this.pageWidth - this.margin, this.pageHeight - 30);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(100, 116, 139);
      this.doc.text(
        pdfText(
          leftFooterNote ||
            `${this.schoolName} | Official Document | Generated ${generated}`
        ),
        this.margin,
        this.pageHeight - 18
      );
      this.doc.text(
        `Page ${i} of ${totalPages}`,
        this.pageWidth - this.margin,
        this.pageHeight - 18,
        { align: 'right' }
      );
    }
    this.doc.save(fileName);
  }
}

/* ============================================================================
 * 1. ACADEMIC REPORT CARD PDF (ExamsModule)
 * ============================================================================ */

export interface AcademicReportCardPdfInput {
  tenant: Tenant;
  cycle: ExamCycle;
  student: Student;
  studentSystemLabel: string;
  guardianName: string;
  guardianPhone?: string;
  totalMarks: number;
  maxPossible: number;
  avgScore: number;
  meanGrade: string;
  meanPoints: string;
  studentMaxPts: number;
  overallRank: number | null;
  totalRanked: number;
  results: Array<{
    subject: string;
    score: number;
    maxScore: number;
    letterGrade: string;
    gpaPoints: number;
    resultStatus?: ExamResultStatus;
    isNonSat?: boolean;
    remarks?: string;
    teacherInitials?: string;
  }>;
  progressionPoints?: Array<{
    title: string;
    term: string;
    avgScore: number;
    meanGrade: string;
    deltaFromPrev: number | null;
  }>;
  principalRemark?: string;
}

export async function downloadAcademicReportCardPdf(input: AcademicReportCardPdfInput): Promise<string> {
  const {
    tenant,
    cycle,
    student,
    studentSystemLabel,
    guardianName,
    guardianPhone,
    totalMarks,
    maxPossible,
    avgScore,
    meanGrade,
    meanPoints,
    studentMaxPts,
    overallRank,
    totalRanked,
    results,
    progressionPoints = [],
    principalRemark,
  } = input;

  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    'OFFICIAL ACADEMIC REPORT CARD',
    `${cycle.title} (${cycle.term}) | ${studentSystemLabel} | ${student.grade} Stream ${student.section}`,
    [
      { label: 'Student', value: student.fullName },
      { label: 'Adm No', value: student.studentCode },
      { label: 'Cycle Status', value: cycle.status },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: 'Total / Mean Score',
      value: `${totalMarks} / ${maxPossible}`,
      note: `Mean Average: ${avgScore}%`,
    },
    {
      label: 'Overall Grade',
      value: `${meanGrade} (${meanPoints}/${studentMaxPts})`,
      note: studentSystemLabel,
      accent: 'blue',
    },
    {
      label: 'Class Position',
      value: overallRank ? `#${overallRank} / ${totalRanked}` : 'Pending',
      note: `${student.grade} Stream ${student.section}`,
      accent: 'emerald',
    },
    {
      label: 'Guardian Contact',
      value: guardianName || 'Parent / Guardian',
      note: guardianPhone || 'No phone on file',
    },
  ]);

  pdf.drawSectionTitle('Subject Performance Breakdown', `${results.length} Subject(s)`);
  pdf.drawTable(
    [
      { header: 'Subject', width: 135 },
      { header: 'Score', width: 65, align: 'right' },
      { header: 'Grade', width: 45, align: 'center' },
      { header: 'Points', width: 55, align: 'right' },
      { header: 'Instructor Remarks', width: 175 },
      { header: 'Init.', width: 45, align: 'right' },
    ],
    results.map((r) => ({
      cells: [
        r.subject,
        r.isNonSat ? r.resultStatus || r.letterGrade : `${r.score} / ${r.maxScore}`,
        r.letterGrade,
        r.isNonSat ? '-' : `${r.gpaPoints} / ${studentMaxPts}`,
        r.remarks || '-',
        r.teacherInitials || '-',
      ],
    })),
    { fontSize: 8.5, emptyText: `No marks recorded yet for ${cycle.title}.` }
  );

  if (progressionPoints.length > 0) {
    pdf.drawSectionTitle(
      'Academic Performance Progression',
      `${progressionPoints.length} Assessment Cycle(s)`
    );
    pdf.drawTable(
      [
        { header: 'Exam Cycle', width: 220 },
        { header: 'Term', width: 90 },
        { header: 'Mean %', width: 70, align: 'right' },
        { header: 'Grade', width: 60, align: 'center' },
        { header: 'Delta vs Prior', width: 80, align: 'right' },
      ],
      progressionPoints.map((pt) => ({
        cells: [
          pt.title,
          pt.term,
          `${pt.avgScore}%`,
          pt.meanGrade,
          pt.deltaFromPrev === null
            ? 'Baseline'
            : `${pt.deltaFromPrev > 0 ? '+' : ''}${pt.deltaFromPrev}%`,
        ],
      })),
      { fontSize: 8 }
    );
  }

  if (principalRemark?.trim()) {
    pdf.drawKeyValuePanel("Class Teacher / Principal's Remark", principalRemark.trim(), 'blue');
  }

  pdf.ensureSpace(50);
  pdf.y += 10;
  pdf.doc.setFont('helvetica', 'normal');
  pdf.doc.setFontSize(8.5);
  pdf.doc.setTextColor(71, 85, 105);
  pdf.doc.text('Class Teacher Signature: _______________________', pdf.margin, pdf.y);
  pdf.doc.text(
    'Principal / Official Stamp: _______________________',
    pdf.pageWidth - pdf.margin,
    pdf.y,
    { align: 'right' }
  );

  const fileName = `${tenant.slug}-report-card-${safeFileSlug(student.studentCode)}-${safeFileSlug(
    cycle.title
  )}.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | Academic Report Card | ${student.fullName} (${student.studentCode})`
  );
  return fileName;
}

/* ============================================================================
 * 2. LEARNER PROGRESSIVE REPORT PDF (ProgressiveReportsPanel)
 * ============================================================================ */

export interface ProgressiveReportPdfInput {
  tenant: Tenant;
  student: Student;
  latestMeanScore: number | null;
  latestTitle?: string;
  latestGrade?: string;
  netGain: number | null;
  checkpoints: Array<{
    title: string;
    academicYear: string;
    term: string;
    date: string;
    kind: 'exam-cycle' | 'manual' | 'import';
    totalScore: number;
    maxPossible: number;
    meanScore: number;
    meanGrade: string;
    deltaFromPrev: number | null;
    classTeacherRemarks?: string;
    subjects: Array<{
      subject: string;
      score: number | null;
      maxScore: number;
      resultStatus?: ExamResultStatus;
      letterGrade: string;
      masteryLevel?: CbcLearnerMasteryLevel;
      remarks?: string;
    }>;
  }>;
}

export async function downloadProgressiveReportPdf(input: ProgressiveReportPdfInput): Promise<string> {
  const { tenant, student, latestMeanScore, latestTitle, latestGrade, netGain, checkpoints } =
    input;
  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    'LEARNER PROGRESSIVE ACADEMIC REPORT',
    `${student.fullName} (${student.studentCode}) | ${student.grade} Stream ${student.section}`,
    [
      { label: 'Academic Year', value: tenant.academicYear },
      { label: 'Term', value: tenant.currentTerm },
      { label: 'Checkpoints', value: String(checkpoints.length) },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: 'Assessments Tracked',
      value: String(checkpoints.length),
      note: 'Exam cycles & progressive checks',
    },
    {
      label: 'Latest Mean Score',
      value: latestMeanScore !== null ? `${latestMeanScore}%` : '-',
      note: latestTitle ? `${latestTitle} (${latestGrade || '-'})` : 'No checkpoints',
      accent: 'blue',
    },
    {
      label: 'Net Progression',
      value: netGain === null ? '-' : `${netGain > 0 ? '+' : ''}${netGain}%`,
      note: 'Compared to baseline',
      accent: netGain !== null && netGain >= 0 ? 'emerald' : 'rose',
    },
    {
      label: 'Learner Cohort',
      value: `${student.grade} ${student.section}`,
      note: `Adm No: ${student.studentCode}`,
    },
  ]);

  pdf.drawSectionTitle('Chronological Assessment Trajectory', `${checkpoints.length} Record(s)`);
  pdf.drawTable(
    [
      { header: 'Assessment', width: 155 },
      { header: 'Year & Term', width: 95 },
      { header: 'Date', width: 65 },
      { header: 'Total', width: 65, align: 'right' },
      { header: 'Mean %', width: 55, align: 'right' },
      { header: 'Delta', width: 45, align: 'right' },
      { header: 'Grade', width: 40, align: 'center' },
    ],
    checkpoints.map((cp) => ({
      cells: [
        cp.title,
        `${cp.academicYear} ${cp.term}`,
        formatDateShort(cp.date),
        `${cp.totalScore}/${cp.maxPossible}`,
        `${cp.meanScore}%`,
        cp.deltaFromPrev === null
          ? '-'
          : `${cp.deltaFromPrev > 0 ? '+' : ''}${cp.deltaFromPrev}%`,
        cp.meanGrade,
      ],
    })),
    { fontSize: 8, emptyText: `No progressive assessments recorded for ${student.fullName}.` }
  );

  for (const cp of checkpoints) {
    pdf.drawSectionTitle(
      `${cp.title} (${cp.term} | ${formatDateShort(cp.date)})`,
      `Mean: ${cp.meanScore}% (${cp.meanGrade})`
    );
    if (cp.classTeacherRemarks) {
      pdf.drawKeyValuePanel('Class Teacher Remarks', cp.classTeacherRemarks, 'slate');
    }
    pdf.drawTable(
      [
        { header: 'Subject', width: 150 },
        { header: 'Score', width: 70, align: 'right' },
        { header: 'Grade', width: 50, align: 'center' },
        { header: 'CBC Mastery Level', width: 120 },
        { header: 'Remarks', width: 130 },
      ],
      cp.subjects.map((sub) => ({
        cells: [
          sub.subject,
          sub.resultStatus === 'Absent'
            ? 'ABS'
            : sub.resultStatus === 'Exempt'
            ? 'EXM'
            : sub.score !== null
            ? `${sub.score} / ${sub.maxScore}`
            : '-',
          sub.letterGrade,
          sub.masteryLevel || '-',
          sub.remarks || '-',
        ],
      })),
      { fontSize: 7.8 }
    );
  }

  const fileName = `${tenant.slug}-progressive-report-${safeFileSlug(student.studentCode)}.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | Progressive Report | ${student.fullName} (${student.studentCode})`
  );
  return fileName;
}

/* ============================================================================
 * 3. EXAM BROADSHEET & ANALYTICS PDF (ZerakiExamAnalyticsPanel / ExamsModule)
 * ============================================================================ */

export interface ExamBroadsheetPdfInput {
  tenant: Tenant;
  cycle: ExamCycle;
  grade: string;
  streamScope: string;
  scaleLabel: string;
  cohortMeanScore: number | null;
  cohortMeanGrade: string;
  candidatesSat: number;
  candidatesEnrolled: number;
  streamSummaries: Array<{
    rank: number | null;
    stream: string;
    candidatesSat: number;
    enrolledCount: number;
    meanScore: number | null;
    meanPoints: number | null;
    meanGrade: string;
    passRate: number | null;
    deviation: number | null;
  }>;
  gradeHeaders: string[];
  subjectMatrix: Array<{
    subject: string;
    gradeCounts: Record<string, number>;
    meanScore: number | null;
    meanGrade: string;
  }>;
  registeredSubjects: string[];
  broadsheetRows: Array<{
    rank: number | null;
    studentCode: string;
    fullName: string;
    section: string;
    subjectMap: Record<string, { score: number; letterGrade: string; resultStatus: ExamResultStatus } | undefined>;
    subjectsSat: number;
    totalScore: number;
    meanScore: number | null;
    overallGrade: string;
    meanDeviation: number | null;
  }>;
}

export async function downloadExamBroadsheetPdf(input: ExamBroadsheetPdfInput): Promise<string> {
  const {
    tenant,
    cycle,
    grade,
    streamScope,
    scaleLabel,
    cohortMeanScore,
    cohortMeanGrade,
    candidatesSat,
    candidatesEnrolled,
    streamSummaries,
    gradeHeaders,
    subjectMatrix,
    registeredSubjects,
    broadsheetRows,
  } = input;

  const pdf = new BrandedPdfCanvas(tenant, 'landscape');
  await pdf.drawHeader(
    tenant,
    'ACADEMIC PERFORMANCE ANALYSIS & MERIT BROADSHEET',
    `${cycle.title} | ${grade} (${streamScope === 'All' ? 'All Streams' : `Stream ${streamScope}`})`,
    [
      { label: 'Grading Scale', value: scaleLabel },
      {
        label: 'Cohort Mean',
        value: cohortMeanScore !== null ? `${cohortMeanScore}% (${cohortMeanGrade})` : '-',
      },
      { label: 'Candidates', value: `${candidatesSat} / ${candidatesEnrolled}` },
    ]
  );

  const fmtDev = (d: number | null) =>
    d === null ? '-' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;

  pdf.drawSectionTitle('1. Stream Performance Summary');
  pdf.drawTable(
    [
      { header: 'Pos', width: 45, align: 'center' },
      { header: 'Stream', width: 150 },
      { header: 'Sat / Enr', width: 80, align: 'right' },
      { header: 'Mean %', width: 75, align: 'right' },
      { header: 'Mean Pts', width: 75, align: 'right' },
      { header: 'Grade', width: 65, align: 'center' },
      { header: 'Pass %', width: 75, align: 'right' },
      { header: 'Dev', width: 75, align: 'right' },
    ],
    streamSummaries.map((s) => ({
      cells: [
        s.rank ? `#${s.rank}` : s.stream === 'All Streams' ? 'ALL' : '-',
        s.stream === 'All Streams' ? 'Overall Grade' : `Stream ${s.stream}`,
        `${s.candidatesSat}/${s.enrolledCount}`,
        s.meanScore !== null ? `${s.meanScore}%` : '-',
        s.meanPoints !== null ? s.meanPoints.toFixed(2) : '-',
        s.meanGrade,
        s.passRate !== null ? `${s.passRate}%` : '-',
        fmtDev(s.deviation),
      ],
      style: s.stream === 'All Streams' ? { bold: true, fillRgb: [241, 245, 249] } : undefined,
    })),
    { fontSize: 8 }
  );

  if (subjectMatrix.length > 0) {
    pdf.drawSectionTitle('2. Subject x Grade Distribution Matrix');
    const gradeColW = Math.max(24, Math.floor(380 / Math.max(1, gradeHeaders.length)));
    pdf.drawTable(
      [
        { header: 'Subject', width: 140 },
        ...gradeHeaders.map((g) => ({ header: g, width: gradeColW, align: 'right' as const })),
        { header: 'Mean %', width: 55, align: 'right' },
        { header: 'Grade', width: 45, align: 'center' },
      ],
      subjectMatrix.map((row) => ({
        cells: [
          row.subject,
          ...gradeHeaders.map((g) => row.gradeCounts[g] ?? 0),
          row.meanScore !== null ? `${row.meanScore}%` : '-',
          row.meanGrade,
        ],
      })),
      { fontSize: 7.5 }
    );
  }

  pdf.drawSectionTitle('3. Class Merit Broadsheet', `${broadsheetRows.length} Candidates`);
  const visibleSubjects = registeredSubjects.slice(0, 11);
  const subColW = Math.max(32, Math.floor(340 / Math.max(1, visibleSubjects.length)));
  pdf.drawTable(
    [
      { header: 'Rank', width: 36, align: 'center' },
      { header: 'Adm No', width: 62 },
      { header: 'Learner Name', width: 130 },
      { header: 'Str', width: 28, align: 'center' },
      ...visibleSubjects.map((s) => ({
        header: s.length > 6 ? `${s.slice(0, 5)}.` : s,
        width: subColW,
        align: 'right' as const,
      })),
      { header: 'Total', width: 44, align: 'right' },
      { header: 'Mean', width: 44, align: 'right' },
      { header: 'Grd', width: 34, align: 'center' },
      { header: 'Dev', width: 42, align: 'right' },
    ],
    broadsheetRows.map((row) => ({
      cells: [
        row.rank ? `#${row.rank}` : '-',
        row.studentCode,
        row.fullName,
        row.section,
        ...visibleSubjects.map((sub) => {
          const hit = row.subjectMap[sub];
          return hit ? (hit.resultStatus !== 'Scored' ? hit.letterGrade : hit.score) : '-';
        }),
        row.subjectsSat > 0 ? row.totalScore : '-',
        row.meanScore !== null ? `${row.meanScore}%` : '-',
        row.overallGrade,
        fmtDev(row.meanDeviation),
      ],
    })),
    { fontSize: 7.2, emptyText: 'No candidate scores available.' }
  );

  const fileName = `${tenant.slug}-${safeFileSlug(cycle.title)}-${safeFileSlug(
    grade
  )}-broadsheet.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | ${cycle.title} Merit Broadsheet (${grade})`
  );
  return fileName;
}

/* ============================================================================
 * 4. OFFICIAL FEE RECEIPT / STUDENT FEE STATEMENT PDF (FeesModule)
 * ============================================================================ */

export interface OfficialFeeReceiptPdfInput {
  tenant: Tenant;
  invoice: FeeInvoice;
  activePayment: PaymentRecord | null;
  receiptTargetAmount: number;
  matchedStructureLabel?: string;
  rows: Array<{
    name: string;
    sharePct: number;
    billed: number;
    receiptPaid: number;
    cumulativePaid: number;
    balance: number;
  }>;
  independentVotelines: IndependentVotelineItem[];
}

export async function downloadOfficialFeeReceiptPdf(
  input: OfficialFeeReceiptPdfInput
): Promise<string> {
  const {
    tenant,
    invoice,
    activePayment,
    receiptTargetAmount,
    matchedStructureLabel,
    rows,
    independentVotelines,
  } = input;

  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  const isReceipt = Boolean(activePayment || invoice.payments.length > 0);
  await pdf.drawHeader(
    tenant,
    isReceipt ? 'OFFICIAL FEE RECEIPT & ALLOCATION' : 'OFFICIAL STUDENT FEE STATEMENT',
    `${tenant.academicYear} | ${invoice.term} | ${matchedStructureLabel || invoice.grade}`,
    [
      { label: 'Invoice No', value: invoice.invoiceNumber },
      ...(activePayment
        ? [{ label: 'Receipt No', value: activePayment.receiptNumber }]
        : [{ label: 'Status', value: invoice.status }]),
      { label: 'Currency', value: tenant.currency },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: 'Student',
      value: invoice.studentName,
      note: `${invoice.studentCode} | ${invoice.grade}`,
    },
    {
      label: activePayment ? 'Receipt Payment' : 'Total Fee Paid',
      value: formatCurrency(
        activePayment ? activePayment.amount : invoice.paidAmount,
        tenant.currency
      ),
      note: activePayment
        ? `${activePayment.method} | Ref: ${activePayment.reference}`
        : `${invoice.payments.length} payment(s)`,
      accent: 'emerald',
    },
    {
      label: 'Total Billed',
      value: formatCurrency(invoice.totalAmount, tenant.currency),
      note: `Due: ${formatDateShort(invoice.dueDate)}`,
    },
    {
      label: 'Fee Balance',
      value:
        invoice.balance === 0
          ? `Settled (${formatCurrency(0, tenant.currency)})`
          : formatCurrency(invoice.balance, tenant.currency),
      note:
        (invoice.waiverTotal || 0) + (invoice.creditNotesTotal || 0) > 0
          ? `Waiver/Cr: ${formatCurrency(
              (invoice.waiverTotal || 0) + (invoice.creditNotesTotal || 0),
              tenant.currency
            )}`
          : activePayment
          ? `Date: ${formatDateShort(activePayment.paidAt)}`
          : `Issued: ${formatDateShort(invoice.createdAt)}`,
      accent: invoice.balance === 0 ? 'emerald' : 'amber',
    },
  ]);

  pdf.drawSectionTitle(
    `Proportional Fee Structure Allocation (${rows.length} Votelines)`,
    matchedStructureLabel || 'Default fee allocation'
  );
  pdf.drawTable(
    [
      { header: 'Votehead / Voteline', width: 170 },
      { header: 'Share', width: 45, align: 'right' },
      { header: 'Billed', width: 75, align: 'right' },
      { header: activePayment ? 'This Receipt' : 'Paid', width: 75, align: 'right' },
      { header: 'Total Paid', width: 75, align: 'right' },
      { header: 'Balance', width: 80, align: 'right' },
    ],
    [
      ...rows.map((r, idx) => ({
        cells: [
          `${idx + 1}. ${r.name}`,
          `${r.sharePct.toFixed(1)}%`,
          formatCurrency(r.billed, tenant.currency),
          formatCurrency(r.receiptPaid, tenant.currency),
          formatCurrency(r.cumulativePaid, tenant.currency),
          formatCurrency(r.balance, tenant.currency),
        ],
      })),
      {
        cells: [
          'TOTALS',
          '100.0%',
          formatCurrency(invoice.totalAmount, tenant.currency),
          formatCurrency(receiptTargetAmount, tenant.currency),
          formatCurrency(invoice.paidAmount, tenant.currency),
          formatCurrency(invoice.balance, tenant.currency),
        ],
        style: { bold: true, fillRgb: [241, 245, 249] },
      },
    ],
    { fontSize: 8 }
  );

  if (invoice.payments.length > 0) {
    pdf.drawSectionTitle(`Recorded Payment Transactions (${invoice.payments.length})`);
    pdf.drawTable(
      [
        { header: 'Receipt No', width: 100 },
        { header: 'Method', width: 85 },
        { header: 'Reference', width: 125 },
        { header: 'Date', width: 80 },
        { header: 'Status', width: 55 },
        { header: 'Amount', width: 75, align: 'right' },
      ],
      invoice.payments.map((p) => ({
        cells: [
          p.receiptNumber,
          p.method,
          p.reference,
          formatDateShort(p.paidAt),
          p.voided ? 'VOIDED' : p.isReversalEntry ? 'REVERSAL' : 'Posted',
          formatCurrency(p.amount, tenant.currency),
        ],
      })),
      { fontSize: 8 }
    );
  }

  if (independentVotelines.length > 0) {
    pdf.drawSectionTitle(
      'Independent Votelines (Separate from Main Fee Total)',
      `${independentVotelines.length} Item(s)`
    );
    pdf.drawTable(
      [
        { header: 'Independent Voteline', width: 170 },
        { header: 'Notes / Term', width: 140 },
        { header: 'Charged', width: 70, align: 'right' },
        { header: 'Paid', width: 70, align: 'right' },
        { header: 'Balance', width: 70, align: 'right' },
      ],
      independentVotelines.map((ivl) => ({
        cells: [
          ivl.name,
          ivl.note || ivl.term,
          formatCurrency(ivl.amount, tenant.currency),
          formatCurrency(ivl.paidAmount, tenant.currency),
          formatCurrency(ivl.balance, tenant.currency),
        ],
      })),
      { fontSize: 8 }
    );
  }

  if (tenant.mpesaConfig?.enabled) {
    pdf.drawKeyValuePanel(
      'Settlement Instructions (Lipa na M-Pesa)',
      `Paybill: ${tenant.mpesaConfig.paybillNumber} (${tenant.mpesaConfig.accountName}) | Account Number: ${invoice.studentCode}`,
      'blue'
    );
  }

  const refSlug = activePayment ? activePayment.receiptNumber : invoice.invoiceNumber;
  const fileName = `${tenant.slug}-${isReceipt ? 'receipt' : 'fee-statement'}-${safeFileSlug(
    invoice.studentCode
  )}-${safeFileSlug(refSlug)}.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | ${invoice.studentName} (${invoice.studentCode}) | ${invoice.invoiceNumber}`
  );
  return fileName;
}

/* ============================================================================
 * 5. OFFICIAL FEE STRUCTURE PDF (PrintableFeeStructureModal / FeesModule)
 * ============================================================================ */

export async function downloadFeeStructurePdf(
  tenant: Tenant,
  structure: FeeStructure,
  independentVotelines: IndependentVotelineItem[]
): Promise<string> {
  const modalLines = getStructureVotelines(structure);
  const independentSummary = summarizeIndependentVotelinesForStructure(
    structure,
    independentVotelines
  );

  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    'OFFICIAL FEE STRUCTURE SCHEDULE',
    `${structure.grade} | ${structure.term}`,
    [
      { label: 'Academic Year', value: tenant.academicYear },
      { label: 'Currency', value: tenant.currency },
      { label: 'Votelines', value: String(modalLines.length) },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: 'Target Grade & Term',
      value: structure.grade,
      note: structure.term,
    },
    {
      label: 'Main Term Fee Total',
      value: formatCurrency(structure.totalFee, tenant.currency),
      note: `${modalLines.length} core voteline(s)`,
      accent: 'blue',
    },
    {
      label: 'Independent Votelines',
      value: formatCurrency(independentSummary.separateScheduleTotal, tenant.currency),
      note: 'Optional / auxiliary charges',
      accent: 'emerald',
    },
  ]);

  pdf.drawSectionTitle('Core Fee Structure Votelines');
  pdf.drawTable(
    [
      { header: '#', width: 40, align: 'center' },
      { header: 'Votehead / Voteline Description', width: 350 },
      { header: `Amount (${tenant.currency})`, width: 130, align: 'right' },
    ],
    [
      ...modalLines.map((line, idx) => ({
        cells: [idx + 1, line.name, formatCurrency(line.amount, tenant.currency)],
      })),
      {
        cells: [
          '',
          `Total Term Fee (${structure.grade} | ${structure.term})`,
          formatCurrency(structure.totalFee, tenant.currency),
        ],
        style: { bold: true, fillRgb: [241, 245, 249] },
      },
    ],
    { fontSize: 8.5 }
  );

  pdf.drawSectionTitle(
    'Independent / Auxiliary Votelines (Separate from Main Fee Total)',
    'Billed independently per assignment'
  );
  pdf.drawTable(
    [
      { header: '#', width: 35, align: 'center' },
      { header: 'Independent Voteline', width: 175 },
      { header: 'Scope / Description', width: 195 },
      { header: `Amount (${tenant.currency})`, width: 115, align: 'right' },
    ],
    independentSummary.lines.length === 0
      ? []
      : [
          ...independentSummary.lines.map((item, idx) => ({
            cells: [
              idx + 1,
              item.name,
              item.note || `${item.learnerCount} learner(s) assigned`,
              formatCurrency(item.unitAmount, tenant.currency),
            ],
          })),
          {
            cells: [
              '',
              'Independent Votelines Total (Separate)',
              '',
              formatCurrency(independentSummary.separateScheduleTotal, tenant.currency),
            ],
            style: { bold: true, fillRgb: [236, 253, 245] },
          },
        ],
    {
      fontSize: 8.5,
      emptyText: `No independent votelines assigned for ${structure.grade} (${structure.term}).`,
    }
  );

  if (tenant.mpesaConfig?.enabled) {
    pdf.drawKeyValuePanel(
      'Settlement Instructions (Lipa na M-Pesa)',
      `Paybill: ${tenant.mpesaConfig.paybillNumber} (${tenant.mpesaConfig.accountName}) | Account Number: Learner Admission Code`,
      'blue'
    );
  }

  const fileName = `${tenant.slug}-fee-structure-${safeFileSlug(structure.grade)}-${safeFileSlug(
    structure.term
  )}.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | Official Fee Structure (${structure.grade} - ${structure.term})`
  );
  return fileName;
}

/* ============================================================================
 * 6. FINANCIAL BOOKS & ACCOUNTING STATEMENT PDF (FinancialBooksPanel)
 * ============================================================================ */

export type FinancialStatementBookType =
  | 'pl'
  | 'balance-sheet'
  | 'trial-balance'
  | 'cash-flow'
  | 'cashbook'
  | 'schedules';

export async function downloadFinancialBookPdf(
  tenant: Tenant,
  report: FinancialBooksReport,
  activeBook: FinancialStatementBookType,
  scheduleTab: 'debtors' | 'payables' = 'debtors'
): Promise<string> {
  const titles: Record<FinancialStatementBookType, string> = {
    pl: 'STATEMENT OF PROFIT & LOSS (INCOME & EXPENDITURE)',
    'balance-sheet': 'STATEMENT OF FINANCIAL POSITION (BALANCE SHEET)',
    'trial-balance': 'GENERAL LEDGER TRIAL BALANCE',
    'cash-flow': 'STATEMENT OF CASH FLOWS (BY CHANNEL)',
    cashbook: 'GENERAL CASHBOOK & TRANSACTION JOURNAL',
    schedules:
      scheduleTab === 'debtors'
        ? 'AGED STUDENT FEE DEBTORS SCHEDULE'
        : 'EXPENSE VOUCHERS & DOCUMENT AUDIT SCHEDULE',
  };

  const isWide = activeBook === 'cashbook' || activeBook === 'schedules';
  const pdf = new BrandedPdfCanvas(tenant, isWide ? 'landscape' : 'portrait');
  await pdf.drawHeader(
    tenant,
    titles[activeBook],
    `As at ${formatDateShort(report.asOfDate)} | Statutory & Management Accounting`,
    [
      { label: 'Currency', value: tenant.currency },
      { label: 'As Of', value: formatDateShort(report.asOfDate) },
      {
        label: 'Ledger Status',
        value: report.trialBalanceBalanced ? 'Dr = Cr Reconciled' : 'Check Variance',
      },
    ]
  );

  if (activeBook === 'pl') {
    pdf.drawKpiGrid([
      {
        label: 'Billed Revenue',
        value: formatCurrency(report.totalRevenueBilled, tenant.currency),
        note: `Collected: ${formatCurrency(report.totalCashCollected, tenant.currency)}`,
      },
      {
        label: 'Operating Expenditure',
        value: formatCurrency(report.totalOperatingExpenses, tenant.currency),
        note: `Paid: ${formatCurrency(report.totalPaidExpenses, tenant.currency)}`,
        accent: 'rose',
      },
      {
        label: 'Net Operating Surplus',
        value: formatCurrency(report.netOperatingSurplus, tenant.currency),
        note: `Cash Surplus: ${formatCurrency(report.netCashOperatingSurplus, tenant.currency)}`,
        accent: report.netOperatingSurplus >= 0 ? 'emerald' : 'rose',
      },
    ]);

    pdf.drawSectionTitle('Operating Revenue (Fee Structure Voteheads)');
    pdf.drawTable(
      [
        { header: 'Votehead', width: 170 },
        { header: 'Billed', width: 95, align: 'right' },
        { header: 'Cash Settled', width: 95, align: 'right' },
        { header: 'Receivable', width: 95, align: 'right' },
        { header: 'Share', width: 65, align: 'right' },
      ],
      [
        ...report.revenueLines.map((l) => ({
          cells: [
            l.votehead,
            formatCurrency(l.billedAmount, tenant.currency),
            formatCurrency(l.collectedAmount, tenant.currency),
            formatCurrency(l.receivableAmount, tenant.currency),
            `${l.sharePct.toFixed(1)}%`,
          ],
        })),
        {
          cells: [
            'Total Operating Revenue',
            formatCurrency(report.totalRevenueBilled, tenant.currency),
            formatCurrency(report.totalCashCollected, tenant.currency),
            formatCurrency(report.accountsReceivable, tenant.currency),
            '100.0%',
          ],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );

    pdf.drawSectionTitle('Operating Expenditure');
    pdf.drawTable(
      [
        { header: 'Expense Category', width: 170 },
        { header: 'Incurred', width: 95, align: 'right' },
        { header: 'Cash Paid', width: 95, align: 'right' },
        { header: 'Accrued', width: 95, align: 'right' },
        { header: 'Share', width: 65, align: 'right' },
      ],
      [
        ...report.expenseLines.map((l) => ({
          cells: [
            `${l.category} (${l.voucherCount}v)`,
            formatCurrency(l.totalAmount, tenant.currency),
            formatCurrency(l.paidAmount, tenant.currency),
            formatCurrency(l.accruedAmount, tenant.currency),
            `${l.sharePct.toFixed(1)}%`,
          ],
        })),
        {
          cells: [
            'Total Operating Expenditure',
            formatCurrency(report.totalOperatingExpenses, tenant.currency),
            formatCurrency(report.totalPaidExpenses, tenant.currency),
            formatCurrency(report.totalAccruedExpenses, tenant.currency),
            '100.0%',
          ],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );
  } else if (activeBook === 'balance-sheet') {
    pdf.drawSectionTitle('Assets');
    pdf.drawTable(
      [
        { header: 'Asset Account', width: 370 },
        { header: `Amount (${tenant.currency})`, width: 150, align: 'right' },
      ],
      [
        {
          cells: [
            'Cash & Bank Equivalents (Bank, Mobile Money, Card, Cash)',
            formatCurrency(report.cashAssetBalance, tenant.currency),
          ],
        },
        {
          cells: [
            `Accounts Receivable (${report.debtorsSchedule.length} open student fee debtors)`,
            formatCurrency(report.accountsReceivable, tenant.currency),
          ],
        },
        {
          cells: ['TOTAL ASSETS', formatCurrency(report.totalCurrentAssets, tenant.currency)],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );

    pdf.drawSectionTitle('Liabilities & Accumulated Equity');
    pdf.drawTable(
      [
        { header: 'Liability / Equity Account', width: 370 },
        { header: `Amount (${tenant.currency})`, width: 150, align: 'right' },
      ],
      [
        {
          cells: [
            'Accounts Payable (Unpaid Supplier Vouchers)',
            formatCurrency(report.accountsPayable, tenant.currency),
          ],
        },
        ...(report.bankOverdraftLiability > 0
          ? [
              {
                cells: [
                  'Treasury / Bank Overdraft',
                  formatCurrency(report.bankOverdraftLiability, tenant.currency),
                ],
              },
            ]
          : []),
        {
          cells: [
            'Accumulated Operating Surplus / (Deficit)',
            formatCurrency(report.accumulatedSurplusEquity, tenant.currency),
          ],
        },
        {
          cells: [
            'TOTAL LIABILITIES & NET EQUITY',
            formatCurrency(report.totalLiabilitiesAndEquity, tenant.currency),
          ],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );
  } else if (activeBook === 'trial-balance') {
    pdf.drawTable(
      [
        { header: 'Code', width: 65 },
        { header: 'Ledger Account Name', width: 205 },
        { header: 'Class', width: 70 },
        { header: `Debit (${tenant.currency})`, width: 90, align: 'right' },
        { header: `Credit (${tenant.currency})`, width: 90, align: 'right' },
      ],
      [
        ...report.trialBalanceRows.map((row) => ({
          cells: [
            row.accountCode,
            row.accountName,
            row.accountType,
            row.debit > 0 ? formatCurrency(row.debit, tenant.currency) : '-',
            row.credit > 0 ? formatCurrency(row.credit, tenant.currency) : '-',
          ],
        })),
        {
          cells: [
            '',
            'TRIAL BALANCE CONTROL TOTALS',
            '',
            formatCurrency(report.trialBalanceTotalDebits, tenant.currency),
            formatCurrency(report.trialBalanceTotalCredits, tenant.currency),
          ],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );
  } else if (activeBook === 'cash-flow') {
    pdf.drawTable(
      [
        { header: 'Settlement Channel', width: 160 },
        { header: 'Fee Cash Inflows', width: 120, align: 'right' },
        { header: 'Expense Cash Outflows', width: 120, align: 'right' },
        { header: 'Net Channel Balance', width: 120, align: 'right' },
      ],
      [
        ...report.cashChannelLines.map((ch) => ({
          cells: [
            ch.method,
            formatCurrency(ch.inflows, tenant.currency),
            formatCurrency(ch.outflows, tenant.currency),
            formatCurrency(ch.netBalance, tenant.currency),
          ],
        })),
        {
          cells: [
            'NET OPERATING CASH POSITION',
            formatCurrency(report.totalCashCollected, tenant.currency),
            formatCurrency(report.totalPaidExpenses, tenant.currency),
            formatCurrency(report.netCashPosition, tenant.currency),
          ],
          style: { bold: true, fillRgb: [241, 245, 249] },
        },
      ]
    );
  } else if (activeBook === 'cashbook') {
    pdf.drawTable(
      [
        { header: 'Date', width: 70 },
        { header: 'Receipt / Voucher', width: 105 },
        { header: 'Counterparty & Account', width: 175 },
        { header: 'Channel & Docs', width: 145 },
        { header: 'Cash In', width: 85, align: 'right' },
        { header: 'Cash Out', width: 85, align: 'right' },
        { header: 'Running Cash', width: 95, align: 'right' },
      ],
      report.cashbookEntries.map((entry) => ({
        cells: [
          formatDateShort(entry.entryDate),
          `${entry.voucherOrReceipt} (${entry.status})`,
          `${entry.counterparty} | ${entry.account}`,
          `${entry.method} | ${entry.supportingDocsLabel}`,
          entry.cashIn > 0 ? formatCurrency(entry.cashIn, tenant.currency) : '-',
          entry.cashOut > 0 ? formatCurrency(entry.cashOut, tenant.currency) : '-',
          formatCurrency(entry.runningCashBalance, tenant.currency),
        ],
      })),
      { fontSize: 7.5 }
    );
  } else if (scheduleTab === 'debtors') {
    pdf.drawTable(
      [
        { header: 'Invoice', width: 95 },
        { header: 'Student', width: 185 },
        { header: 'Due Date & Aging', width: 140 },
        { header: 'Billed', width: 110, align: 'right' },
        { header: 'Paid', width: 110, align: 'right' },
        { header: 'Balance Due', width: 120, align: 'right' },
      ],
      report.debtorsSchedule.map((row) => ({
        cells: [
          row.invoiceNumber,
          `${row.studentName} (${row.studentCode} | ${row.grade})`,
          `${formatDateShort(row.dueDate)} (${row.agingBucket})`,
          formatCurrency(row.totalBilled, tenant.currency),
          formatCurrency(row.paidAmount, tenant.currency),
          formatCurrency(row.balanceDue, tenant.currency),
        ],
      })),
      { fontSize: 7.8 }
    );
  } else {
    pdf.drawTable(
      [
        { header: 'Voucher & Date', width: 105 },
        { header: 'Vendor & Description', width: 225 },
        { header: 'Status', width: 85 },
        { header: 'Supporting Document Audit', width: 225 },
        { header: 'Amount', width: 120, align: 'right' },
      ],
      report.payablesAndAuditSchedule.map((row) => ({
        cells: [
          `${row.voucherNumber} (${formatDateShort(row.expenseDate)})`,
          `${row.title} | ${row.vendor} (${row.category})`,
          row.status,
          row.attachmentsCount > 0
            ? `${row.attachmentsCount} attached: ${row.attachmentNames}`
            : 'Missing supporting receipt',
          formatCurrency(row.amount, tenant.currency),
        ],
      })),
      { fontSize: 7.8 }
    );
  }

  const fileName = `${tenant.slug}-${safeFileSlug(activeBook)}-${report.asOfDate}.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | ${titles[activeBook]} | As of ${report.asOfDate}`
  );
  return fileName;
}

/* ============================================================================
 * 7. DEPARTMENTAL BUDGET TRACKING & APPROVAL REPORT PDF (BudgetTrackingPanel)
 * ============================================================================ */

export interface BudgetReportPdfInput {
  tenant: Tenant;
  fiscalYear: string;
  term: string;
  totals: {
    approvedAllocated: number;
    approvedCount: number;
    pendingAllocated: number;
    pendingCount: number;
    paid: number;
    committed: number;
    remaining: number;
  };
  rows: Array<{
    category: string;
    fiscalYear: string;
    term: string;
    status: string;
    allocated: number;
    paid: number;
    committed: number;
    remaining: number;
    utilPct: number;
    approvedBy?: string;
    notes?: string;
  }>;
}

export async function downloadBudgetReportPdf(input: BudgetReportPdfInput): Promise<string> {
  const { tenant, fiscalYear, term, totals, rows } = input;
  const pdf = new BrandedPdfCanvas(tenant, 'landscape');
  await pdf.drawHeader(
    tenant,
    'DEPARTMENTAL BUDGET TRACKING & APPROVAL SCHEDULE',
    `${fiscalYear} | ${term} | Per-votehead ceilings & sign-off register`,
    [
      { label: 'Currency', value: tenant.currency },
      { label: 'Approved Lines', value: `${totals.approvedCount} / ${rows.length}` },
      { label: 'Fiscal Scope', value: `${fiscalYear} ${term}` },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: `Approved Budget (${totals.approvedCount})`,
      value: formatCurrency(totals.approvedAllocated, tenant.currency),
      accent: 'emerald',
    },
    {
      label: `Pending Approval (${totals.pendingCount})`,
      value: formatCurrency(totals.pendingAllocated, tenant.currency),
      accent: 'amber',
    },
    {
      label: 'Disbursed + Committed',
      value: formatCurrency(totals.paid + totals.committed, tenant.currency),
      accent: 'rose',
    },
    {
      label: 'Available Headroom',
      value: formatCurrency(totals.remaining, tenant.currency),
      accent: totals.remaining >= 0 ? 'emerald' : 'rose',
    },
  ]);

  pdf.drawTable(
    [
      { header: 'Cost Centre / Budget Line', width: 175 },
      { header: 'Period', width: 90 },
      { header: 'Approval Status', width: 105 },
      { header: 'Ceiling', width: 90, align: 'right' },
      { header: 'Paid Actual', width: 85, align: 'right' },
      { header: 'Committed', width: 80, align: 'right' },
      { header: 'Available', width: 85, align: 'right' },
      { header: 'Util %', width: 55, align: 'right' },
    ],
    rows.map((r) => ({
      cells: [
        r.notes ? `${r.category} (${r.notes})` : r.category,
        `${r.fiscalYear} ${r.term}`,
        r.approvedBy ? `${r.status} (${r.approvedBy})` : r.status,
        formatCurrency(r.allocated, tenant.currency),
        formatCurrency(r.paid, tenant.currency),
        formatCurrency(r.committed, tenant.currency),
        formatCurrency(r.remaining, tenant.currency),
        `${r.utilPct.toFixed(1)}%`,
      ],
    })),
    { fontSize: 7.8 }
  );

  const fileName = `${tenant.slug}-budget-report-${safeFileSlug(fiscalYear)}-${safeFileSlug(
    term
  )}.pdf`;
  pdf.saveWithFooters(fileName, `${tenant.name} | Budget Tracking (${fiscalYear} ${term})`);
  return fileName;
}

/* ============================================================================
 * 8. TEACHER ACADEMICS PDFS (Scheme of Work, Lesson Plan, Record of Work, Parent Summary)
 * ============================================================================ */

export async function downloadSchemeOfWorkPdf(
  tenant: Tenant,
  scheme: SchemeOfWork
): Promise<string> {
  const pdf = new BrandedPdfCanvas(tenant, 'landscape');
  await pdf.drawHeader(
    tenant,
    `SCHEME OF WORK: ${scheme.title}`,
    `${scheme.grade} (${scheme.section}) | ${scheme.subject} | Reference: ${
      scheme.referenceBook || 'KICD CBC Syllabus'
    }`,
    [
      { label: 'Teacher', value: scheme.teacherName },
      { label: 'Term', value: `${scheme.academicYear} ${scheme.term}` },
      { label: 'Status', value: scheme.status },
    ]
  );

  if (scheme.reviewFeedback) {
    pdf.drawKeyValuePanel(
      `Academic Review Feedback (${scheme.reviewedByName || 'Admin'})`,
      scheme.reviewFeedback,
      'slate'
    );
  }

  pdf.drawTable(
    [
      { header: 'Wk', width: 32, align: 'center' },
      { header: 'Strand & Sub-Strand', width: 145 },
      { header: 'Specific Learning Outcomes', width: 205 },
      { header: 'Learning Activities & Resources', width: 245 },
      { header: 'Assessment', width: 135 },
    ],
    scheme.weeks.map((wk) => ({
      cells: [
        wk.weekNumber,
        `${wk.strand}\n${wk.subStrand}`,
        wk.keyInquiryQuestion
          ? `${wk.learningOutcomes}\nInquiry: ${wk.keyInquiryQuestion}`
          : wk.learningOutcomes,
        `${wk.learningActivities}\nResources: ${wk.resources}`,
        wk.assessmentMethod,
      ],
    })),
    { fontSize: 7.8 }
  );

  const fileName = `${tenant.slug}-scheme-${safeFileSlug(scheme.grade)}-${safeFileSlug(
    scheme.subject
  )}.pdf`;
  pdf.saveWithFooters(fileName, `${tenant.name} | Scheme of Work | ${scheme.subject}`);
  return fileName;
}

export async function downloadLessonPlanPdf(
  tenant: Tenant,
  plan: LessonPlan
): Promise<string> {
  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    `CBC LESSON PLAN: ${plan.lessonTitle}`,
    `${plan.grade} (${plan.section}) | ${plan.subject} | Status: ${plan.status}`,
    [
      { label: 'Teacher', value: plan.teacherName },
      { label: 'Week / Date', value: `Wk ${plan.weekNumber} (${plan.lessonDate})` },
      { label: 'Duration', value: `${plan.durationMinutes} min` },
    ]
  );

  pdf.drawKpiGrid([
    { label: 'Strand', value: plan.strand },
    { label: 'Sub-Strand', value: plan.subStrand },
    { label: 'Resources', value: plan.learningResources || 'Standard CBC Kit' },
  ]);

  pdf.drawKeyValuePanel('Specific Learning Outcomes', plan.learningOutcomes);
  pdf.drawKeyValuePanel('1. Lesson Introduction', plan.introductionActivity);
  pdf.drawKeyValuePanel('2. Lesson Development', plan.lessonDevelopment);
  pdf.drawKeyValuePanel('3. Conclusion & Assessment', plan.conclusionActivity);
  if (plan.extendedHomework) {
    pdf.drawKeyValuePanel('Extended Homework / Parent Follow-Up', plan.extendedHomework, 'blue');
  }
  if (plan.teacherReflection) {
    pdf.drawKeyValuePanel('Private Teacher Reflection (Internal Staff)', plan.teacherReflection);
  }

  const fileName = `${tenant.slug}-lesson-plan-wk${plan.weekNumber}-${safeFileSlug(
    plan.subject
  )}.pdf`;
  pdf.saveWithFooters(fileName, `${tenant.name} | CBC Lesson Plan | ${plan.subject}`);
  return fileName;
}

export async function downloadRecordOfWorkPdf(
  tenant: Tenant,
  record: RecordOfWork
): Promise<string> {
  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    `RECORD OF WORK COVERED (WEEK ${record.weekNumber})`,
    `${record.grade} (${record.section}) | ${record.subject} | Status: ${record.status}`,
    [
      { label: 'Teacher', value: record.teacherName },
      { label: 'Date Covered', value: record.dateCovered },
      {
        label: 'Lessons Taught',
        value: `${record.lessonsTaughtCount}${
          record.lessonsPlannedCount ? ` / ${record.lessonsPlannedCount}` : ''
        }`,
      },
    ]
  );

  pdf.drawKpiGrid([
    { label: 'Strand & Sub-Strand', value: `${record.strand} - ${record.subStrand}` },
    { label: 'Coverage Status', value: record.coverageStatus, accent: 'blue' },
    { label: 'Learner Mastery', value: record.learnerMastery, accent: 'emerald' },
  ]);

  pdf.drawKeyValuePanel('Actual Work Covered', record.workCovered);
  if (record.parentSummary) {
    pdf.drawKeyValuePanel('Parent Learning Summary', record.parentSummary, 'blue');
  }
  if (record.challengesAndRemediation) {
    pdf.drawKeyValuePanel(
      'Challenges & Remediation Plan (Internal)',
      record.challengesAndRemediation
    );
  }

  const fileName = `${tenant.slug}-record-of-work-wk${record.weekNumber}-${safeFileSlug(
    record.subject
  )}.pdf`;
  pdf.saveWithFooters(fileName, `${tenant.name} | Record of Work | ${record.subject}`);
  return fileName;
}

export async function downloadParentCurriculumSummaryPdf(
  tenant: Tenant,
  student: Student,
  schemes: SchemeOfWork[],
  lessonPlans: LessonPlan[],
  recordsOfWork: RecordOfWork[]
): Promise<string> {
  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    'CURRICULUM ROADMAP & WEEKLY LESSON HIGHLIGHTS',
    `${student.fullName} (${student.studentCode}) | ${student.grade} Stream ${student.section}`,
    [
      { label: 'Academic Year', value: tenant.academicYear },
      { label: 'Term', value: tenant.currentTerm },
      { label: 'Shared Schemes', value: String(schemes.length) },
    ]
  );

  pdf.drawSectionTitle('Published Schemes of Work', `${schemes.length} Subject(s)`);
  pdf.drawTable(
    [
      { header: 'Subject', width: 120 },
      { header: 'Scheme Title', width: 195 },
      { header: 'Teacher', width: 115 },
      { header: 'Weeks Planned', width: 90, align: 'right' },
    ],
    schemes.map((s) => ({
      cells: [s.subject, s.title, s.teacherName, `${s.weeks.length} week(s)`],
    })),
    { fontSize: 8, emptyText: 'No published schemes shared yet.' }
  );

  if (recordsOfWork.length > 0) {
    pdf.drawSectionTitle('Recent Record of Work Highlights', `${recordsOfWork.length} Entry(s)`);
    pdf.drawTable(
      [
        { header: 'Wk', width: 32, align: 'center' },
        { header: 'Subject', width: 105 },
        { header: 'Strand & Coverage', width: 135 },
        { header: 'Summary for Parents / Guardians', width: 248 },
      ],
      recordsOfWork.slice(0, 20).map((r) => ({
        cells: [
          r.weekNumber,
          r.subject,
          `${r.strand} (${r.coverageStatus})`,
          r.parentSummary || r.workCovered,
        ],
      })),
      { fontSize: 8 }
    );
  }

  if (lessonPlans.length > 0) {
    pdf.drawSectionTitle('Shared Lesson Highlights & Homework', `${lessonPlans.length} Plan(s)`);
    pdf.drawTable(
      [
        { header: 'Wk / Date', width: 78 },
        { header: 'Subject', width: 105 },
        { header: 'Lesson Title', width: 155 },
        { header: 'Extended Homework / Outcomes', width: 182 },
      ],
      lessonPlans.slice(0, 20).map((lp) => ({
        cells: [
          `Wk ${lp.weekNumber} ${lp.lessonDate}`,
          lp.subject,
          lp.lessonTitle,
          lp.extendedHomework || lp.learningOutcomes,
        ],
      })),
      { fontSize: 8 }
    );
  }

  const fileName = `${tenant.slug}-curriculum-summary-${safeFileSlug(student.studentCode)}.pdf`;
  pdf.saveWithFooters(fileName, `${tenant.name} | Curriculum Roadmap | ${student.fullName}`);
  return fileName;
}

/* ============================================================================
 * 9. OFFICIAL TEACHER LEAVE OUT CHIT WITH DUTIES DELEGATION PDF (AttendanceModule)
 * ============================================================================ */

export async function downloadTeacherLeaveChitPdf(
  tenant: Tenant,
  chit: TeacherLeaveOutChit
): Promise<string> {
  const expectedBack = (() => {
    const [y, m, d] = chit.endDate.split('-').map(Number);
    if (!y || !m || !d) return chit.endDate;
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return dt.toISOString().slice(0, 10);
  })();

  const pdf = new BrandedPdfCanvas(tenant, 'portrait');
  await pdf.drawHeader(
    tenant,
    'OFFICIAL TEACHER LEAVE OUT CHIT & DUTIES DELEGATION',
    `Issued: ${formatDateShort(chit.createdAt.slice(0, 10))} | Department: ${chit.department}`,
    [
      { label: 'Chit Ref', value: chit.id.toUpperCase() },
      { label: 'Duration', value: `${chit.days} Day${chit.days === 1 ? '' : 's'}` },
      { label: 'Expected Back', value: formatDateShort(expectedBack) },
    ]
  );

  pdf.drawKpiGrid([
    {
      label: 'Teacher on Leave',
      value: chit.teacherName,
      note: chit.department,
    },
    {
      label: 'Leave Window',
      value: `${formatDateShort(chit.startDate)} -> ${formatDateShort(chit.endDate)}`,
      note: `${chit.days} working day(s) | Resumes ${formatDateShort(expectedBack)}`,
      accent: 'amber',
    },
    {
      label: 'Delegated Duties',
      value: `${chit.dutiesDelegations.length} Mandate${
        chit.dutiesDelegations.length === 1 ? '' : 's'
      }`,
      note: 'All classes & duties covered',
      accent: 'blue',
    },
    {
      label: 'Authorized By',
      value: chit.issuedBy,
      note: chit.emergencyContact ? `Tel: ${chit.emergencyContact}` : 'School Administration',
    },
  ]);

  pdf.drawKeyValuePanel('Reason for Absence / Official Leave Authorization', chit.reason, 'slate');

  pdf.drawSectionTitle(
    'Delegated Duties & Teaching Mandate Schedule',
    `${chit.dutiesDelegations.length} Assigned Mandate(s)`
  );
  pdf.drawTable(
    [
      { header: '#', width: 28, align: 'center' },
      { header: 'Duty / Lesson Delegated', width: 145 },
      { header: 'Mandate Holder (Covering Teacher)', width: 135 },
      { header: 'Class / Schedule', width: 92 },
      { header: 'Handover Instructions', width: 120 },
    ],
    chit.dutiesDelegations.map((del, idx) => ({
      cells: [
        idx + 1,
        del.dutyTitle,
        `${del.delegateTeacherName}${del.delegateDepartment ? `\n(${del.delegateDepartment})` : ''}`,
        [
          del.grade ? `${del.grade}${del.section ? ` ${del.section}` : ''}` : '',
          del.scheduleOrWindow || '',
        ]
          .filter(Boolean)
          .join('\n') || 'Full Leave Period',
        del.handoverInstructions || 'Follow scheme & weekly lesson notes.',
      ],
    })),
    { fontSize: 8 }
  );

  if (chit.handoverNotes) {
    pdf.drawKeyValuePanel('General Handover & Materials Location', chit.handoverNotes, 'blue');
  }

  pdf.ensureSpace(72);
  pdf.y += 14;
  pdf.doc.setFont('helvetica', 'normal');
  pdf.doc.setFontSize(8.5);
  pdf.doc.setTextColor(71, 85, 105);
  pdf.doc.text('Applicant Teacher Signature: _____________________', pdf.margin, pdf.y);
  pdf.doc.text(
    'Delegate Acceptance: _____________________',
    pdf.pageWidth - pdf.margin,
    pdf.y,
    { align: 'right' }
  );
  pdf.y += 26;
  pdf.doc.text(`Authorized By (${pdfText(chit.issuedBy)}): _____________________`, pdf.margin, pdf.y);
  pdf.doc.text('Official School Stamp: _____________________', pdf.pageWidth - pdf.margin, pdf.y, {
    align: 'right',
  });

  const fileName = `${tenant.slug}-teacher-leave-chit-${safeFileSlug(chit.teacherName)}-${
    chit.startDate
  }.pdf`;
  pdf.saveWithFooters(
    fileName,
    `${tenant.name} | Teacher Leave Out Chit & Duties Delegation | ${chit.teacherName}`
  );
  return fileName;
}
