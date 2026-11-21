import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Folder, FolderPlus, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { upsertEconomicCode } from '../lib/firestoreOps';
import { canManageRates } from '../lib/permissions';
import { Field, Select, TextInput, focusFirstInvalidField, useFieldContext } from './form';
import type { SelectOption } from './form';
import type { EconomicCodeDoc } from '../types';

export interface EconomicCodeSelectProps {
  value: string;
  onChange: (code: string, entry: EconomicCodeDoc | null) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  clearable?: boolean;
  includeInactive?: boolean;
  includeSpecial?: boolean;
  excludeCodes?: string[];
  filter?: (entry: EconomicCodeDoc) => boolean;
  variant?: 'card' | 'compact';
}

export function EconomicCodeSelect({
  value,
  onChange,
  label,
  placeholder = 'অর্থনৈতিক কোড নির্বাচন করুন',
  error,
  disabled = false,
  clearable = true,
  includeInactive = false,
  includeSpecial = false,
  excludeCodes,
  filter,
  variant = 'card',
}: EconomicCodeSelectProps) {
  const { userDoc } = useAuth();
  const { pushToast } = useApp();
  const { economicCodes, getCodeEntry } = useEconomicCodes();
  const fieldCtx = useFieldContext();

  const canAddCode = userDoc ? canManageRates(userDoc.role) : false;

  const qaFormRef = useRef<HTMLFormElement>(null);
  const [qaCode, setQaCode] = useState('');
  const [qaHeadNameBn, setQaHeadNameBn] = useState('');
  const [qaCodeError, setQaCodeError] = useState('');
  const [qaHeadError, setQaHeadError] = useState('');
  const [qaSaving, setQaSaving] = useState(false);

  const selectedEntry = useMemo(
    () => (value ? getCodeEntry(value) || null : null),
    [value, getCodeEntry]
  );

  const excludedSet = useMemo(() => {
    if (!excludeCodes || excludeCodes.length === 0) return null;
    const s = new Set(excludeCodes.map((c) => c.trim()).filter(Boolean));
    if (value) s.delete(value.trim());
    return s;
  }, [excludeCodes, value]);

  const baseOptions = useMemo(() => {
    return economicCodes.filter((item) => {
      if (!includeInactive && !item.active) return false;
      if (!includeSpecial && item.special) return false;
      if (excludedSet && excludedSet.has(item.code)) return false;
      if (filter && !filter(item)) return false;
      return true;
    });
  }, [economicCodes, includeInactive, includeSpecial, excludedSet, filter]);

  const selectOptions: SelectOption[] = useMemo(() => {
    const mapped: SelectOption[] = baseOptions.map((item) => ({
      value: item.code,
      label: item.headNameBn || item.headName,
      textLabel: `${item.code} ${item.headNameBn || item.headName}`,
      subtitle: `কোড: ${item.code}`,
      metaRight: item.special ? 'Special' : !item.active ? 'Inactive' : undefined,
      keywords: `${item.code} ${item.headName} ${item.headNameBn}`,
      icon: <Folder className="w-4 h-4" />,
    }));

    // If the current value isn't in baseOptions (e.g. inactive or missing), keep it displayable
    if (value && !mapped.some((o) => o.value === value)) {
      mapped.unshift({
        value,
        label: selectedEntry?.headNameBn || selectedEntry?.headName || 'অজানা অর্থনৈতিক কোড',
        textLabel: `${value} ${selectedEntry?.headNameBn || selectedEntry?.headName || ''}`,
        subtitle: `কোড: ${value}`,
        icon: <Folder className="w-4 h-4" />,
      });
    }
    return mapped;
  }, [baseOptions, value, selectedEntry]);

  const handleQuickAddSubmit = async (
    e: React.FormEvent,
    closePicker: () => void
  ) => {
    e.preventDefault();
    if (!userDoc || !canAddCode) return;

    const nextCode = qaCode.trim();
    const nextHead = qaHeadNameBn.trim();
    let hasError = false;
    if (!/^\d{7}$/.test(nextCode)) {
      setQaCodeError('Economic code must be 7 digits.');
      hasError = true;
    } else {
      setQaCodeError('');
    }
    if (!nextHead) {
      setQaHeadError('ব্যয়ের খাত লিখুন।');
      hasError = true;
    } else {
      setQaHeadError('');
    }
    if (hasError) {
      window.requestAnimationFrame(() => focusFirstInvalidField(qaFormRef.current));
      return;
    }

    setQaSaving(true);
    try {
      const created = await upsertEconomicCode(
        {
          code: nextCode,
          headName: nextHead,
          headNameBn: nextHead,
          active: true,
        },
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', `Added economic code ${created.code}.`);
      setQaCode('');
      setQaHeadNameBn('');
      setQaCodeError('');
      setQaHeadError('');
      onChange(created.code, created);
      closePicker();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to create economic code.');
    } finally {
      setQaSaving(false);
    }
  };

  const isInvalid = Boolean(error || fieldCtx.invalid);

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="block text-[13px] font-semibold text-[var(--text)] leading-snug">
          {label}
        </span>
      )}

      <Select
        value={value}
        options={selectOptions}
        onValueChange={(nextCode) => {
          const entry = nextCode ? getCodeEntry(nextCode) || null : null;
          onChange(nextCode, entry);
        }}
        placeholder={placeholder}
        modalTitle="অর্থনৈতিক কোড নির্বাচন ও সংযুক্তি"
        modalIcon={<FolderPlus className="w-5 h-5" />}
        emptyIcon={<FolderPlus className="w-4 h-4" />}
        optionIcon={<Folder className="w-4 h-4" />}
        searchable
        searchPlaceholder="কোড বা ব্যয়ের খাত খুঁজুন…"
        emptyMessage="কোনো অর্থনৈতিক কোড পাওয়া যায়নি"
        clearable={clearable}
        variant={variant}
        disabled={disabled}
        invalid={isInvalid}
        aria-label={label || placeholder}
        listTabLabel={canAddCode ? `বিদ্যমান কোড তালিকা (${baseOptions.length})` : undefined}
        createTabLabel={canAddCode ? 'নতুন কোড সংযুক্তি' : undefined}
        renderCreateTab={
          canAddCode
            ? ({ close }) => (
                <form
                  ref={qaFormRef}
                  onSubmit={(e) => handleQuickAddSubmit(e, close)}
                  noValidate
                  className="space-y-4"
                >
                  <Field label="Economic code (7 digits)" required error={qaCodeError}>
                    <TextInput
                      type="text"
                      inputMode="numeric"
                      maxLength={7}
                      value={qaCode}
                      onChange={(e) => {
                        setQaCode(e.target.value);
                        if (qaCodeError) setQaCodeError('');
                      }}
                      placeholder="3211106"
                      className="tabular-nums"
                    />
                  </Field>

                  <Field label="ব্যয়ের খাত" required error={qaHeadError}>
                    <TextInput
                      type="text"
                      value={qaHeadNameBn}
                      onChange={(e) => {
                        setQaHeadNameBn(e.target.value);
                        if (qaHeadError) setQaHeadError('');
                      }}
                      placeholder="আপ্যায়ন ব্যয়"
                      className="bn"
                    />
                  </Field>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={qaSaving}
                      onClick={close}
                      className="min-h-[44px] px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-sm font-semibold disabled:opacity-50"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={qaSaving}
                      className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      {qaSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                      <span>{qaSaving ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ ও নির্বাচন'}</span>
                    </button>
                  </div>
                </form>
              )
            : undefined
        }
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 text-xs text-[var(--danger-text)] leading-snug"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
