import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, HelpCircle, Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { fetchProductRate } from '../lib/firestoreOps';
import {
  calcProduct,
  formatNumberIN,
  formatPaisaInput,
  formatTaka,
  normalizeProductRateKey,
  sumProducts,
  toPaisa,
} from '../lib/money';
import type { ExpenseProduct } from '../types';

interface DraftProductRow {
  id: string;
  name: string;
  actualStr: string;
  voucherStr: string;
  vatRateStr: string;
  itRateStr: string;
  lastEditedField: 'x' | 'y';
  rateSource: '' | 'search' | 'prev' | 'code' | 'hand';
  touched: boolean;
  lastLookupKey: string;
}

interface EvaluatedRow {
  valid: boolean;
  nameMissing: boolean;
  rateError: string;
  amountError: string;
  actualAmount: number;
  voucherAmount: number;
  vatRate: number;
  itRate: number;
  vatAmount: number;
  itAmount: number;
  deductionAmount: number;
}

export interface ProductsModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'edit' | 'readonly';
  officeId: string;
  economicCode: string;
  economicHeadLabel?: string;
  defaultVatRate: number;
  defaultItRate: number;
  initialProducts: ExpenseProduct[];
  /** Optional shared session cache keyed by `${officeId}::${normalizedKey}` */
  sessionRateCache?: Map<string, { vatRate: number; itRate: number } | null>;
  onSave?: (products: ExpenseProduct[]) => void;
}

function makeProductId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyDraft(defaultVatRate: number, defaultItRate: number): DraftProductRow {
  return {
    id: makeProductId(),
    name: '',
    actualStr: '',
    voucherStr: '',
    vatRateStr: String(Number.isFinite(defaultVatRate) ? defaultVatRate : 0),
    itRateStr: String(Number.isFinite(defaultItRate) ? defaultItRate : 0),
    lastEditedField: 'x',
    rateSource: 'code',
    touched: false,
    lastLookupKey: '',
  };
}

function fromExistingProduct(p: ExpenseProduct): DraftProductRow {
  const by: 'x' | 'y' = p.lastEditedField === 'y' ? 'y' : 'x';
  return {
    id: p.id || makeProductId(),
    name: p.name || '',
    actualStr: p.actualAmount > 0 ? formatPaisaInput(p.actualAmount) : '',
    voucherStr: p.voucherAmount > 0 ? formatPaisaInput(p.voucherAmount) : '',
    vatRateStr: String(Number.isFinite(p.vatRate) ? p.vatRate : 0),
    itRateStr: String(Number.isFinite(p.itRate) ? p.itRate : 0),
    lastEditedField: by,
    rateSource: '',
    touched: true,
    lastLookupKey: normalizeProductRateKey(p.name || ''),
  };
}

function parseRate(raw: string): number {
  const cleaned = raw.trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return num;
}

function evaluateRow(row: DraftProductRow): EvaluatedRow {
  const v = parseRate(row.vatRateStr);
  const t = parseRate(row.itRateStr);
  const nameMissing = !row.name.trim();

  if (!Number.isFinite(v) || v < 0 || v > 100 || !Number.isFinite(t) || t < 0 || t > 100) {
    return {
      valid: false,
      nameMissing,
      rateError: 'হার ০ থেকে ১০০% এর মধ্যে দিন।',
      amountError: '',
      actualAmount: 0,
      voucherAmount: 0,
      vatRate: Number.isFinite(v) ? v : 0,
      itRate: Number.isFinite(t) ? t : 0,
      vatAmount: 0,
      itAmount: 0,
      deductionAmount: 0,
    };
  }
  if (v + t >= 100) {
    return {
      valid: false,
      nameMissing,
      rateError: 'মোট কর্তনের হার ১০০% বা তার বেশি হতে পারে না।',
      amountError: '',
      actualAmount: 0,
      voucherAmount: 0,
      vatRate: v,
      itRate: t,
      vatAmount: 0,
      itAmount: 0,
      deductionAmount: 0,
    };
  }

  const rawAmt = row.lastEditedField === 'y' ? toPaisa(row.voucherStr) : toPaisa(row.actualStr);
  if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
    return {
      valid: false,
      nameMissing,
      rateError: '',
      amountError: '০ এর বেশি টাকার পরিমাণ দিন।',
      actualAmount: 0,
      voucherAmount: 0,
      vatRate: v,
      itRate: t,
      vatAmount: 0,
      itAmount: 0,
      deductionAmount: 0,
    };
  }

  try {
    const computed = calcProduct({
      id: row.id,
      name: row.name,
      amount: rawAmt,
      by: row.lastEditedField,
      vatRate: v,
      itRate: t,
    });
    return {
      valid: !nameMissing,
      nameMissing,
      rateError: '',
      amountError: '',
      actualAmount: computed.actualAmount,
      voucherAmount: computed.voucherAmount,
      vatRate: computed.vatRate,
      itRate: computed.itRate,
      vatAmount: computed.vatAmount,
      itAmount: computed.itAmount,
      deductionAmount: computed.deductionAmount,
    };
  } catch (err) {
    return {
      valid: false,
      nameMissing,
      rateError: '',
      amountError: err instanceof Error ? err.message : 'সঠিক পরিমাণ দিন।',
      actualAmount: 0,
      voucherAmount: 0,
      vatRate: v,
      itRate: t,
      vatAmount: 0,
      itAmount: 0,
      deductionAmount: 0,
    };
  }
}

