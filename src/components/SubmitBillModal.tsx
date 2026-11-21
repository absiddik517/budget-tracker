import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Modal, ModalFooter } from './Modal';
import { Banner, Field, Section, TextInput, focusFirstInvalidField } from './form';
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
  const formRef = useRef<HTMLFormElement | null>(null);
  const [voucherNo, setVoucherNo] = useState(initialValues.voucherNo);
  const [billDate, setBillDate] = useState(initialValues.billDate);
  const [tokenNo, setTokenNo] = useState(initialValues.tokenNo);
  const [purposeText, setPurposeText] = useState(initialValues.purposeText);
  const [payeeText, setPayeeText] = useState(initialValues.payeeText);
  const [voucherError, setVoucherError] = useState('');
  const [dateError, setDateError] = useState('');
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
    setVoucherError('');
    setDateError('');
    setErrorMsg('');
  }, [open]);

  const isDirty = useMemo(() => {
    const init = initialValuesRef.current;
    return (
      voucherNo !== init.voucherNo ||
      billDate !== init.billDate ||
      tokenNo !== init.tokenNo ||
      purposeText !== init.purposeText ||
      payeeText !== init.payeeText
    );
  }, [voucherNo, billDate, tokenNo, purposeText, payeeText]);

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
      const msg = 'ভাউচার নং প্রদান করা আবশ্যক।';
      setVoucherError(msg);
      setDateError('');
      setErrorMsg(msg);
      window.requestAnimationFrame(() => focusFirstInvalidField(formRef.current));
      return;
    }
    if (!billDate || !isDateInFiscalYear(billDate, fiscalYear)) {
      const msg = `বিলের তারিখ অর্থবছর ${fiscalYear} এর মধ্যে হতে হবে।`;
      setVoucherError('');
      setDateError(msg);
      setErrorMsg(msg);
      window.requestAnimationFrame(() => focusFirstInvalidField(formRef.current));
      return;
    }
    setVoucherError('');
    setDateError('');
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
      subtitle={`মোট ${formatTaka(grossAmount)} · নিট প্রদেয় ${formatTaka(netPayable)} · অনুমোদনের জন্য জমা দেওয়ার আগে তথ্য যাচাই করুন`}
      size="md"
      confirmClose={isDirty && !submitting}
      footer={
        <ModalFooter
          loading={submitting}
          secondary={{
            label: 'বাতিল',
            onClick: onClose,
            disabled: submitting,
          }}
          primary={{
            label: submitting ? 'জমা হচ্ছে…' : 'জমা নিশ্চিত করুন',
            type: 'submit',
            form: formId,
            disabled: !isOnline,
            icon: <Send className="w-4 h-4 shrink-0" aria-hidden="true" />,
          }}
        />
      }
    >
      <form ref={formRef} id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Banner variant={isOnline ? 'info' : 'warn'}>
          বিল জমা দিতে ইন্টারনেট সংযোগ প্রয়োজন।
        </Banner>

        {/* Bill Summary */}
        <Section>
          <div className="text-xs space-y-1">
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
        </Section>

        {/* 1. Voucher No (Required) + P1-S2 Preview Box */}
        <div className="space-y-2">
          <Field label="ভাউচার নং" required error={voucherError || undefined}>
            <TextInput
              type="text"
              value={voucherNo}
              onChange={(e) => {
                setVoucherNo(e.target.value);
                if (voucherError) setVoucherError('');
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="যেমন: 001 বা ০০১"
              className="tabular-nums"
            />
          </Field>

          <div className="p-3 rounded-xl bg-[var(--bg)] border border-dashed border-[var(--line)] text-[13px] flex flex-wrap items-center justify-between gap-2">
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
          <Field
            label={`বিলের তারিখ (FY ${fiscalYear})`}
            required
            error={dateError || undefined}
          >
            <TextInput
              type="date"
              value={billDate}
              onChange={(e) => {
                setBillDate(e.target.value);
                if (dateError) setDateError('');
                if (errorMsg) setErrorMsg('');
              }}
              className="tabular-nums"
            />
          </Field>

          <Field label="টোকেন নং (ঐচ্ছিক)">
            <TextInput
              type="text"
              value={tokenNo}
              onChange={(e) => setTokenNo(e.target.value)}
              placeholder="যেমন: ১২৩"
              className="tabular-nums"
            />
          </Field>
        </div>

        {/* 3. Purpose Text */}
        <Field label="ব্যয়ের উদ্দেশ্য / বিবরণ (টি.আর. ২১)">
          <TextInput
            type="text"
            value={purposeText}
            onChange={(e) => setPurposeText(e.target.value)}
            placeholder={`${headNameBn || headName} বাবদ ব্যয়ের বিল।`}
            className="bn"
          />
        </Field>

        {/* 4. Payee Text */}
        <Field label="যার নামে চেক ইস্যু করা হবে (টি.আর. ২১ ধারা ১২)">
          <TextInput
            type="text"
            value={payeeText}
            onChange={(e) => setPayeeText(e.target.value)}
            placeholder="সহকারী পরিচালক, জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো..."
            className="bn"
          />
        </Field>

        {errorMsg && <Banner variant="danger">{errorMsg}</Banner>}
      </form>
    </Modal>
  );
}
