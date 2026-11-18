import { formatCurrency, formatDateShort } from './format';
import type {
  AdmissionApplication,
  CurrencyCode,
  ExamCycle,
  FeeInvoice,
  Student,
  Tenant,
} from '../shared/types';

export interface ResolvedGuardianContact {
  guardianName: string;
  guardianPhone: string;
  whatsappDigits: string;
  hasValidWhatsApp: boolean;
  source: 'student' | 'admission' | 'none';
}

/**
 * Normalizes a recorded phone number into E.164 digits (without '+') suitable for https://wa.me/<digits>.
 * Handles Kenyan local mobile formats (07xx / 01xx -> 2547xx / 2541xx) as well as international numbers (+254..., +1...).
 */
export function normalizeWhatsAppDigits(rawPhone: string | undefined | null): string {
  if (!rawPhone) return '';
  const trimmed = rawPhone.trim();
  if (!trimmed) return '';

  // Keep leading '+' decision and strip all non-digits
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (!hasPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (digits.startsWith('0') && (digits.length === 10 || digits.length === 9)) {
      digits = `254${digits.slice(1)}`;
    } else if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) {
      digits = `254${digits}`;
    }
  } else if (digits.startsWith('2540') && digits.length === 13) {
    digits = `254${digits.slice(4)}`;
  }

  return digits.length >= 9 ? digits : '';
}

