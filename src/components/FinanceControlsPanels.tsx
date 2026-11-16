import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Paperclip,
  PiggyBank,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatCurrency, formatDateShort } from '../lib/format';
import {
  APPROVAL_COMMITTEES,
  EXPENSE_ATTACHMENT_TYPES,
  EXPENSE_CATEGORIES,
  type ApprovalCommittee,
  type ApprovalDecision,
  type ApprovalSignOffRecord,
  type ExpenseAttachmentType,
  type ExpenseCategory,
  type PaymentMethod,
  type PayrollEntry,
  type PayrollStatus,
  type ReconciliationChannel,
  type ReconciliationLine,
  type ReconciliationStatus,
  type TenantWorkspaceData,
} from '../shared/types';

interface PanelProps {
  workspace: TenantWorkspaceData;
  canManage: boolean;
  actorRole: string;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read file'));
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function enhanceImageCanvasAsScan(img: HTMLImageElement): string {
  const maxWidth = 1400;
  const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img.src;
  ctx.filter = 'grayscale(100%) contrast(145%) brightness(106%)';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.86);
}

// ============================================================================
// 1. RECEIPT SCAN & UPLOAD PANEL
// ============================================================================
export function ReceiptScannerPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const expenses = workspace.expenses || [];

  const [targetMode, setTargetMode] = useState<'attach' | 'create'>('attach');
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>(expenses[0]?.id || '');
  const [docType, setDocType] = useState<ExpenseAttachmentType>('Official Receipt');
  const [scannedName, setScannedName] = useState('');
  const [scannedMime, setScannedMime] = useState('image/jpeg');
  const [scannedSize, setScannedSize] = useState(0);
  const [scannedDataUrl, setScannedDataUrl] = useState('');
  const [applyScanFilter, setApplyScanFilter] = useState(true);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Quick text / QR parser -> create expense fields
  const [rawScanText, setRawScanText] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newVendor, setNewVendor] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState<ExpenseCategory>('Administration & Statutory');
  const [newMethod, setNewMethod] = useState<PaymentMethod>('Mobile Money');
  const [newReference, setNewReference] = useState('');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedExpenseId && expenses.length > 0) {
      setSelectedExpenseId(expenses[0].id);
    }
  }, [expenses, selectedExpenseId]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startCamera() {
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Live camera API is unavailable in this browser. Use Upload / Mobile Camera below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera access denied or unavailable (${err.message}). Use file upload instead.`
          : 'Unable to open camera. Use file upload instead.'
      );
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  function captureCameraFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      onNotify('Camera stream is still initializing. Try again in a second.', 'error');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (applyScanFilter) {
      ctx.filter = 'grayscale(100%) contrast(145%) brightness(106%)';
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setScannedDataUrl(dataUrl);
    setScannedMime('image/jpeg');
    setScannedName(`scan-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-4)}.jpg`);
    setScannedSize(Math.round((dataUrl.length * 3) / 4));
    stopCamera();
    onNotify('Captured document scan frame.');
  }

  async function handlePickedFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 2.4 * 1024 * 1024) {
      onNotify(`"${file.name}" exceeds the 2.4 MB limit.`, 'error');
      return;
    }
    try {
      const rawUrl = await readFileAsDataUrl(file);
      if (applyScanFilter && file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          const enhanced = enhanceImageCanvasAsScan(img);
          setScannedDataUrl(enhanced);
          setScannedMime('image/jpeg');
          setScannedName(file.name.replace(/\.[^.]+$/, '') + '-scanned.jpg');
          setScannedSize(Math.round((enhanced.length * 3) / 4));
          onNotify(`Loaded & enhanced scan for ${file.name}.`);
        };
        img.onerror = () => {
          setScannedDataUrl(rawUrl);
          setScannedMime(file.type || 'application/octet-stream');
          setScannedName(file.name);
          setScannedSize(file.size);
        };
        img.src = rawUrl;
      } else {
        setScannedDataUrl(rawUrl);
        setScannedMime(file.type || 'application/octet-stream');
        setScannedName(file.name);
        setScannedSize(file.size);
        onNotify(`Loaded supporting document ${file.name}.`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to read file', 'error');
    }
  }

  function handleParseReceiptText() {
    const txt = rawScanText.trim();
    if (!txt) {
      onNotify('Paste an M-Pesa confirmation SMS, receipt text, or eTIMS text snippet to extract fields.', 'error');
      return;
    }
    const refMatch = txt.match(/\b([A-Z0-9]{10})\s+Confirmed\b/i) || txt.match(/\b(?:Ref|Receipt|CU|Inv(?:oice)?)[:#\s-]*([A-Z0-9-]{6,22})/i);
    const amtMatch = txt.match(/(?:Ksh|KES|USD|\$)\s*([\d,]+(?:\.\d{1,2})?)/i) || txt.match(/Total[:\s]*([\d,]+(?:\.\d{1,2})?)/i);
    const paidToMatch = txt.match(/paid\s+to\s+([A-Za-z0-9 &.'-]+?)(?:\s+on|\s+at|\.|$)/i);
    const dateMatch = txt.match(/\b(\d{4}-\d{2}-\d{2})\b/);

    if (refMatch) setNewReference(refMatch[1].toUpperCase());
    if (amtMatch) setNewAmount(String(Math.round(Number(amtMatch[1].replace(/,/g, '')))));
    if (paidToMatch) {
      const v = paidToMatch[1].trim();
      setNewVendor(v);
      if (!newTitle) setNewTitle(`Payment to ${v}`);
    }
    if (dateMatch) setNewDate(dateMatch[1]);
    setTargetMode('create');
    onNotify('Extracted receipt fields into New Expense Voucher form.');
  }

  async function handleSubmitScan(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to save scanned documents.', 'error');
      return;
    }
    if (!scannedDataUrl || !scannedName) {
      onNotify('Capture a camera scan or upload a receipt/voucher file first.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (targetMode === 'attach') {
        if (!selectedExpenseId) {
          onNotify('Select an expense voucher to attach this scan to.', 'error');
          return;
        }
        await saasApi.addExpenseAttachment(tenant.id, selectedExpenseId, {
          fileName: scannedName,
          mimeType: scannedMime,
          fileSize: scannedSize,
          docType,
          dataUrl: scannedDataUrl,
          uploadedBy: `${actorRole} Scanner`,
        });
        onNotify(`Attached scanned ${docType} (${scannedName}) to voucher.`);
      } else {
        const amt = Math.round(Number(newAmount));
        if (!newTitle.trim() || !newVendor.trim() || !Number.isFinite(amt) || amt <= 0) {
          onNotify('Enter title, vendor, and positive amount for the new expense voucher.', 'error');
          return;
        }
        const res = await saasApi.createExpense(tenant.id, {
          title: newTitle.trim(),
          category: newCategory,
          vendor: newVendor.trim(),
          amount: amt,
          paymentMethod: newMethod,
          reference: newReference.trim(),
          expenseDate: newDate,
          status: 'Pending Approval',
          recordedBy: `${actorRole} Scanner`,
          attachments: [
            {
              fileName: scannedName,
              mimeType: scannedMime,
              fileSize: scannedSize,
              docType,
              dataUrl: scannedDataUrl,
              uploadedBy: `${actorRole} Scanner`,
            },
          ],
        });
        onNotify(`Created ${res.expense.voucherNumber} with scanned ${docType}.`);
        setNewTitle('');
        setNewVendor('');
        setNewAmount('');
        setNewReference('');
      }
      setScannedDataUrl('');
      setScannedName('');
      setScannedSize(0);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save scanned document', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Document Scanner & Capture Workspace */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Receipt Scanner &amp; Supporting Document Capture
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scan paper receipts via device camera with crisp contrast enhancement or upload PDFs &amp; vouchers.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={applyScanFilter}
                onChange={(e) => setApplyScanFilter(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Auto-Enhance Scan
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Camera className="h-3.5 w-3.5" />
                Open Document Camera
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={captureCameraFrame}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  Capture Scan Frame
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Close Camera
                </button>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
              capture="environment"
              onChange={(e) => handlePickedFile(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Receipt / PDF
            </button>
          </div>

          {cameraError && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
              {cameraError}
            </p>
          )}

          {/* Camera Live Preview or Scanned Document Preview */}
          <div className="mt-4 flex min-h-[240px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/40">
            {cameraActive ? (
              <video
                ref={videoRef}
                playsInline
                muted
                className="max-h-[300px] w-full object-contain"
              />
            ) : scannedDataUrl ? (
              <div className="w-full p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {scannedName} · {formatBytes(scannedSize)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setScannedDataUrl('');
                      setScannedName('');
                      setScannedSize(0);
                    }}
                    className="text-rose-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                {scannedMime.startsWith('image/') ? (
                  <img
                    src={scannedDataUrl}
                    alt={scannedName}
                    referrerPolicy="no-referrer"
                    className="mx-auto max-h-[240px] rounded border border-slate-200 object-contain dark:border-slate-700"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-xs text-slate-600 dark:text-slate-300">
                    <FileText className="mb-2 h-8 w-8 text-blue-600" />
                    <p className="font-semibold">{scannedName}</p>
                    <p className="text-[11px] text-slate-500">Ready to attach to expense voucher</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <ScanLine className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  No receipt scanned or uploaded yet
                </p>
                <p className="mt-1">Use Open Document Camera or Upload Receipt / PDF above.</p>
              </div>
            )}
          </div>

          {/* Receipt / SMS Auto-Extraction Helper */}
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Quick Extract from M-Pesa / Receipt Text (Optional)
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={rawScanText}
                onChange={(e) => setRawScanText(e.target.value)}
                placeholder="Paste M-Pesa confirmation or receipt text e.g. UBC48KX91P Confirmed. Ksh12,000 paid to Kenya Power..."
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleParseReceiptText}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Extract Fields
              </button>
            </div>
          </div>
        </div>

        {/* Right: Attach Target Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Save Supporting Document to Ledger
            </h3>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setTargetMode('attach')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  targetMode === 'attach'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Attach to Existing Voucher
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('create')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  targetMode === 'create'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Create New Voucher
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmitScan} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Supporting Document Classification
              </label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as ExpenseAttachmentType)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {EXPENSE_ATTACHMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {dt}
                  </option>
                ))}
              </select>
            </div>

            {targetMode === 'attach' ? (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Target Expense Voucher
                </label>
                <select
                  value={selectedExpenseId}
                  onChange={(e) => setSelectedExpenseId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {expenses.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.voucherNumber} · {exp.vendor} ({formatCurrency(exp.amount, tenant.currency)}) —{' '}
                      {(exp.attachments || []).length} doc(s)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Expense Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="e.g. Stationery & Toner Purchase"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Vendor / Payee *
                    </label>
                    <input
                      type="text"
                      required
                      value={newVendor}
                      onChange={(e) => setNewVendor(e.target.value)}
                      placeholder="e.g. Text Book Centre Ltd"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Amount ({tenant.currency}) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Category
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value as ExpenseCategory)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Method
                    </label>
                    <select
                      value={newMethod}
                      onChange={(e) => setNewMethod(e.target.value as PaymentMethod)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {(['Mobile Money', 'Bank Transfer', 'Card', 'Cash'] as const).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Receipt / Transaction Ref
                    </label>
                    <input
                      type="text"
                      value={newReference}
                      onChange={(e) => setNewReference(e.target.value)}
                      placeholder="e.g. UBC48KX91P"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Expense Date
                    </label>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={!canManage || submitting || !scannedDataUrl}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {submitting
                ? 'Saving Scan...'
                : targetMode === 'attach'
                ? 'Attach Scan to Selected Voucher'
                : 'Create Expense Voucher with Scanned Receipt'}
            </button>
          </form>
        </div>
      </div>

      {/* Audit Coverage Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Voucher Supporting Document Register
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Voucher</th>
                <th className="px-4 py-2.5">Vendor &amp; Description</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Attached Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {exp.voucherNumber}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {exp.title}
                    </span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">· {exp.vendor}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(exp.amount, tenant.currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    {(exp.attachments || []).length === 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        Pending receipt / signed voucher
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(exp.attachments || []).map((att) => (
                          <a
                            key={att.id}
                            href={att.dataUrl}
                            download={att.fileName}
                            className="inline-flex items-center gap-1 text-emerald-700 underline decoration-emerald-300 hover:text-emerald-900 dark:text-emerald-400"
                          >
                            <Download className="h-3 w-3" />
                            {att.docType} ({att.fileName})
                          </a>
                        ))}
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
  );
}

// ============================================================================
// 2. KRA ETIMS RECEIPT CHECK PANEL
// ============================================================================
export function EtimsVerificationPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const expenses = workspace.expenses || [];
  const etimsChecks = workspace.etimsChecks || [];

  const [expenseId, setExpenseId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierKraPin, setSupplierKraPin] = useState('');
  const [cuInvoiceNumber, setCuInvoiceNumber] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [totalAmount, setTotalAmount] = useState('');
  const [exemptVat, setExemptVat] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleSelectExpense(nextId: string) {
    setExpenseId(nextId);
    const found = expenses.find((e) => e.id === nextId);
    if (found) {
      setSupplierName(found.vendor);
      setTotalAmount(String(found.amount));
      setReceiptDate(found.expenseDate);
      if (found.supplierKraPin) setSupplierKraPin(found.supplierKraPin);
      if (found.etimsCuNumber) setCuInvoiceNumber(found.etimsCuNumber);
    }
  }

  function handleParseQrPayload() {
    const raw = qrInput.trim();
    if (!raw) {
      onNotify('Paste an eTIMS QR link or KRA receipt text snippet first.', 'error');
      return;
    }
    const pinMatch = raw.match(/\b([AP]\d{9}[A-Z])\b/i);
    const cuMatch = raw.match(/\b(KRAMW[A-Z0-9]{6,}|0\d{10,}|\d{3}-\d{7,})\b/i);
    const amtMatch = raw.match(/(?:total|amt|kes|ksh)[=:\s]*([\d,]+(?:\.\d+)?)/i);
    if (pinMatch) setSupplierKraPin(pinMatch[1].toUpperCase());
    if (cuMatch) setCuInvoiceNumber(cuMatch[1].toUpperCase());
    if (amtMatch) setTotalAmount(String(Math.round(Number(amtMatch[1].replace(/,/g, '')))));
    onNotify('Parsed KRA eTIMS fields from QR / text payload.');
  }

  async function handleVerifyEtims(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to verify eTIMS receipts.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await saasApi.verifyEtimsReceipt(tenant.id, {
        expenseId: expenseId || undefined,
        supplierName: supplierName.trim(),
        supplierKraPin: supplierKraPin.trim(),
        cuInvoiceNumber: cuInvoiceNumber.trim(),
        receiptDate,
        totalAmount: Number(totalAmount),
        exemptVat,
        checkedBy: `${actorRole} Compliance`,
      });
      await onRefresh();
      onNotify(`eTIMS check ${res.record.cuInvoiceNumber}: ${res.record.status}.`);
      setExpenseId('');
      setSupplierName('');
      setSupplierKraPin('');
      setCuInvoiceNumber('');
      setTotalAmount('');
      setQrInput('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'eTIMS verification failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportEtimsExcel() {
    if (etimsChecks.length === 0) {
      onNotify('No eTIMS verification records to export.', 'error');
      return;
    }
    const rows = etimsChecks.map((c) => ({
      Voucher_No: c.voucherNumber || 'Standalone',
      Supplier: c.supplierName,
      Supplier_KRA_PIN: c.supplierKraPin,
      CU_Invoice_Number: c.cuInvoiceNumber,
      Receipt_Date: c.receiptDate,
      Taxable_Amount: c.taxableAmount,
      VAT_Amount: c.vatAmount,
      Total_Amount: c.totalAmount,
      Compliance_Status: c.status,
      Notes: c.verificationNotes,
      Checked_By: c.checkedBy,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'eTIMS Verification');
    XLSX.writeFile(wb, `${tenant.slug}-etims-checks-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(`Exported ${etimsChecks.length} eTIMS records to Excel.`);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* Left Verification Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            KRA eTIMS Tax Invoice Verification
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Validate supplier KRA PIN, CU serial number, and VAT compliance against school expense vouchers.
          </p>
        </div>

        <form onSubmit={handleVerifyEtims} className="mt-4 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Paste eTIMS QR Code URL / Text (Optional Auto-Fill)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="e.g. https://etims.kra.go.ke/... pin=P051482910K cu=KRAMW012026991"
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleParseQrPayload}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Parse
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Link to Expense Voucher (Optional)
            </label>
            <select
              value={expenseId}
              onChange={(e) => handleSelectExpense(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Standalone / Unlinked Receipt Check</option>
              {expenses.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.voucherNumber} · {exp.vendor} ({formatCurrency(exp.amount, tenant.currency)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Supplier Name *
              </label>
              <input
                type="text"
                required
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Registered supplier name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Supplier KRA PIN *
              </label>
              <input
                type="text"
                required
                value={supplierKraPin}
                onChange={(e) => setSupplierKraPin(e.target.value.toUpperCase())}
                placeholder="P051482910K"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                CU Invoice No. *
              </label>
              <input
                type="text"
                required
                value={cuInvoiceNumber}
                onChange={(e) => setCuInvoiceNumber(e.target.value.toUpperCase())}
                placeholder="KRAMW012026..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Total ({tenant.currency}) *
              </label>
              <input
                type="number"
                min="1"
                required
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Receipt Date
              </label>
              <input
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={exemptVat}
              onChange={(e) => setExemptVat(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Zero-rated / VAT-exempt tax supply (0% VAT)
          </label>

          <button
            type="submit"
            disabled={!canManage || submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {submitting ? 'Verifying Receipt...' : 'Verify & Record eTIMS Check'}
          </button>
        </form>
      </div>

      {/* Right Verification Register */}
      <div className="rounded-xl border border-slate-200 bg-white xl:col-span-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              eTIMS Compliance Register ({etimsChecks.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified CU tax invoices &amp; VAT breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportEtimsExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">CU Invoice &amp; PIN</th>
                <th className="px-4 py-3">Supplier &amp; Voucher</th>
                <th className="px-4 py-3 text-right">VAT</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {etimsChecks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No eTIMS receipt checks recorded yet.
                  </td>
                </tr>
              ) : (
                etimsChecks.map((chk) => (
                  <tr key={chk.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {chk.cuInvoiceNumber}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        PIN: {chk.supplierKraPin}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {chk.supplierName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {chk.voucherNumber ? `Linked: ${chk.voucherNumber}` : 'Standalone check'} ·{' '}
                        {formatDateShort(chk.receiptDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(chk.vatAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(chk.totalAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          chk.status === 'Verified'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : chk.status === 'Exempt'
                            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                        }`}
                      >
                        {chk.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {canManage && (
                        <button
                          type="button"
                          onClick={async () => {
                            await saasApi.deleteEtimsCheck(tenant.id, chk.id);
                            await onRefresh();
                            onNotify('Removed eTIMS check record.');
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
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

// ============================================================================
// 3. M-PESA & BANK STATEMENT RECONCILIATION PANEL
// ============================================================================
export function ReconciliationPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const lines = workspace.reconciliationLines || [];

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
        Account: 'Paybill 522533',
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'UBC99MP01A',
        Narration: 'TERM 1 FEE DEPOSIT',
        Direction: 'Credit',
        Amount: tenant.currency === 'KES' ? 15000 : 250,
      },
      {
        Channel: 'Bank',
        Account: 'KCB Operating A/C',
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'EFT-CAT-4410',
        Narration: 'HIGHLAND FRESH PRODUCE CO',
        Direction: 'Debit',
        Amount: tenant.currency === 'KES' ? 144000 : 1200,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
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
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
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
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
    XLSX.writeFile(wb, `${tenant.slug}-reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported M-Pesa & Bank Reconciliation to Excel.');
  }

  return (
    <div className="space-y-6">
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
        {/* Left: Add / Import Statement Lines */}
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

        {/* Right: Statement Reconciliation Table */}
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
                            onClick={async () => {
                              await saasApi.deleteReconciliationLine(tenant.id, line.id);
                              await onRefresh();
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
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
    </div>
  );
}

// ============================================================================
// 4. PAYROLL & STATUTORY DEDUCTIONS PANEL
// ============================================================================
export function PayrollDeductionsPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const payrollEntries = workspace.payrollEntries || [];

  const [payPeriod, setPayPeriod] = useState('2026-11');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [staffName, setStaffName] = useState('');
  const [staffCategory, setStaffCategory] = useState<'Teaching' | 'Non-Teaching'>('Teaching');
  const [designation, setDesignation] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [allowances, setAllowances] = useState('0');
  const [saccoOrLoan, setSaccoOrLoan] = useState('0');
  const [status, setStatus] = useState<PayrollStatus>('Draft');
  const [saving, setSaving] = useState(false);

  const scopedEntries = useMemo(
    () => payrollEntries.filter((p) => p.payPeriod === payPeriod),
    [payrollEntries, payPeriod]
  );

  const totals = useMemo(
    () =>
      scopedEntries.reduce(
        (acc, p) => {
          acc.gross += p.grossPay;
          acc.paye += p.paye;
          acc.nssf += p.nssf;
          acc.shif += p.shif;
          acc.housing += p.housingLevy;
          acc.sacco += p.saccoOrLoan;
          acc.deductions += p.totalDeductions;
          acc.net += p.netPay;
          return acc;
        },
        { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, sacco: 0, deductions: 0, net: 0 }
      ),
    [scopedEntries]
  );

  function openEditModal(entry?: PayrollEntry) {
    if (entry) {
      setEditingId(entry.id);
      setStaffName(entry.staffName);
      setStaffCategory(entry.staffCategory);
      setDesignation(entry.designation);
      setBasicSalary(String(entry.basicSalary));
      setAllowances(String(entry.allowances));
      setSaccoOrLoan(String(entry.saccoOrLoan));
      setStatus(entry.status);
    } else {
      setEditingId(undefined);
      setStaffName('');
      setStaffCategory('Teaching');
      setDesignation('');
      setBasicSalary('');
      setAllowances('0');
      setSaccoOrLoan('0');
      setStatus('Draft');
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
        status,
      });
      await onRefresh();
      setModalOpen(false);
      onNotify(`Saved payroll & statutory deductions for ${staffName.trim()}.`);
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
    const masterRows = scopedEntries.map((p) => ({
      Period: p.payPeriod,
      Staff_Name: p.staffName,
      Category: p.staffCategory,
      Designation: p.designation,
      Basic_Salary: p.basicSalary,
      Allowances: p.allowances,
      Gross_Pay: p.grossPay,
      PAYE: p.paye,
      NSSF: p.nssf,
      SHIF: p.shif,
      Housing_Levy: p.housingLevy,
      SACCO_Loan: p.saccoOrLoan,
      Total_Deductions: p.totalDeductions,
      Net_Pay: p.netPay,
      Status: p.status,
    }));
    const statutoryRows = scopedEntries.map((p) => ({
      Period: p.payPeriod,
      Staff_Name: p.staffName,
      Gross_Pay: p.grossPay,
      PAYE_KRA: p.paye,
      NSSF_Contribution: p.nssf,
      SHIF_Deduction: p.shif,
      Affordable_Housing_Levy: p.housingLevy,
      Total_Statutory_Remittance: p.paye + p.nssf + p.shif + p.housingLevy,
    }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(masterRows), 'Payroll Master');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statutoryRows), 'Statutory Returns');
    XLSX.writeFile(wb, `${tenant.slug}-payroll-statutory-${payPeriod}.xlsx`);
    onNotify(`Exported Payroll & Statutory Returns (${payPeriod}) to Excel.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Payroll &amp; Statutory Deductions
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Automated PAYE, NSSF, SHIF, Affordable Housing Levy, and SACCO / Staff Loan deductions for Teaching &amp; Non-Teaching staff.
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
              await saasApi.generatePayrollRun(tenant.id, payPeriod);
              await onRefresh();
              onNotify(`Synced all active Teaching & Non-Teaching staff into ${payPeriod} payroll.`);
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
            disabled={!canManage}
            onClick={() => openEditModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Staff Pay
          </button>
        </div>
      </div>

      {/* Statutory Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Gross Pay</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.gross, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">PAYE Tax</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(totals.paye, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">NSSF</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.nssf, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">SHIF (2.75%)</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.shif, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Housing Levy (1.5%)</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.housing, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Net Pay</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totals.net, tenant.currency)}
          </p>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-3 py-3 text-right">Gross Pay</th>
                <th className="px-3 py-3 text-right">PAYE</th>
                <th className="px-3 py-3 text-right">NSSF</th>
                <th className="px-3 py-3 text-right">SHIF</th>
                <th className="px-3 py-3 text-right">Housing</th>
                <th className="px-3 py-3 text-right">SACCO</th>
                <th className="px-3 py-3 text-right">Net Pay</th>
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
                scopedEntries.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {p.staffName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.staffCategory} · {p.designation}
                      </div>
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
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(p.saccoOrLoan, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(p.netPay, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          p.status === 'Disbursed'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : p.status === 'Approved'
                            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            Edit
                          </button>
                          {p.status !== 'Disbursed' && (
                            <button
                              type="button"
                              onClick={async () => {
                                const next: PayrollStatus =
                                  p.status === 'Draft' ? 'Approved' : 'Disbursed';
                                await saasApi.updatePayrollStatus(tenant.id, p.id, next);
                                await onRefresh();
                                onNotify(`${p.staffName} payroll marked ${next}.`);
                              }}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              {p.status === 'Draft' ? 'Approve' : 'Pay'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
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
              <div className="grid grid-cols-3 gap-3">
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
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PayrollStatus)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Approved">Approved</option>
                    <option value="Disbursed">Disbursed</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                PAYE, NSSF, SHIF, and Housing Levy are computed automatically from Gross Pay on save.
              </p>
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
                  {saving ? 'Saving...' : 'Save Payroll'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. BUDGET TRACKING PANEL
// ============================================================================
export function BudgetTrackingPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const budgets = workspace.budgets || [];
  const expenses = workspace.expenses || [];
  const payrollEntries = workspace.payrollEntries || [];

  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [draftBudget, setDraftBudget] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    const payrollDisbursed = payrollEntries
      .filter((p) => p.status === 'Disbursed')
      .reduce((s, p) => s + p.grossPay, 0);
    const payrollCommitted = payrollEntries
      .filter((p) => p.status !== 'Disbursed')
      .reduce((s, p) => s + p.grossPay, 0);

    return EXPENSE_CATEGORIES.map((category) => {
      const alloc = budgets.find((b) => b.category === category);
      const allocated = alloc?.allocatedAmount ?? 0;

      const catExpenses = expenses.filter((e) => e.category === category);
      let paid = catExpenses
        .filter((e) => e.status === 'Paid')
        .reduce((s, e) => s + e.amount, 0);
      let committed = catExpenses
        .filter((e) => e.status !== 'Paid')
        .reduce((s, e) => s + e.amount, 0);

      if (category === 'Payroll & Allowances' && paid === 0 && committed === 0) {
        paid = payrollDisbursed;
        committed = payrollCommitted;
      }

      const utilized = paid + committed;
      const remaining = allocated - utilized;
      const utilPct = allocated > 0 ? (utilized / allocated) * 100 : utilized > 0 ? 100 : 0;

      return {
        category,
        allocated,
        paid,
        committed,
        utilized,
        remaining,
        utilPct,
      };
    });
  }, [budgets, expenses, payrollEntries]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.allocated += r.allocated;
          acc.paid += r.paid;
          acc.committed += r.committed;
          acc.remaining += r.remaining;
          return acc;
        },
        { allocated: 0, paid: 0, committed: 0, remaining: 0 }
      ),
    [rows]
  );

  function handleExportBudgetExcel() {
    const sheetRows = rows.map((r) => ({
      Category: r.category,
      Allocated_Budget: r.allocated,
      Disbursed_Actual: r.paid,
      Committed_Pending: r.committed,
      Total_Utilized: r.utilized,
      Remaining_Variance: r.remaining,
      Utilization_Pct: Number(r.utilPct.toFixed(1)),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budget Variance');
    XLSX.writeFile(wb, `${tenant.slug}-budget-tracking-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported Budget vs Actuals Variance report to Excel.');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Departmental Budget Tracking &amp; Variance Controls
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tenant.academicYear} · {tenant.currentTerm} · Compares ceilings against paid vouchers, commitments, and payroll.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportBudgetExcel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <Download className="h-3.5 w-3.5" />
          Export Variance (.xlsx)
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Total Approved Budget</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.allocated, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Disbursed Actuals</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(totals.paid, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Pending Commitments</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrency(totals.committed, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Available Budget Headroom</p>
          <p
            className={`mt-1 font-mono text-lg font-bold tabular-nums ${
              totals.remaining >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {formatCurrency(totals.remaining, tenant.currency)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Cost Centre / Category</th>
                <th className="px-4 py-3 text-right">Budget Ceiling</th>
                <th className="px-4 py-3 text-right">Paid Actual</th>
                <th className="px-4 py-3 text-right">Committed</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3">Utilization</th>
                <th className="px-4 py-3 text-right">Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => {
                const isEditing = editingCategory === r.category;
                const overBudget = r.remaining < 0;
                const nearLimit = !overBudget && r.utilPct >= 85;
                return (
                  <tr key={r.category} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {r.category}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={draftBudget}
                          onChange={(e) => setDraftBudget(e.target.value)}
                          className="w-28 rounded border border-blue-400 bg-white px-2 py-1 text-right font-mono text-xs dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        formatCurrency(r.allocated, tenant.currency)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(r.paid, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {formatCurrency(r.committed, tenant.currency)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${
                        overBudget
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatCurrency(r.remaining, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 w-48">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full rounded ${
                              overBudget
                                ? 'bg-rose-600'
                                : nearLimit
                                ? 'bg-amber-500'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, r.utilPct))}%` }}
                          />
                        </div>
                        <span className="w-11 text-right font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                          {r.utilPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage &&
                        (isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                setSaving(true);
                                try {
                                  await saasApi.upsertBudgetAllocation(tenant.id, {
                                    category: r.category,
                                    allocatedAmount: Number(draftBudget),
                                  });
                                  await onRefresh();
                                  setEditingCategory(null);
                                  onNotify(`Updated ${r.category} budget ceiling.`);
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategory(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategory(r.category);
                              setDraftBudget(String(r.allocated));
                            }}
                            className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            Set Limit
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 6. BOARD / PROCUREMENT APPROVALS SIGN-OFF PANEL
// ============================================================================
export function BoardApprovalsPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const expenses = workspace.expenses || [];
  const approvals = workspace.approvalRecords || [];

  const [committee, setCommittee] = useState<ApprovalCommittee>('Board of Management (BOM)');
  const [subject, setSubject] = useState('');
  const [linkedExpenseId, setLinkedExpenseId] = useState('');
  const [amount, setAmount] = useState('');
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [minuteReference, setMinuteReference] = useState('');
  const [chairpersonName, setChairpersonName] = useState('');
  const [secretaryName, setSecretaryName] = useState('');
  const [bursarName, setBursarName] = useState('');
  const [decision, setDecision] = useState<ApprovalDecision>('Approved');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  function handleSelectExpense(expId: string) {
    setLinkedExpenseId(expId);
    const found = expenses.find((e) => e.id === expId);
    if (found) {
      setSubject(found.title);
      setAmount(String(found.amount));
    }
  }

  async function handleCreateSignOff(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      const res = await saasApi.createApprovalRecord(tenant.id, {
        committee,
        subject: subject.trim(),
        linkedExpenseId: linkedExpenseId || undefined,
        amount: Number(amount),
        meetingDate,
        minuteReference: minuteReference.trim(),
        chairpersonName: chairpersonName.trim(),
        secretaryName: secretaryName.trim(),
        bursarName: bursarName.trim() || undefined,
        decision,
        remarks: remarks.trim() || undefined,
      });
      await onRefresh();
      onNotify(`Recorded sign-off ${res.record.referenceCode} (${res.record.decision}).`);
      setSubject('');
      setLinkedExpenseId('');
      setAmount('');
      setMinuteReference('');
      setRemarks('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to record approval', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleExportApprovalsExcel() {
    if (approvals.length === 0) {
      onNotify('No approval sign-off records to export.', 'error');
      return;
    }
    const rows = approvals.map((a) => ({
      Reference_Code: a.referenceCode,
      Committee: a.committee,
      Meeting_Date: a.meetingDate,
      Minute_Reference: a.minuteReference,
      Subject: a.subject,
      Linked_Voucher: a.linkedVoucherNumber || '',
      Amount: a.amount,
      Chairperson: a.chairpersonName,
      Secretary_Principal: a.secretaryName,
      Bursar: a.bursarName,
      Decision: a.decision,
      Remarks: a.remarks || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Board Sign-Offs');
    XLSX.writeFile(wb, `${tenant.slug}-board-procurement-approvals-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported Board & Procurement Sign-Off Register to Excel.');
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* Left: Record New Sign-Off */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Board / Procurement Sign-Off Record
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Log BOM, Procurement Committee, and Principal minute authorizations. Approved linked vouchers advance automatically.
          </p>
        </div>

        <form onSubmit={handleCreateSignOff} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Authorizing Committee
            </label>
            <select
              value={committee}
              onChange={(e) => setCommittee(e.target.value as ApprovalCommittee)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {APPROVAL_COMMITTEES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Link Expense Voucher (Optional)
            </label>
            <select
              value={linkedExpenseId}
              onChange={(e) => handleSelectExpense(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">General Resolution / Non-Voucher Tender</option>
              {expenses.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.voucherNumber} · {exp.title} ({formatCurrency(exp.amount, tenant.currency)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Resolution / Procurement Subject *
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Borehole Solar Pump Upgrade Tender"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
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
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Minute Ref *
              </label>
              <input
                type="text"
                required
                value={minuteReference}
                onChange={(e) => setMinuteReference(e.target.value)}
                placeholder="MIN/BOM/14"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Meeting Date
              </label>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Chairperson Signatory *
              </label>
              <input
                type="text"
                required
                value={chairpersonName}
                onChange={(e) => setChairpersonName(e.target.value)}
                placeholder="Dr. Margaret Kariuki"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Secretary / Principal *
              </label>
              <input
                type="text"
                required
                value={secretaryName}
                onChange={(e) => setSecretaryName(e.target.value)}
                placeholder="Principal Signatory"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Bursar / Treasurer
              </label>
              <input
                type="text"
                value={bursarName}
                onChange={(e) => setBursarName(e.target.value)}
                placeholder="School Bursar"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Decision
              </label>
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as ApprovalDecision)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="Approved">Approved</option>
                <option value="Pending Sign-Off">Pending Sign-Off</option>
                <option value="Deferred">Deferred</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Committee Remarks
            </label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Quorum notes or procurement conditions..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={!canManage || saving}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Recording Sign-Off...' : 'Record Committee Sign-Off'}
          </button>
        </form>
      </div>

      {/* Right: Sign-Off Register */}
      <div className="rounded-xl border border-slate-200 bg-white xl:col-span-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Board &amp; Procurement Sign-Off Register ({approvals.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Minute-backed authorization trail
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportApprovalsExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {approvals.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No Board or Procurement sign-off records captured yet.
            </div>
          ) : (
            approvals.map((rec: ApprovalSignOffRecord) => (
              <div key={rec.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {rec.referenceCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{rec.committee}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{rec.minuteReference}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDateShort(rec.meetingDate)}</span>
                    </div>
                    <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {rec.subject}
                    </h4>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(rec.amount, tenant.currency)}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                        rec.decision === 'Approved'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : rec.decision === 'Rejected'
                          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}
                    >
                      {rec.decision}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <span>Chair: {rec.chairpersonName}</span>
                  <span>Secretary: {rec.secretaryName}</span>
                  <span>Bursar: {rec.bursarName}</span>
                  {rec.linkedVoucherNumber && (
                    <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                      Voucher: {rec.linkedVoucherNumber}
                    </span>
                  )}
                </div>

                {rec.remarks && (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {rec.remarks}
                  </p>
                )}

                {canManage && (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
                    {rec.decision !== 'Approved' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await saasApi.updateApprovalDecision(tenant.id, rec.id, {
                            decision: 'Approved',
                          });
                          await onRefresh();
                          onNotify(`Approved ${rec.referenceCode} and synced linked voucher.`);
                        }}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        Approve Sign-Off
                      </button>
                    )}
                    {rec.decision === 'Pending Sign-Off' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await saasApi.updateApprovalDecision(tenant.id, rec.id, {
                            decision: 'Deferred',
                          });
                          await onRefresh();
                          onNotify(`Deferred ${rec.referenceCode}.`);
                        }}
                        className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        Defer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await saasApi.deleteApprovalRecord(tenant.id, rec.id);
                        await onRefresh();
                        onNotify(`Removed sign-off record ${rec.referenceCode}.`);
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
