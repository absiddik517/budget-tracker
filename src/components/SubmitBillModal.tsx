import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { Modal } from './Modal';
import { formatTaka } from '../lib/money';
import { formatVoucherNoForTr21 } from '../lib/billFormData';
import { isDateInFiscalYear } from '../lib/fy';

export interface SubmitBillFormValues {
  voucherNo: string;
  billDate: string;
  tokenNo: string;
  purposeText: string;
  payeeText: string;
}

interface SubmitBillModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (values: SubmitBillFormValues) => Promise<void> | void;
  submitting?: boolean;
  isOnline?: boolean;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  grossAmount: number;
  netPayable: number;
  initialValues: SubmitBillFormValues;
}

export function SubmitBillModal({
  open,
  onClose,
  onConfirm,
  submitting = false,
  isOnline = true,
  fiscalYear,
  economicCode,
  headName,
  headNameBn,
  grossAmount,
  netPayable,
  initialValues,
}: SubmitBillModalProps) {
  const formId = useId();
  const [voucherNo, setVoucherNo] = useState(initialValues.voucherNo);
  const [billDate, setBillDate] = useState(initialValues.billDate);
  const [tokenNo, setTokenNo] = useState(initialValues.tokenNo);
  const [purposeText, setPurposeText] = useState(initialValues.purposeText);
  const [payeeText, setPayeeText] = useState(initialValues.payeeText);
  const [errorMsg, setErrorMsg] = useState('');

  const initialValuesRef = useRef(initialValues);
  initialValuesRef.current = initialValues;

  useEffect(() => {
    if (!open) return;
    const init = initialValuesRef.current;
    setVoucherNo(init.voucherNo);
    setBillDate(init.billDate);
    setTokenNo(init.tokenNo);
    setPurposeText(init.purposeText);
    setPayeeText(init.payeeText);
    setErrorMsg('');
  }, [open]);

  const previewVoucherBn = formatVoucherNoForTr21(voucherNo, null, fiscalYear);
  const exampleVoucherBn = formatVoucherNoForTr21('001', null, fiscalYear);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!isOnline) {
      setErrorMsg('বিল জমা দিতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    const cleanVoucher = voucherNo.trim();
    if (!cleanVoucher) {
      setErrorMsg('ভাউচার নং প্রদান করা আবশ্যক।');
      return;
    }
    if (!billDate || !isDateInFiscalYear(billDate, fiscalYear)) {
      setErrorMsg(`বিলের তারিখ অর্থবছর ${fiscalYear} এর মধ্যে হতে হবে।`);
      return;
    }
    setErrorMsg('');
    await onConfirm({
      voucherNo: cleanVoucher,
      billDate,
      tokenNo: tokenNo.trim(),
      purposeText: purposeText.trim(),
      payeeText: payeeText.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="বিল জমা দেওয়ার তথ্য"
      subtitle="অনুমোদনের জন্য বিল জমা দেওয়ার আগে নিচের তথ্যগুলো যাচাই ও পূরণ করুন"
      maxWidthClass="md:max-w-lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm font-medium disabled:opacity-60"
          >
            বাতিল
          </button>
          <button
            type="submit"
            form={formId}
            disabled={submitting || !isOnline}
            className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            <span>{submitting ? 'জমা হচ্ছে…' : 'জমা নিশ্চিত করুন'}</span>
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {/* Bill Summary */}
        <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] text-xs space-y-1">
          <div className="font-semibold text-[var(--text)] bn">
            <span className="tabular-nums text-[var(--accent)]">{economicCode}</span> ·{' '}
            {headNameBn || headName}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--muted)] tabular-nums">
            <span>অর্থবছর: {fiscalYear}</span>
            <span>
              মোট: <strong className="text-[var(--text)]">{formatTaka(grossAmount)}</strong> · নিট প্রদেয়:{' '}
              <strong className="text-[var(--accent)]">{formatTaka(netPayable)}</strong>
            </span>
          </div>
        </div>

        {/* 1. Voucher No (Required) */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text)] mb-1">
            ভাউচার নং <span className="text-[var(--danger-text)]">*</span>
          </label>
          <input
            type="text"
            value={voucherNo}
            onChange={(e) => {
              setVoucherNo(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            placeholder="যেমন: 001 বা ০০১"
            className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
          />
          <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)] text-xs flex items-center justify-between gap-2">
            <span className="text-[var(--muted)]">টি.আর. ২১ (P1-S2) প্রিভিউ:</span>
            <span
              className={`font-semibold bn tabular-nums ${
                previewVoucherBn ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              ভাউচার নং: {previewVoucherBn || `${exampleVoucherBn} (উদাহরণ)`}
            </span>
          </div>
        </div>

        {/* 2. Bill Date & Token No */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              বিলের তারিখ (FY {fiscalYear})
            </label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => {
                setBillDate(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              টোকেন নং (ঐচ্ছিক)
            </label>
            <input
              type="text"
              value={tokenNo}
              onChange={(e) => setTokenNo(e.target.value)}
              placeholder="যেমন: ১২৩"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
            />
          </div>
        </div>

        {/* 3. Purpose Text */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            ব্যয়ের উদ্দেশ্য / বিবরণ (টি.আর. ২১)
          </label>
          <input
            type="text"
            value={purposeText}
            onChange={(e) => setPurposeText(e.target.value)}
            placeholder={`${headNameBn || headName} বাবদ ব্যয়ের বিল।`}
            className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
          />
        </div>

        {/* 4. Payee Text */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            যার নামে চেক ইস্যু করা হবে (টি.আর. ২১ ধারা ১২)
          </label>
          <input
            type="text"
            value={payeeText}
            onChange={(e) => setPayeeText(e.target.value)}
            placeholder="সহকারী পরিচালক, জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো..."
            className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
          />
        </div>

        {!isOnline && (
          <div className="p-2.5 rounded-lg bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>বিল জমা দিতে ইন্টারনেট সংযোগ প্রয়োজন।</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