function getRateNotice(
  row: DraftProductRow,
  v: number,
  t: number
): { tone: 'prev' | 'code' | 'hand' | ''; text: string } {
  const name = row.name.trim();
  const rateDesc = `(ভ্যাট ${v}%, আয়কর ${t}%)`;
  if (row.rateSource === 'search') {
    return { tone: 'code', text: `“${name}” এর আগের হার খোঁজা হচ্ছে…` };
  }
  if (row.rateSource === 'prev') {
    return {
      tone: 'prev',
      text: `“${name}” এর আগের হার বসানো হয়েছে ${rateDesc}। দরকার হলে বদলান।`,
    };
  }
  if (row.rateSource === 'hand') {
    return {
      tone: 'hand',
      text: 'হার হাতে বদলানো হয়েছে। সংরক্ষণ করলে এই পণ্যের জন্য এই হার মনে রাখা হবে।',
    };
  }
  if (row.rateSource === 'code') {
    return {
      tone: 'code',
      text: name
        ? `“${name}” এর আগের হার পাওয়া যায়নি, অর্থনৈতিক কোডের হার বসেছে ${rateDesc}।`
        : `অর্থনৈতিক কোডের হার বসেছে ${rateDesc}। নাম দিলে আগের হার খোঁজা হবে।`,
    };
  }
  return { tone: '', text: '' };
}

