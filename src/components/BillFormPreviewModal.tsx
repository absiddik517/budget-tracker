import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileText, Layers, Loader2, Maximize2, Minimize2, Printer } from 'lucide-react';
import { Modal } from './Modal';
import { BillForm } from './BillForm';
import { sanitizeBillFileSegment, type Tr21FormData } from '../lib/billFormData';
import { ensureBengaliFontsLoaded } from '../utils/exportPdf';
import { exportTr21Docx, exportTr21Pdf, printTr21Form } from '../utils/exportTr21';
import { useApp } from '../contexts/AppContext';
import type { BillDoc } from '../types';

interface BillFormPreviewModalProps {
  open: boolean;
  onClose: () => void;
  bill: BillDoc | null;
  formData: Tr21FormData | null;
}

const A4_WIDTH_PX = 794;

export const BillFormPreviewModal: React.FC<BillFormPreviewModalProps> = ({
  open,
  onClose,
  bill,
  formData,
}) => {
  const { pushToast } = useApp();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  const [viewportWidth, setViewportWidth] = useState(A4_WIDTH_PX);
  const [innerHeight, setInnerHeight] = useState(2260);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [showSectionGuides, setShowSectionGuides] = useState(false);
  const [busyAction, setBusyAction] = useState<'print' | 'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (!open) return;
    void ensureBengaliFontsLoaded();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp) return;

    const updateSizes = () => {
      setViewportWidth(vp.clientWidth || A4_WIDTH_PX);
      if (inner) {
        setInnerHeight(inner.scrollHeight || 2260);
      }
    };
    updateSizes();

    const ro = new ResizeObserver(() => updateSizes());
    ro.observe(vp);
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [open, formData]);

  const scale = useMemo(() => {
    if (!fitToWidth) return 1;
    const available = Math.max(260, viewportWidth - 20);
    return Math.min(1, available / A4_WIDTH_PX);
  }, [fitToWidth, viewportWidth]);

  const fileSegment = useMemo(() => {
    if (!bill) return 'tr21';
    return sanitizeBillFileSegment(bill);
  }, [bill]);

  const handlePrint = async () => {
    if (!formData || busyAction) return;
    setBusyAction('print');
    try {
      const res = await printTr21Form(formData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'PDF তৈরি হয়েছে — প্রিন্ট বা সেভ করার অ্যাপ বেছে নিন।');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportPdf = async () => {
    if (!formData || busyAction) return;
    setBusyAction('pdf');
    try {
      const res = await exportTr21Pdf(formData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'PDF তৈরি হয়েছে — সংরক্ষণ বা শেয়ার করুন।');
      } else if (res.status === 'downloaded') {
        pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportDocx = async () => {
    if (!formData || busyAction) return;
    setBusyAction('docx');
    try {
      const res = await exportTr21Docx(formData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'Word (.docx) ফাইল তৈরি হয়েছে — ওপেন বা সেভ করুন।');
      } else if (res.status === 'downloaded') {
        pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Word export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  if (!open || !bill || !formData) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="টি.আর. ফরম নং-২১ প্রিভিউ"
      subtitle={
        bill.billNo
          ? `বিল নং ${bill.billNo} · A4 পোর্ট্রেট (২ পাতা)`
          : `খসড়া বিল · কোড ${bill.economicCode} · A4 পোর্ট্রেট (২ পাতা)`
      }
      fullScreenOnMobile
      maxWidthClass="md:max-w-5xl"
      footer={
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="grid grid-cols-2 md:flex md:flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFitToWidth((v) => !v)}
              className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {fitToWidth ? (
                <Maximize2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Minimize2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{fitToWidth ? '১০০% জুম' : 'স্ক্রিন ফিট'}</span>
            </button>

            <button
              type="button"
              aria-pressed={showSectionGuides}
              onClick={() => setShowSectionGuides((v) => !v)}
              className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                showSectionGuides
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{showSectionGuides ? 'সেকশন গাইড চালু' : 'সেকশন গাইড'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 md:flex md:flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              aria-busy={busyAction === 'print'}
              onClick={handlePrint}
              className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {busyAction === 'print' ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{busyAction === 'print' ? 'প্রিন্ট…' : 'Print'}</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              aria-busy={busyAction === 'pdf'}
              onClick={handleExportPdf}
              className="min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {busyAction === 'pdf' ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <FileDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{busyAction === 'pdf' ? 'PDF হচ্ছে…' : 'PDF'}</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              aria-busy={busyAction === 'docx'}
              onClick={handleExportDocx}
              className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {busyAction === 'docx' ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{busyAction === 'docx' ? 'Word হচ্ছে…' : 'Word (.docx)'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div
        ref={viewportRef}
        className="w-full overflow-x-auto rounded-xl bg-neutral-200 dark:bg-neutral-900 touch-pan-x touch-pan-y"
      >
        <div className="min-w-full w-max p-2.5 sm:p-4 flex justify-center">
          <div
            style={{
              width: `${Math.round(A4_WIDTH_PX * scale)}px`,
              height: `${Math.round(innerHeight * scale)}px`,
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <div
              ref={innerRef}
              style={{
                width: `${A4_WIDTH_PX}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              className="tr21-preview-sheet"
            >
              <BillForm data={formData} showSectionGuides={showSectionGuides} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
