import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileText, Layers, Maximize2, Minimize2, Printer } from 'lucide-react';
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFitToWidth((v) => !v)}
              className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[var(--surface-subtle)]"
            >
              {fitToWidth ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              <span>{fitToWidth ? '১০০% জুম' : 'স্ক্রিন ফিট'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSectionGuides((v) => !v)}
              className={`min-h-[40px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${
                showSectionGuides
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--line)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showSectionGuides ? 'সেকশন গাইড চালু' : 'সেকশন গাইড'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handlePrint}
              className="min-h-[42px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>{busyAction === 'print' ? 'প্রিন্ট…' : 'Print'}</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleExportPdf}
              className="min-h-[42px] px-3.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>{busyAction === 'pdf' ? 'PDF হচ্ছে…' : 'PDF'}</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleExportDocx}
              className="min-h-[42px] px-3.5 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>{busyAction === 'docx' ? 'Word হচ্ছে…' : 'Word (.docx)'}</span>
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
