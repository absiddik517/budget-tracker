import React, { useMemo, useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import {
  copyVatTaxRatesToFy,
  upsertEconomicCode,
  upsertVatTaxRate,
} from '../lib/firestoreOps';
import { getNextFiscalYear } from '../lib/fy';
import { canManageRates } from '../lib/permissions';
import type { EconomicCodeDoc, VatTaxRateDoc, VatVariant } from '../types';

export function VatTaxModelPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const { selectedFy, currentOfficeRole, actorSnapshot, pushToast, t } = useApp();
  const { vatTaxRates, loading } = useFyData(selectedFy);
  const { getCodeEntry, getHead } = useEconomicCodes();

  const canEdit = canManageRates({ isSuperAdmin, officeRole: currentOfficeRole });

  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<VatTaxRateDoc | null>(null);
  const [copying, setCopying] = useState(false);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionBn, setDescriptionBn] = useState('');
  const [incomeTax, setIncomeTax] = useState('0');
  const [hasVariants, setHasVariants] = useState(false);
  const [singleVat, setSingleVat] = useState('0');
  const [variants, setVariants] = useState<VatVariant[]>([
    { key: 'ac', label: 'AC', rate: 15 },
    { key: 'nonAc', label: 'Non-AC', rate: 10 },
  ]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pagedRates = useMemo(() => {
    const start = (page - 1) * 50;
    return vatTaxRates.slice(start, start + 50);
  }, [vatTaxRates, page]);

  const openCreateModal = () => {
    setEditingRate(null);
    setCode('');
    setCodeError('');
    setDescription('');
    setDescriptionBn('');
    setIncomeTax('5');
    setHasVariants(false);
    setSingleVat('10');
    setVariants([
      { key: 'ac', label: 'AC', rate: 15 },
      { key: 'nonAc', label: 'Non-AC', rate: 10 },
    ]);
    setModalOpen(true);
  };

  const openEditModal = (rate: VatTaxRateDoc) => {
    if (!canEdit) return;
    const head = getHead(rate.economicCode, {
      headName: rate.description,
      headNameBn: rate.descriptionBn,
    });
    setEditingRate(rate);
    setCode(rate.economicCode);
    setCodeError('');
    setDescription(head.headName);
    setDescriptionBn(head.headNameBn);
    setIncomeTax(String(rate.incomeTax));
    if (rate.vat.length > 1) {
      setHasVariants(true);
      setVariants(rate.vat.map((v) => ({ ...v })));
    } else {
      setHasVariants(false);
      setSingleVat(String(rate.vat[0]?.rate ?? 0));
    }
    setModalOpen(true);
  };

  const handleCodeSelect = (val: string, entry: EconomicCodeDoc | null) => {
    setCode(val);
    setCodeError('');
    setDescription(entry?.headName || '');
    setDescriptionBn(entry?.headNameBn || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !canEdit) return;
    const trimmedCode = code.trim();
    const entry = getCodeEntry(trimmedCode);
    if (!entry) {
      setCodeError('Select a valid economic code from Economic Codes.');
      pushToast('error', 'Select a valid economic code.');
      return;
    }

    setSaving(true);
    try {
      const itNum = parseFloat(incomeTax) || 0;
      const vatArr: VatVariant[] = hasVariants
        ? variants.map((v) => ({
            key: v.key.trim() || v.label.toLowerCase().replace(/\s+/g, ''),
            label: v.label.trim(),
            rate: Number(v.rate) || 0,
          }))
        : [{ key: 'default', label: 'Standard', rate: parseFloat(singleVat) || 0 }];

      const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
      await upsertVatTaxRate(
        {
          fiscalYear: selectedFy,
          economicCode: trimmedCode,
          description: entry.headNameBn || entry.headName,
          descriptionBn: entry.headNameBn,
          incomeTax: itNum,
          vat: vatArr,
        },
        !editingRate,
        actor
      );
      pushToast('success', editingRate ? 'Rate updated.' : 'Rate added.');
      setModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save rate.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyNextFy = async () => {
    if (!userDoc || !canEdit || vatTaxRates.length === 0) return;
    const nextFy = getNextFiscalYear(selectedFy);
    const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
    setCopying(true);
    try {
      const count = await copyVatTaxRatesToFy(vatTaxRates, nextFy, actor);
      pushToast('success', `Copied ${count} rates to FY ${nextFy}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to copy rates.');
    } finally {
      setCopying(false);
    }
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userDoc || !canEdit) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        pushToast('error', 'CSV file must have a header row and at least one data row.');
        return;
      }
      const headers = lines[0].split(',').map((h) => h.trim());
      const idx = (name: string) => headers.indexOf(name);
      const cIdx = idx('code');
      const dIdx = idx('description');
      const dbIdx = idx('descriptionBn');
      const itIdx = idx('incomeTax');
      const vIdx = idx('vat');
      const vacIdx = idx('vatAc');
      const vnacIdx = idx('vatNonAc');

      if (cIdx === -1 || dIdx === -1) {
        pushToast('error', 'CSV must include columns: code, description, descriptionBn, incomeTax, vat, vatAc, vatNonAc.');
        return;
      }

      const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const rowCode = cols[cIdx];
        if (!rowCode) continue;
        const rowDesc = cols[dIdx] || rowCode;
        const rowDescBn = dbIdx >= 0 ? cols[dbIdx] || '' : '';
        const rowIt = itIdx >= 0 ? parseFloat(cols[itIdx]) || 0 : 0;
        const acVal = vacIdx >= 0 && cols[vacIdx] !== '' ? parseFloat(cols[vacIdx]) : NaN;
        const nonAcVal = vnacIdx >= 0 && cols[vnacIdx] !== '' ? parseFloat(cols[vnacIdx]) : NaN;
        const defaultVat = vIdx >= 0 ? parseFloat(cols[vIdx]) || 0 : 0;

        if (!getCodeEntry(rowCode)) {
          const finalHead = rowDescBn || rowDesc;
          await upsertEconomicCode(
            {
              code: rowCode,
              headName: finalHead,
              headNameBn: finalHead,
              active: true,
            },
            actor
          );
        }

        const vatList: VatVariant[] =
          !Number.isNaN(acVal) && !Number.isNaN(nonAcVal)
            ? [
                { key: 'ac', label: 'AC', rate: acVal },
                { key: 'nonAc', label: 'Non-AC', rate: nonAcVal },
              ]
            : [{ key: 'default', label: 'Standard', rate: defaultVat }];

        await upsertVatTaxRate(
          {
            fiscalYear: selectedFy,
            economicCode: rowCode,
            description: rowDesc,
            descriptionBn: rowDescBn,
            incomeTax: rowIt,
            vat: vatList,
          },
          true,
          actor
        );
        imported++;
      }
      pushToast('success', `Imported ${imported} rates into FY ${selectedFy}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to parse CSV.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const actions = canEdit ? (
    <button
      type="button"
      onClick={openCreateModal}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newRate')}
    </button>
  ) : null;

  return (
    <Layout title={t('navVatTax')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        <div className="card-surface px-3.5 md:px-4 py-3 text-xs text-[var(--muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <p>
            {canEdit
              ? 'গ্লোবাল ভ্যাট ও আয়কর হার — বিল তৈরির সময় এখান থেকে হার নেওয়া হয়।'
              : 'গ্লোবাল ভ্যাট ও আয়কর হার (পঠনযোগ্য) — শুধুমাত্র সুপার অ্যাডমিন এই হার পরিবর্তন করতে পারবেন।'}
          </p>
          {canEdit && (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCsvFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] md:min-h-[38px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--text)] inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('importCsv')}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyNextFy}
                disabled={copying || vatTaxRates.length === 0}
                className="min-h-[44px] md:min-h-[38px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--text)] disabled:opacity-50 whitespace-nowrap"
              >
                {copying ? 'Copying…' : t('copyToNextFy')}
              </button>
            </div>
          )}
        </div>

        <div className="card-surface overflow-hidden">
          {/* Mobile Card List */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {loading ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                Loading rates…
              </div>
            ) : pagedRates.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                No VAT &amp; Tax rates configured for FY {selectedFy}.
              </div>
            ) : (
              pagedRates.map((rate) => {
                const head = getHead(rate.economicCode, {
                  headName: rate.description,
                  headNameBn: rate.descriptionBn,
                });
                const vatStr =
                  rate.vat.length > 1
                    ? rate.vat.map((v) => `${v.rate}%`).join(' / ')
                    : rate.vat[0]?.rate
                    ? `${rate.vat[0].rate}%`
                    : '—';
                const variantsStr =
                  rate.vat.length > 1 ? rate.vat.map((v) => v.label).join(' / ') : '';

                const cardBody = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold tabular-nums text-[var(--accent)] break-all">
                          {rate.economicCode}
                        </div>
                        <div className="text-sm font-medium text-[var(--text)] mt-0.5 bn break-words">
                          {head.displayName}
                        </div>
                      </div>
                      {variantsStr && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] border border-[var(--line)] text-[var(--text)] shrink-0">
                          {variantsStr}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1.5 text-xs border-t border-[var(--line)]/60">
                      <div>
                        <span className="text-[var(--muted)]">Income tax: </span>
                        <span className="font-semibold tabular-nums">
                          {rate.incomeTax > 0 ? `${rate.incomeTax}%` : '—'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[var(--muted)]">VAT: </span>
                        <span className="font-semibold tabular-nums">{vatStr}</span>
                      </div>
                    </div>
                  </>
                );

                return canEdit ? (
                  <button
                    key={rate.id}
                    type="button"
                    onClick={() => openEditModal(rate)}
                    className="w-full text-left p-3.5 space-y-2 hover:bg-[var(--surface-subtle)] active:bg-[var(--surface-subtle)] transition-colors"
                  >
                    {cardBody}
                  </button>
                ) : (
                  <div key={rate.id} className="p-3.5 space-y-2">
                    {cardBody}
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">Code</th>
                  <th className="py-3 px-4 font-medium">ব্যয়ের খাত</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Income tax</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">VAT</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">Variants</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      Loading rates…
                    </td>
                  </tr>
                ) : pagedRates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      No VAT &amp; Tax rates configured for FY {selectedFy}.
                    </td>
                  </tr>
                ) : (
                  pagedRates.map((rate) => {
                    const head = getHead(rate.economicCode, {
                      headName: rate.description,
                      headNameBn: rate.descriptionBn,
                    });
                    const vatStr =
                      rate.vat.length > 1
                        ? rate.vat.map((v) => `${v.rate}%`).join(' / ')
                        : rate.vat[0]?.rate
                        ? `${rate.vat[0].rate}%`
                        : '—';
                    const variantsStr =
                      rate.vat.length > 1
                        ? rate.vat.map((v) => v.label).join(' / ')
                        : '—';

                    return (
                      <tr
                        key={rate.id}
                        onClick={() => openEditModal(rate)}
                        className={`group ${
                          canEdit ? 'cursor-pointer hover:bg-[var(--surface-subtle)]' : ''
                        } transition-colors`}
                      >
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-medium tabular-nums whitespace-nowrap transition-colors">
                          {rate.economicCode === 'GENERAL-CONSTRUCTION'
                            ? 'GENERAL-CONSTRUCTION'
                            : rate.economicCode}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-[var(--text)] bn">
                            {head.displayName}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {rate.incomeTax > 0 ? `${rate.incomeTax}%` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {vatStr}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {variantsStr === '—' ? (
                            <span className="text-[var(--muted)]">—</span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border border-[var(--line)] text-[var(--text)]">
                              {variantsStr}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalItems={vatTaxRates.length}
            onPageChange={setPage}
          />
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRate ? `Edit Rate · ${editingRate.economicCode}` : 'New Vat & Tax Rate'}
        subtitle={`FY ${selectedFy}`}
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="vat-tax-form"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : t('save')}
            </button>
          </div>
        }
      >
        <form id="vat-tax-form" onSubmit={handleSave} className="space-y-4">
          <EconomicCodeSelect
            label="Economic code (7 digits or GENERAL-CONSTRUCTION)"
            value={code}
            onChange={handleCodeSelect}
            error={codeError}
            disabled={Boolean(editingRate)}
            includeInactive={Boolean(editingRate)}
            includeSpecial={true}
            placeholder="Select economic code…"
          />

          {code && (
            <div className="px-3.5 py-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
              <div className="text-[11px] font-medium text-[var(--muted)]">
                ব্যয়ের খাত
              </div>
              <div className="text-sm font-medium text-[var(--text)] mt-0.5 bn break-words">
                {getHead(code, { headName: description, headNameBn: descriptionBn }).displayName}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="rate-it" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Income tax (%)
            </label>
            <input
              id="rate-it"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={incomeTax}
              onChange={(e) => setIncomeTax(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
            />
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--muted)]">VAT structure</span>
              <button
                type="button"
                onClick={() => setHasVariants((v) => !v)}
                className="min-h-[36px] text-xs font-medium text-[var(--accent)] hover:underline text-left"
              >
                {hasVariants ? 'Switch to single rate' : 'Use multiple VAT variants (e.g. AC / Non-AC)'}
              </button>
            </div>

            {!hasVariants ? (
              <div>
                <label htmlFor="rate-vat-single" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  VAT (%)
                </label>
                <input
                  id="rate-vat-single"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={singleVat}
                  onChange={(e) => setSingleVat(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
                />
              </div>
            ) : (
              <div className="space-y-2">
                {variants.map((v, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={v.label}
                      onChange={(e) => {
                        const next = [...variants];
                        next[idx] = { ...v, label: e.target.value };
                        setVariants(next);
                      }}
                      placeholder="Variant label (e.g. AC)"
                      className="min-w-0 flex-1 min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={v.rate}
                      onChange={(e) => {
                        const next = [...variants];
                        next[idx] = { ...v, rate: parseFloat(e.target.value) || 0 };
                        setVariants(next);
                      }}
                      placeholder="%"
                      className="w-20 sm:w-24 shrink-0 min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-right"
                    />
                    <button
                      type="button"
                      disabled={variants.length <= 2}
                      onClick={() => setVariants(variants.filter((_, i) => i !== idx))}
                      aria-label="Remove VAT variant"
                      className="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-lg border border-[var(--line)] text-[var(--danger-text)] disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setVariants([
                      ...variants,
                      { key: `v${variants.length + 1}`, label: 'Variant', rate: 0 },
                    ])
                  }
                  className="min-h-[36px] text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  + Add variant
                </button>
              </div>
            )}
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
