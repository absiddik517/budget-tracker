import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { upsertEconomicCode } from '../lib/firestoreOps';
import { canManageRates } from '../lib/permissions';
import { Modal } from './Modal';
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
  filter?: (entry: EconomicCodeDoc) => boolean;
}

function normalizeQuery(str: string): string {
  return str.trim().replace(/\s+/g, ' ').toLowerCase();
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!text) return null;
  const q = normalizeQuery(query);
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="bg-[var(--accent-soft)] text-[var(--accent)] rounded px-0.5 font-semibold">
        {match}
      </mark>
      {after}
    </>
  );
}

export function EconomicCodeSelect({
  value,
  onChange,
  label,
  placeholder = 'Select economic code…',
  error,
  disabled = false,
  clearable = false,
  includeInactive = false,
  includeSpecial = false,
  filter,
}: EconomicCodeSelectProps) {
  const { userDoc } = useAuth();
  const { pushToast } = useApp();
  const { economicCodes, getCodeEntry } = useEconomicCodes();

  const canAddCode = userDoc ? canManageRates(userDoc.role) : false;

  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  // Quick-add modal state (for DDO / Super Admin when no match)
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qaCode, setQaCode] = useState('');
  const [qaHeadName, setQaHeadName] = useState('');
  const [qaHeadNameBn, setQaHeadNameBn] = useState('');
  const [qaSaving, setQaSaving] = useState(false);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const selectedEntry = useMemo(
    () => (value ? getCodeEntry(value) || null : null),
    [value, getCodeEntry]
  );

  const baseOptions = useMemo(() => {
    return economicCodes.filter((item) => {
      if (!includeInactive && !item.active) return false;
      if (!includeSpecial && item.special) return false;
      if (filter && !filter(item)) return false;
      return true;
    });
  }, [economicCodes, includeInactive, includeSpecial, filter]);

  const filteredOptions = useMemo(() => {
    const q = normalizeQuery(search);
    if (!q) return baseOptions;
    const tokens = q.split(' ');

    const matched = baseOptions.filter((item) => {
      const codeNorm = item.code.toLowerCase();
      const enNorm = normalizeQuery(item.headName);
      const bnNorm = normalizeQuery(item.headNameBn);
      const combined = `${codeNorm} ${enNorm} ${bnNorm}`;
      return tokens.every((tok) => combined.includes(tok));
    });

    // Sort prefix code matches first
    return matched.sort((a, b) => {
      const aStarts = a.code.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.code.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.code.localeCompare(b.code);
    });
  }, [baseOptions, search]);

  useEffect(() => {
    if (open) {
      const idx = filteredOptions.findIndex((o) => o.code === value);
      setActiveIndex(idx >= 0 ? idx : 0);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    } else {
      setSearch('');
    }
  }, [open, value]); // intentionally only reset on open toggle

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [filteredOptions.length, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const el = optionRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  // Outside click closes desktop popover
  useEffect(() => {
    if (!open || !isDesktop) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, isDesktop]);

  const selectOption = (entry: EconomicCodeDoc) => {
    onChange(entry.code, entry);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) =>
          filteredOptions.length === 0 ? 0 : (prev + 1) % filteredOptions.length
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) =>
          filteredOptions.length === 0
            ? 0
            : (prev - 1 + filteredOptions.length) % filteredOptions.length
        );
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(Math.max(0, filteredOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[activeIndex]) {
          selectOption(filteredOptions[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
    }
  };

  const openQuickAdd = () => {
    const trimmed = search.trim();
    const digitsOnly = /^\d{1,7}$/.test(trimmed) ? trimmed : '';
    setQaCode(digitsOnly);
    setQaHeadName(digitsOnly ? '' : trimmed);
    setQaHeadNameBn('');
    setOpen(false);
    setQuickAddOpen(true);
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !canAddCode) return;
    setQaSaving(true);
    try {
      const created = await upsertEconomicCode(
        {
          code: qaCode,
          headName: qaHeadName,
          headNameBn: qaHeadNameBn,
          active: true,
        },
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', `Added economic code ${created.code}.`);
      setQuickAddOpen(false);
      onChange(created.code, created);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to create economic code.');
    } finally {
      setQaSaving(false);
    }
  };

  const activeOptionId =
    open && filteredOptions[activeIndex]
      ? `${baseId}-opt-${filteredOptions[activeIndex].code}`
      : undefined;

  const listContent = (
    <div className="flex flex-col max-h-full">
      <div className="p-2.5 border-b border-[var(--line)] shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search by code, English, or বাংলা…"
            aria-label="Search economic codes"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-labelledby={label ? labelId : undefined}
        className="overflow-y-auto overscroll-contain flex-1 max-h-[52dvh] lg:max-h-[280px] p-1.5 space-y-0.5"
      >
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-5 text-center space-y-2">
            <p className="text-sm text-[var(--muted)]">No matching code</p>
            {canAddCode && (
              <button
                type="button"
                onClick={openQuickAdd}
                className="min-h-[44px] px-4 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add economic code</span>
              </button>
            )}
          </div>
        ) : (
          filteredOptions.map((item, idx) => {
            const isSelected = item.code === value;
            const isActive = idx === activeIndex;
            return (
              <div
                key={item.code}
                id={`${baseId}-opt-${item.code}`}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => selectOption(item)}
                className={`min-h-[44px] px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-subtle)]'
                    : 'hover:bg-[var(--surface-subtle)]/70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--text)] tabular-nums">
                      <HighlightMatch text={item.code} query={search} />
                    </span>
                    {!item.active && (
                      <span className="text-[11px] text-[var(--muted)]">Inactive</span>
                    )}
                    {item.special && (
                      <span className="text-[11px] text-[var(--accent)]">Special</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                    <HighlightMatch text={item.headName} query={search} />
                    {item.headNameBn && (
                      <span className="bn ml-1.5">
                        <HighlightMatch text={item.headNameBn} query={search} />
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label
          id={labelId}
          className="block text-xs font-medium text-[var(--muted)] mb-1.5"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-stretch">
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-labelledby={label ? labelId : undefined}
          aria-activedescendant={activeOptionId}
          disabled={disabled}
          onClick={() => !disabled && setOpen((prev) => !prev)}
          onKeyDown={handleKeyDown}
          className={`w-full min-h-[48px] px-3.5 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
            error
              ? 'border-[var(--danger-text)] bg-[var(--card)]'
              : 'border-[var(--line)] bg-[var(--card)]'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--surface-subtle)]/40'}`}
        >
          <div className="min-w-0 flex-1">
            {value ? (
              <>
                <div className="text-sm font-semibold text-[var(--text)] tabular-nums truncate">
                  {value}
                </div>
                <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                  <span>{selectedEntry?.headName || 'Unknown economic code'}</span>
                  {selectedEntry?.headNameBn && (
                    <span className="bn ml-1.5">{selectedEntry.headNameBn}</span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-sm text-[var(--muted)]">{placeholder}</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {clearable && value && !disabled && <span className="w-10" aria-hidden="true" />}
            <ChevronDown
              className={`w-4 h-4 text-[var(--muted)] transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('', null);
              triggerRef.current?.focus();
            }}
            aria-label="Clear economic code"
            className="absolute right-8 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-[var(--danger-text)] mt-1 font-medium">{error}</p>
      )}

      {/* Desktop Popover */}
      {open && isDesktop && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-[14px] border border-[var(--line)] bg-[var(--card)] shadow-lg overflow-hidden">
          {listContent}
        </div>
      )}

      {/* Mobile Full-Width Bottom Sheet */}
      {open && !isDesktop && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50 overscroll-contain"
          role="presentation"
        >
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-h-[85dvh] flex flex-col bg-[var(--card)] border-t border-[var(--line)] rounded-t-[16px] overflow-hidden safe-bottom">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)] shrink-0">
              <span className="text-sm font-semibold text-[var(--text)] truncate">
                {label || 'Economic code'}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close code picker"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {listContent}
          </div>
        </div>
      )}

      {/* Quick Add Economic Code Modal for DDO & Super Admin */}
      <Modal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        title="Add Economic Code"
        subtitle="Creates a master economic code entry"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setQuickAddOpen(false)}
              className="w-full sm:w-auto min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              form={`${baseId}-qa-form`}
              disabled={qaSaving}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {qaSaving ? 'Saving…' : 'Save code'}
            </button>
          </div>
        }
      >
        <form id={`${baseId}-qa-form`} onSubmit={handleQuickAddSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${baseId}-qa-code`} className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Economic code (7 digits)
            </label>
            <input
              id={`${baseId}-qa-code`}
              type="text"
              inputMode="numeric"
              required
              pattern="\d{7}"
              title="Economic code must be 7 digits"
              value={qaCode}
              onChange={(e) => setQaCode(e.target.value)}
              placeholder="3211106"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
            />
          </div>
          <div>
            <label htmlFor={`${baseId}-qa-en`} className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Head of expenditure (English)
            </label>
            <input
              id={`${baseId}-qa-en`}
              type="text"
              required
              value={qaHeadName}
              onChange={(e) => setQaHeadName(e.target.value)}
              placeholder="Entertainment"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${baseId}-qa-bn`} className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              ব্যয়ের খাত (Bengali)
            </label>
            <input
              id={`${baseId}-qa-bn`}
              type="text"
              value={qaHeadNameBn}
              onChange={(e) => setQaHeadNameBn(e.target.value)}
              placeholder="আপ্যায়ন ব্যয়"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
