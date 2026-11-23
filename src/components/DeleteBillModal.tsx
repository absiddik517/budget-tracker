import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalFooter } from './Modal';
import { Banner, Field, Textarea, focusFirstInvalidField } from './form';
import { StatusChip, type ChipVariant } from './StatusChip';
import { useApp } from '../contexts/AppContext';
import { formatDateDisplay } from '../lib/dates';
import { formatTaka } from '../lib/money';
import type { BillDoc, BillStatus } from '../types';

function billStatusToChip(status: BillStatus): ChipVariant {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'draft':
      return 'draft';
    case 'submitted':
      return 'submitted';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
  }
}

export interface DeleteBillModalProps {
  open: boolean;
  onClose: () => void;
  bill: BillDoc | null;
  isOnline: boolean;
  deleting: boolean;
  onConfirm: (reason?: string) => Promise<void> | void;
}

export function DeleteBillModal({
  open,
  onClose,
  bill,
  isOnline,
  deleting,
  onConfirm,
}: DeleteBillModalProps) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setReasonError('');
    }
  }, [open, bill?.id]);

  if (!bill) return null;

  const requiresOnline = bill.status === 'submitted' || bill.status === 'approved';
  const requiresReason = bill.status === 'approved';

  const title =
    bill.status === 'draft'
      ? t('deleteDraftConfirmTitle')
      : bill.status === 'submitted'
      ? t('deleteSubmittedConfirmTitle')
      : bill.status === 'approved'
      ? t('deleteApprovedConfirmTitle')
      : t('deleteClosedConfirmTitle');

  const consequenceBody =
    bill.status === 'draft'
      ? t('deleteDraftConfirmBody')
      : bill.status === 'submitted'
      ? t('deleteSubmittedConfirmBody')
      : bill.status === 'approved'
      ? t('deleteApprovedConfirmBody')
      : t('deleteClosedConfirmBody');

  const handleSubmit = async () => {
    if (requiresOnline && !isOnline) return;
    if (requiresReason && !reason.trim()) {
      setReasonError(t('deleteBillReasonRequired'));
      requestAnimationFrame(() => focusFirstInvalidField(formRef.current));
      return;
    }
    setReasonError('');
    await onConfirm(reason.trim() || undefined);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!deleting) onClose();
      }}
      title={title}
      size="sm"
      confirmClose={requiresReason && Boolean(reason.trim()) && !deleting}
      footer={
        <ModalFooter
          danger
          loading={deleting}
          secondary={{
            label: t('cancel'),
            disabled: deleting,
            onClick: onClose,
          }}
          primary={{
            label: deleting
              ? 'মুছে ফেলা হচ্ছে…'
              : bill.status === 'draft'
              ? t('confirmDeleteBtn')
              : t('confirmDeleteBillBtn'),
            type: requiresReason ? 'submit' : 'button',
            form: requiresReason ? 'delete-bill-form' : undefined,
            onClick: requiresReason ? undefined : handleSubmit,
            disabled: requiresOnline && !isOnline,
          }}
        />
      }
    >
      <form
        ref={formRef}
        id="delete-bill-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        noValidate
        className="space-y-4"
      >
        {requiresOnline && !isOnline && (
          <Banner variant="warn">{t('deleteBillOnlineRequired')}</Banner>
        )}

        <div
          aria-hidden="true"
          className="w-12 h-12 rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] flex items-center justify-center mx-auto"
        >
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[var(--text)] tabular-nums">
              {bill.billNo || 'খসড়া (Draft)'}
            </span>
            <StatusChip variant={billStatusToChip(bill.status)}>{t(bill.status)}</StatusChip>
          </div>
          <div className="flex items-center justify-between gap-2 text-[var(--muted)] tabular-nums">
            <span>
              {formatDateDisplay(bill.billDate || bill.date)} · {bill.economicCode}
            </span>
            <span className="font-semibold text-[var(--text)]">{formatTaka(bill.grossAmount)}</span>
          </div>
        </div>

        <Banner variant="danger">{consequenceBody}</Banner>

        {requiresReason && (
          <Field label={t('deleteBillReasonLabel')} required error={reasonError}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError('');
              }}
              placeholder={t('deleteBillReasonPlaceholder')}
              className="bn"
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