export function buildWhatsAppUrl(rawPhone: string | undefined | null, message: string): string {
  const digits = normalizeWhatsAppDigits(rawPhone);
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function resolveStudentGuardianContact(
  student: Pick<Student, 'fullName' | 'guardianName' | 'guardianPhone'> | undefined | null,
  admissions: Array<Pick<AdmissionApplication, 'studentName' | 'guardianName' | 'guardianPhone'>> = []
): ResolvedGuardianContact {
  if (!student) {
    return {
      guardianName: 'Parent / Guardian',
      guardianPhone: '',
      whatsappDigits: '',
      hasValidWhatsApp: false,
      source: 'none',
    };
  }

  const studentDigits = normalizeWhatsAppDigits(student.guardianPhone);
  if (studentDigits) {
    return {
      guardianName: student.guardianName?.trim() || 'Parent / Guardian',
      guardianPhone: student.guardianPhone.trim(),
      whatsappDigits: studentDigits,
      hasValidWhatsApp: true,
      source: 'student',
    };
  }

  const normalizedName = student.fullName.trim().toLowerCase();
  const admissionMatch = admissions.find(
    (adm) =>
      adm.studentName.trim().toLowerCase() === normalizedName &&
      Boolean(normalizeWhatsAppDigits(adm.guardianPhone))
  );

  if (admissionMatch) {
    const admDigits = normalizeWhatsAppDigits(admissionMatch.guardianPhone);
    return {
      guardianName:
        student.guardianName?.trim() || admissionMatch.guardianName?.trim() || 'Parent / Guardian',
      guardianPhone: admissionMatch.guardianPhone.trim(),
      whatsappDigits: admDigits,
      hasValidWhatsApp: Boolean(admDigits),
      source: 'admission',
    };
  }

  return {
    guardianName: student.guardianName?.trim() || 'Parent / Guardian',
    guardianPhone: student.guardianPhone?.trim() || '',
    whatsappDigits: '',
    hasValidWhatsApp: false,
    source: 'none',
  };
}

export interface ReportCardWhatsAppSubjectRow {
  subject: string;
  score: number;
  maxScore: number;
  letterGrade: string;
  remarks?: string;
}

export function buildReportCardWhatsAppMessage(params: {
  tenant: Pick<Tenant, 'name' | 'currentTerm'>;
  cycle: Pick<ExamCycle, 'title' | 'term'>;
  student: Pick<Student, 'fullName' | 'studentCode' | 'grade' | 'section'>;
  guardianName: string;
  subjects: ReportCardWhatsAppSubjectRow[];
  totalMarks: number;
  maxPossible: number;
  avgScore: number;
  meanGrade: string;
  meanPoints: string;
  maxPoints: number;
  overallRank: number | null;
  totalRanked: number;
  customNote?: string;
}): string {
  const {
    tenant,
    cycle,
    student,
    guardianName,
    subjects,
    totalMarks,
    maxPossible,
    avgScore,
    meanGrade,
    meanPoints,
    maxPoints,
    overallRank,
    totalRanked,
    customNote,
  } = params;

  const subjectLines =
    subjects.length > 0
      ? subjects
          .map(
            (sub, idx) =>
              `${idx + 1}. ${sub.subject}: ${sub.score}/${sub.maxScore} (${sub.letterGrade})`
          )
          .join('\n')
      : 'No subject scores recorded yet for this assessment cycle.';

  const positionLine =
    overallRank !== null && totalRanked > 0 ? `#${overallRank} out of ${totalRanked}` : 'Pending';

  const lines = [
    `*${tenant.name.toUpperCase()} — ACADEMIC REPORT CARD*`,
    `Assessment: ${cycle.title} (${cycle.term || tenant.currentTerm})`,
    '',
    `Dear ${guardianName || 'Parent / Guardian'},`,
    `Please find below the academic performance report for *${student.fullName}* (${student.studentCode} · ${student.grade} Stream ${student.section}):`,
    '',
    `*Overall Summary*`,
    `• Total Marks: ${totalMarks} / ${maxPossible} (${avgScore}%)`,
    `• Overall Grade: ${meanGrade} (${meanPoints}/${maxPoints} pts)`,
    `• Class Position: ${positionLine}`,
    '',
    `*Subject Breakdown*`,
    subjectLines,
  ];

  if (customNote && customNote.trim()) {
    lines.push('', `*Teacher / Principal Note:* ${customNote.trim()}`);
  }

  lines.push('', `Regards,`, `${tenant.name} Academic Office`);
  return lines.join('\n');
}

export function buildFeeReminderWhatsAppMessage(params: {
  tenant: Pick<Tenant, 'name' | 'currency' | 'currentTerm' | 'mpesaConfig'>;
  invoice: FeeInvoice;
  guardianName: string;
  customNote?: string;
}): string {
  const { tenant, invoice, guardianName, customNote } = params;
  const currency: CurrencyCode = tenant.currency;
  const formattedBalance = formatCurrency(invoice.balance, currency);
  const formattedTotal = formatCurrency(invoice.totalAmount, currency);
  const formattedPaid = formatCurrency(invoice.paidAmount, currency);
  const paybill = tenant.mpesaConfig?.enabled ? tenant.mpesaConfig.paybillNumber : '';
  const paybillAccountName = tenant.mpesaConfig?.accountName || tenant.name;

  const lines = [
    `*${tenant.name.toUpperCase()} — FEE BALANCE REMINDER*`,
    '',
    `Dear ${guardianName || 'Parent / Guardian'},`,
    `This is a kind reminder to complete the outstanding school fee balance for *${invoice.studentName}* (${invoice.studentCode} · ${invoice.grade}).`,
    '',
    `• Student Name: *${invoice.studentName}*`,
    `• Invoice Number: ${invoice.invoiceNumber} (${invoice.term})`,
    `• Total Billed: ${formattedTotal}`,
    `• Amount Paid: ${formattedPaid}`,
    `• *Fee Balance Due: ${formattedBalance}*`,
    `• Due Date: ${formatDateShort(invoice.dueDate)}`,
  ];

  if (paybill) {
    lines.push(
      `• *M-Pesa Paybill:* ${paybill} (${paybillAccountName}) · Account No: *${invoice.studentCode}*`
    );
  }

  if (customNote && customNote.trim()) {
    lines.push('', `*Note:* ${customNote.trim()}`);
  } else if (paybill) {
    lines.push(
      '',
      `Kindly settle the *${formattedBalance}* balance via *M-Pesa Paybill ${paybill}*, Account Number *${invoice.studentCode}*, at your earliest convenience.`
    );
  } else {
    lines.push(
      '',
      `Kindly arrange settlement of the *${formattedBalance}* balance at your earliest convenience via M-Pesa Paybill or Bank Transfer, quoting *${invoice.studentCode}*.`
    );
  }

  lines.push('', `Thank you for your continued support.`, `${tenant.name} Bursar Office`);
  return lines.join('\n');
}