export function ProductsModal({
  open,
  onClose,
  mode,
  officeId,
  economicCode,
  economicHeadLabel,
  defaultVatRate,
  defaultItRate,
  initialProducts,
  sessionRateCache,
  onSave,
}: ProductsModalProps) {
  const isReadonly = mode === 'readonly';
  const [rows, setRows] = useState<DraftProductRow[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [openTipRowId, setOpenTipRowId] = useState<string | null>(null);
  const nameInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const localCacheRef = useRef<Map<string, { vatRate: number; itRate: number } | null>>(new Map());
  const effectiveCache = sessionRateCache || localCacheRef.current;

  useEffect(() => {
    if (!open) return;
    setShowValidation(false);
    setOpenTipRowId(null);
    if (initialProducts.length > 0) {
      setRows(initialProducts.map(fromExistingProduct));
    } else {
      setRows([createEmptyDraft(defaultVatRate, defaultItRate)]);
    }
  }, [open, initialProducts, defaultVatRate, defaultItRate]);

  // Close formula tooltip on outside click or Escape
  useEffect(() => {
    if (!openTipRowId) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-tip-trigger="true"]') || target.closest('[data-tip-box="true"]')) {
        return;
      }
      setOpenTipRowId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenTipRowId(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [openTipRowId]);

  const evaluatedRows = useMemo(() => rows.map(evaluateRow), [rows]);

  const totals = useMemo(
    () =>
      sumProducts(
        evaluatedRows.map((ev) => ({
          actualAmount: ev.actualAmount,
          voucherAmount: ev.voucherAmount,
          vatAmount: ev.vatAmount,
          itAmount: ev.itAmount,
          deductionAmount: ev.deductionAmount,
        }))
      ),
    [evaluatedRows]
  );

  const recomputeOppositeAmount = (draft: DraftProductRow): DraftProductRow => {
    const v = parseRate(draft.vatRateStr);
    const t = parseRate(draft.itRateStr);
    if (!Number.isFinite(v) || v < 0 || v > 100 || !Number.isFinite(t) || t < 0 || t > 100 || v + t >= 100) {
      return draft;
    }
    const amt = draft.lastEditedField === 'y' ? toPaisa(draft.voucherStr) : toPaisa(draft.actualStr);
    if (!Number.isFinite(amt) || amt <= 0) {
      return draft.lastEditedField === 'y'
        ? { ...draft, actualStr: '' }
        : { ...draft, voucherStr: '' };
    }
    try {
      const res = calcProduct({
        id: draft.id,
        name: draft.name,
        amount: amt,
        by: draft.lastEditedField,
        vatRate: v,
        itRate: t,
      });
      return draft.lastEditedField === 'y'
        ? { ...draft, actualStr: formatPaisaInput(res.actualAmount) }
        : { ...draft, voucherStr: formatPaisaInput(res.voucherAmount) };
    } catch {
      return draft;
    }
  };

  const updateProductRow = (id: string, updater: (prev: DraftProductRow) => DraftProductRow) => {
    setRows((prev) => prev.map((r) => (r.id === id ? updater(r) : r)));
  };

  const handleNameBlur = async (rowId: string) => {
    if (isReadonly) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const key = normalizeProductRateKey(row.name);
    if (!key || row.touched || row.lastLookupKey === key) return;

    const cacheKey = `${officeId}::${key}`;
    if (effectiveCache.has(cacheKey)) {
      const cached = effectiveCache.get(cacheKey);
      updateProductRow(rowId, (prev) => {
        if (normalizeProductRateKey(prev.name) !== key || prev.touched) return prev;
        const nextVat = cached ? cached.vatRate : defaultVatRate;
        const nextIt = cached ? cached.itRate : defaultItRate;
        return recomputeOppositeAmount({
          ...prev,
          vatRateStr: String(nextVat),
          itRateStr: String(nextIt),
          rateSource: cached ? 'prev' : 'code',
          lastLookupKey: key,
        });
      });
      return;
    }

    updateProductRow(rowId, (prev) => ({
      ...prev,
      rateSource: 'search',
      lastLookupKey: key,
    }));

    try {
      const found = officeId ? await fetchProductRate(officeId, row.name) : null;
      effectiveCache.set(
        cacheKey,
        found ? { vatRate: found.vatRate, itRate: found.itRate } : null
      );
      updateProductRow(rowId, (prev) => {
        if (normalizeProductRateKey(prev.name) !== key || prev.touched) return prev;
        const nextVat = found ? found.vatRate : defaultVatRate;
        const nextIt = found ? found.itRate : defaultItRate;
        return recomputeOppositeAmount({
          ...prev,
          vatRateStr: String(nextVat),
          itRateStr: String(nextIt),
          rateSource: found ? 'prev' : 'code',
          lastLookupKey: key,
        });
      });
    } catch {
      updateProductRow(rowId, (prev) => {
        if (normalizeProductRateKey(prev.name) !== key || prev.touched) return prev;
        return recomputeOppositeAmount({
          ...prev,
          vatRateStr: String(defaultVatRate),
          itRateStr: String(defaultItRate),
          rateSource: 'code',
          lastLookupKey: key,
        });
      });
    }
  };

  const handleAddRow = () => {
    if (isReadonly) return;
    const next = createEmptyDraft(defaultVatRate, defaultItRate);
    setRows((prev) => [...prev, next]);
    window.requestAnimationFrame(() => {
      nameInputRefs.current.get(next.id)?.focus();
    });
  };

  const handleDuplicateRow = (row: DraftProductRow, idx: number) => {
    if (isReadonly) return;
    const copy: DraftProductRow = {
      ...row,
      id: makeProductId(),
    };
    setRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const handleDeleteRow = (rowId: string) => {
    if (isReadonly || rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleDone = () => {
    if (isReadonly) {
      onClose();
      return;
    }
    setShowValidation(true);
    const firstBadIdx = evaluatedRows.findIndex((ev) => !ev.valid);
    if (firstBadIdx >= 0) {
      const badRow = rows[firstBadIdx];
      if (badRow) {
        rowCardRefs.current.get(badRow.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.requestAnimationFrame(() => {
          nameInputRefs.current.get(badRow.id)?.focus();
        });
      }
      return;
    }

    const result: ExpenseProduct[] = rows.map((row, idx) => {
      const ev = evaluatedRows[idx];
      const key = normalizeProductRateKey(row.name);
      if (officeId && key) {
        effectiveCache.set(`${officeId}::${key}`, {
          vatRate: ev.vatRate,
          itRate: ev.itRate,
        });
      }
      return {
        id: row.id || `prod_${idx + 1}`,
        name: row.name.trim(),
        actualAmount: ev.actualAmount,
        voucherAmount: ev.voucherAmount,
        vatRate: ev.vatRate,
        itRate: ev.itRate,
        vatAmount: ev.vatAmount,
        itAmount: ev.itAmount,
        deductionAmount: ev.deductionAmount,
        lastEditedField: row.lastEditedField,
      };
    });

    onSave?.(result);
    onClose();
  };

  const subtitle = economicCode
    ? economicHeadLabel
      ? `${economicCode} · ${economicHeadLabel}`
      : `কোড ${economicCode}`
    : 'পণ্য বা ব্যয় অনুযায়ী ভ্যাট ও আয়কর হার নির্ধারণ করুন';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ব্যয় সমূহ"
      subtitle={subtitle}
      maxWidthClass="max-w-[900px]"
      footer={
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl bg-[var(--surface-subtle)] p-2.5 tabular-nums">
            <div>
              <div className="text-[11px] text-[var(--muted)]">মোট প্রকৃত খরচ</div>
              <div className="text-[13.5px] font-bold text-[var(--text)]">
                {formatNumberIN(totals.baseTotal)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)]">ভ্যাট</div>
              <div className="text-[13.5px] font-bold text-[var(--text)]">
                {formatNumberIN(totals.vatTotal)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)]">আয়কর</div>
              <div className="text-[13.5px] font-bold text-[var(--text)]">
                {formatNumberIN(totals.itTotal)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)]">মোট ভাউচার</div>
              <div className="text-[14px] font-bold text-[var(--accent)]">
                {formatNumberIN(totals.voucherTotal)}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDone}
            className="w-full min-h-[48px] px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {isReadonly ? 'বন্ধ করুন' : `সম্পন্ন · মোট ${formatTaka(totals.voucherTotal)}`}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((row, idx) => {
          const ev = evaluatedRows[idx];
          const isBad = showValidation && !ev.valid;
          const notice = isReadonly ? { tone: '' as const, text: '' } : getRateNotice(row, ev.vatRate, ev.itRate);
          const z = ev.vatRate + ev.itRate;
          const tipOpen = openTipRowId === row.id;

          return (
            <div
              key={row.id}
              ref={(el) => {
                if (el) rowCardRefs.current.set(row.id, el);
                else rowCardRefs.current.delete(row.id);
              }}
              className={`rounded-[14px] border p-3 bg-[var(--card)] space-y-3 ${
                isBad ? 'border-[var(--danger-solid)]' : 'border-[var(--line)]'
              }`}
            >
              {/* Product header */}
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] text-[13px] font-bold inline-flex items-center justify-center shrink-0 tabular-nums">
                  {idx + 1}
                </span>
                <input
                  ref={(el) => {
                    if (el) nameInputRefs.current.set(row.id, el);
                    else nameInputRefs.current.delete(row.id);
                  }}
                  type="text"
                  autoComplete="off"
                  disabled={isReadonly}
                  value={row.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateProductRow(row.id, (prev) => ({
                      ...prev,
                      name: val,
                      ...(prev.rateSource === 'search' ? { rateSource: '' } : {}),
                    }));
                  }}
                  onBlur={() => void handleNameBlur(row.id)}
                  placeholder="পণ্যের নাম (যেমন: ব্যানার, কেক)"
                  aria-label="পণ্যের নাম"
                  className={`flex-1 min-w-0 min-h-[44px] px-3 rounded-[10px] border bg-[var(--card)] text-[15px] bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-75 disabled:bg-[var(--surface-subtle)] ${
                    showValidation && ev.nameMissing
                      ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                      : 'border-[var(--border-strong)]/60'
                  }`}
                />
                {!isReadonly && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDuplicateRow(row, idx)}
                      aria-label={`পণ্য #${idx + 1} কপি করুন`}
                      title="কপি করুন"
                      className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center justify-center shrink-0"
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={rows.length <= 1}
                      onClick={() => handleDeleteRow(row.id)}
                      aria-label={`পণ্য #${idx + 1} মুছুন`}
                      title="মুছুন"
                      className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>

              {/* Amount row + formula tooltip */}
              <div className="relative">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="min-h-[24px] flex items-center mb-1">
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        প্রকৃত খরচ (৳)
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={isReadonly}
                      value={row.actualStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateProductRow(row.id, (prev) =>
                          recomputeOppositeAmount({
                            ...prev,
                            actualStr: val,
                            lastEditedField: 'x',
                          })
                        );
                      }}
                      placeholder="5000"
                      aria-label="প্রকৃত খরচ"
                      className={`w-full min-h-[44px] px-3 rounded-[10px] border bg-[var(--card)] text-base tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-75 disabled:bg-[var(--surface-subtle)] ${
                        showValidation && ev.amountError
                          ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                          : 'border-[var(--border-strong)]/60'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="min-h-[24px] flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-semibold text-[var(--muted)] truncate">
                        ভাউচার এমাউন্ট (৳)
                      </span>
                      <button
                        type="button"
                        data-tip-trigger="true"
                        aria-label="হিসাব দেখুন"
                        aria-expanded={tipOpen}
                        onClick={() => setOpenTipRowId(tipOpen ? null : row.id)}
                        className={`relative w-[22px] h-[22px] rounded-full inline-flex items-center justify-center shrink-0 transition-colors ${
                          tipOpen
                            ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                            : 'text-[var(--muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        <HelpCircle className="w-[18px] h-[18px]" aria-hidden="true" />
                      </button>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={isReadonly}
                      value={row.voucherStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateProductRow(row.id, (prev) =>
                          recomputeOppositeAmount({
                            ...prev,
                            voucherStr: val,
                            lastEditedField: 'y',
                          })
                        );
                      }}
                      placeholder="6250"
                      aria-label="ভাউচার এমাউন্ট"
                      className={`w-full min-h-[44px] px-3 rounded-[10px] border bg-[var(--card)] text-base tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-75 disabled:bg-[var(--surface-subtle)] ${
                        showValidation && ev.amountError
                          ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                          : 'border-[var(--border-strong)]/60'
                      }`}
                    />
                  </div>
                </div>

                {tipOpen && (
                  <div
                    role="tooltip"
                    data-tip-box="true"
                    className="mt-2 rounded-xl bg-[var(--text)] text-[var(--bg)] p-3 text-xs leading-relaxed shadow-xl z-20"
                  >
                    <div className="font-bold mb-0.5">হিসাব (ভাউচার থেকে ভ্যাট ও আয়কর কর্তন)</div>
                    <div>x = প্রকৃত খরচ, y = ভাউচার এমাউন্ট, z = ভ্যাট% + আয়কর%</div>
                    <div className="font-semibold text-[13px] mt-1 tabular-nums">
                      কর্তন = y × z ÷ ১০০ &nbsp;·&nbsp; x = y − কর্তন
                    </div>
                    <div className="font-semibold text-[13px] tabular-nums">
                      y = x × ১০০ ÷ (১০০ − z)
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--bg)]/25 tabular-nums">
                      এই পণ্যে: ভ্যাট {ev.vatRate}% ({formatNumberIN(ev.vatAmount)}) + আয়কর {ev.itRate}% (
                      {formatNumberIN(ev.itAmount)}) = কর্তন {formatNumberIN(ev.deductionAmount)} (z = {z}%)
                      <br />
                      x = {formatNumberIN(ev.voucherAmount)} − {formatNumberIN(ev.deductionAmount)} ={' '}
                      {formatNumberIN(ev.actualAmount)}
                      <br />
                      যেকোনো একটি ঘর বদলালে অন্যটি নিজে হিসাব হয়।
                    </div>
                  </div>
                )}
              </div>

              {/* VAT & IT rates + quick chips */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1">
                    ভ্যাট হার (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={isReadonly}
                    value={row.vatRateStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateProductRow(row.id, (prev) =>
                        recomputeOppositeAmount({
                          ...prev,
                          vatRateStr: val,
                          touched: true,
                          rateSource: 'hand',
                        })
                      );
                    }}
                    aria-label="ভ্যাট হার"
                    className={`w-full min-h-[44px] px-3 rounded-[10px] border bg-[var(--card)] text-base tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-75 disabled:bg-[var(--surface-subtle)] ${
                      showValidation && ev.rateError
                        ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                        : 'border-[var(--border-strong)]/60'
                    }`}
                  />
                  {!isReadonly && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[0, 10, 15].map((preset) => {
                        const active = ev.vatRate === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              updateProductRow(row.id, (prev) =>
                                recomputeOppositeAmount({
                                  ...prev,
                                  vatRateStr: String(preset),
                                  touched: true,
                                  rateSource: 'hand',
                                })
                              )
                            }
                            className={`min-h-[34px] px-3 rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                              active
                                ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]'
                                : 'bg-[var(--card)] border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {preset}%
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1">
                    আয়কর হার (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={isReadonly}
                    value={row.itRateStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateProductRow(row.id, (prev) =>
                        recomputeOppositeAmount({
                          ...prev,
                          itRateStr: val,
                          touched: true,
                          rateSource: 'hand',
                        })
                      );
                    }}
                    aria-label="আয়কর হার"
                    className={`w-full min-h-[44px] px-3 rounded-[10px] border bg-[var(--card)] text-base tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-75 disabled:bg-[var(--surface-subtle)] ${
                      showValidation && ev.rateError
                        ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                        : 'border-[var(--border-strong)]/60'
                    }`}
                  />
                  {!isReadonly && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[0, 5].map((preset) => {
                        const active = ev.itRate === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              updateProductRow(row.id, (prev) =>
                                recomputeOppositeAmount({
                                  ...prev,
                                  itRateStr: String(preset),
                                  touched: true,
                                  rateSource: 'hand',
                                })
                              )
                            }
                            className={`min-h-[34px] px-3 rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                              active
                                ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]'
                                : 'bg-[var(--card)] border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {preset}%
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Computed per-product breakdown strip */}
              <div className="grid grid-cols-3 gap-2 rounded-[10px] bg-[var(--surface-subtle)] p-2.5 tabular-nums">
                <div>
                  <div className="text-[11px] text-[var(--muted)]">ভ্যাট ৳</div>
                  <div className="text-[13.5px] font-bold text-[var(--text)]">
                    {formatNumberIN(ev.vatAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--muted)]">আয়কর ৳</div>
                  <div className="text-[13.5px] font-bold text-[var(--text)]">
                    {formatNumberIN(ev.itAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--muted)]">মোট কর্তন</div>
                  <div className="text-[13.5px] font-bold text-[var(--accent)]">
                    {formatNumberIN(ev.deductionAmount)}
                  </div>
                </div>
              </div>

              {notice.text && (
                <div
                  className={`rounded-lg px-2.5 py-2 text-xs leading-relaxed ${
                    notice.tone === 'prev'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : notice.tone === 'hand'
                        ? 'bg-[var(--warn-bg)] text-[var(--warn-text)]'
                        : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
                  }`}
                >
                  {notice.text}
                </div>
              )}

              {showValidation && (ev.nameMissing || ev.rateError || ev.amountError) && (
                <div className="text-xs font-medium text-[var(--danger-text)]">
                  {ev.rateError ||
                    (ev.nameMissing ? 'পণ্যের নাম লিখুন। ' : '') + (ev.amountError || '')}
                </div>
              )}
            </div>
          );
        })}

        {!isReadonly && (
          <button
            type="button"
            onClick={handleAddRow}
            className="md:col-span-2 w-full min-h-[48px] px-4 rounded-xl border-[1.5px] border-dashed border-[var(--accent)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[var(--accent)] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>আরেকটি পণ্য যোগ করুন</span>
          </button>
        )}
      </div>
    </Modal>
  );
}
