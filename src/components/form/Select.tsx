import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ListFilter, PlusCircle, Search, X } from 'lucide-react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';
import { useBackHandler } from '../../lib/backStack';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  /** Plain text override used for compact trigger / search filtering when label is JSX */
  textLabel?: string;
  subtitle?: React.ReactNode;
  metaRight?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  keywords?: string;
  disabled?: boolean;
}

export interface SelectChangeEvent {
  target: { value: string };
  currentTarget: { value: string };
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange?: (e: SelectChangeEvent) => void;
  onValueChange?: (value: string, option: SelectOption | null) => void;
  options?: SelectOption[];
  children?: React.ReactNode;
  placeholder?: string;
  modalTitle?: string;
  modalIcon?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  optionIcon?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  variant?: 'card' | 'compact';
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  listTabLabel?: string;
  createTabLabel?: string;
  renderCreateTab?: (helpers: { close: () => void; search: string }) => React.ReactNode;
  onCreateSuccess?: () => void;
}

function nodeToText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeToText(node.props.children);
  }
  return '';
}

function parseOptionsFromChildren(children: React.ReactNode): {
  parsedOptions: SelectOption[];
  emptyOptionPlaceholder?: string;
  hasEmptyOption: boolean;
} {
  const parsedOptions: SelectOption[] = [];
  let emptyOptionPlaceholder: string | undefined;
  let hasEmptyOption = false;

  const walk = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children);
        return;
      }
      if (child.type === 'optgroup') {
        walk((child.props as { children?: React.ReactNode }).children);
        return;
      }
      if (child.type === 'option') {
        const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
        const optValue = props.value !== undefined ? String(props.value) : nodeToText(props.children);
        const text = nodeToText(props.children).trim();
        if (optValue === '') {
          hasEmptyOption = true;
          if (!emptyOptionPlaceholder && text) {
            emptyOptionPlaceholder = text;
          }
          return;
        }
        parsedOptions.push({
          value: optValue,
          label: props.children,
          textLabel: text,
          disabled: Boolean(props.disabled),
        });
      }
    });
  };

  walk(children);
  return { parsedOptions, emptyOptionPlaceholder, hasEmptyOption };
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    id,
    value,
    onChange,
    onValueChange,
    options,
    children,
    placeholder,
    modalTitle,
    modalIcon,
    emptyIcon,
    optionIcon,
    searchable,
    searchPlaceholder = 'নাম বা কোড দিয়ে খুঁজুন…',
    emptyMessage = 'কোনো ফলাফল পাওয়া যায়নি',
    clearable,
    variant = 'card',
    disabled = false,
    invalid,
    required,
    className = '',
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    listTabLabel,
    createTabLabel,
    renderCreateTab,
  },
  forwardedRef
) {
  const ctx = useFieldContext();
  const baseId = useId();
  const resolvedId = id ?? ctx.inputId ?? `${baseId}-select`;
  const titleId = `${baseId}-modal-title`;
  const listboxId = `${baseId}-listbox`;
  const isInvalid = Boolean(invalid ?? (ariaInvalid === true || ariaInvalid === 'true') ?? ctx.invalid);
  const resolvedDescribedBy = mergeDescribedBy(ctx.describedBy, ariaDescribedBy);

  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setTriggerRef = useCallback(
    (el: HTMLButtonElement | null) => {
      internalTriggerRef.current = el;
      if (typeof forwardedRef === 'function') {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    },
    [forwardedRef]
  );

  const { parsedOptions, emptyOptionPlaceholder, hasEmptyOption } = useMemo(
    () =>
      options
        ? {
            parsedOptions: options,
            emptyOptionPlaceholder: undefined,
            hasEmptyOption: false,
          }
        : parseOptionsFromChildren(children),
    [options, children]
  );

  const resolvedPlaceholder = placeholder || emptyOptionPlaceholder || 'নির্বাচন করুন';
  const resolvedModalTitle = modalTitle || ariaLabel || resolvedPlaceholder;
  const resolvedClearable = clearable !== undefined ? clearable : hasEmptyOption;
  const hasCreateTab = Boolean(renderCreateTab && createTabLabel);
  const resolvedSearchable =
    searchable !== undefined ? searchable : parsedOptions.length > 5 || hasCreateTab;

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedOption = useMemo(
    () => parsedOptions.find((o) => o.value === value) || null,
    [parsedOptions, value]
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!q) return parsedOptions;
    const tokens = q.split(' ');
    return parsedOptions.filter((opt) => {
      const combined = [
        opt.value,
        opt.textLabel ?? nodeToText(opt.label),
        nodeToText(opt.subtitle),
        nodeToText(opt.metaRight),
        opt.keywords ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => combined.includes(tok));
    });
  }, [parsedOptions, search]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setSearch('');
    setActiveTab('list');
    window.requestAnimationFrame(() => {
      internalTriggerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  // Close the custom picker dialog when Android hardware Back is pressed.
  useBackHandler(open, closeModal);

  const emitChange = useCallback(
    (nextValue: string, opt: SelectOption | null) => {
      if (onChange) {
        onChange({
          target: { value: nextValue },
          currentTarget: { value: nextValue },
        });
      }
      if (onValueChange) {
        onValueChange(nextValue, opt);
      }
    },
    [onChange, onValueChange]
  );

  const handleSelectOption = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      emitChange(opt.value, opt);
      closeModal();
    },
    [emitChange, closeModal]
  );

  useEffect(() => {
    if (!open) return;
    const idx = parsedOptions.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    setActiveTab('list');
    const raf = window.requestAnimationFrame(() => {
      if (resolvedSearchable && searchInputRef.current) {
        searchInputRef.current.focus({ preventScroll: true });
      } else {
        dialogRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, parsedOptions, value, resolvedSearchable]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [filteredOptions.length, activeIndex]);

  useEffect(() => {
    if (!open || activeTab !== 'list') return;
    const el = optionRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open, activeTab]);

  // Capture-phase Escape & Tab trap while picker modal is open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (nodes.length === 0) {
          e.preventDefault();
          dialogRef.current.focus({ preventScroll: true });
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const current = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!current || current === first || !dialogRef.current.contains(current)) {
            e.preventDefault();
            last.focus({ preventScroll: true });
          }
        } else if (!current || current === last || !dialogRef.current.contains(current)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeModal]);

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (activeTab !== 'list') return;
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
        if (document.activeElement === searchInputRef.current) {
          e.preventDefault();
          if (filteredOptions[activeIndex]) {
            handleSelectOption(filteredOptions[activeIndex]);
          }
        }
        break;
    }
  };

  const hasSelection = Boolean(selectedOption || (value !== '' && value !== undefined));
  const displayPrimary = selectedOption
    ? selectedOption.label
    : value !== ''
      ? value
      : resolvedPlaceholder;
  const displaySubtitle = selectedOption?.subtitle;
  const displayMetaRight = selectedOption?.metaRight;
  const displayIcon = selectedOption?.icon ?? optionIcon;

  const showClearBtn = resolvedClearable && hasSelection && !disabled;

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  const pickerModal =
    open && portalTarget
      ? createPortal(
          <div
            data-picker-select-open="true"
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-[var(--backdrop)] overscroll-contain no-print"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="fixed inset-0" onClick={closeModal} aria-hidden="true" />
            <div
              ref={dialogRef}
              tabIndex={-1}
              onKeyDown={handleListKeyDown}
              className="relative z-10 w-full max-w-[480px] max-h-[82dvh] flex flex-col rounded-[20px] border border-[var(--line)] bg-[var(--card)] text-[var(--text)] overflow-hidden focus:outline-none"
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--line)] shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  {(modalIcon || optionIcon) && (
                    <span className="text-[var(--accent)] shrink-0" aria-hidden="true">
                      {modalIcon || optionIcon}
                    </span>
                  )}
                  <h2
                    id={titleId}
                    className="text-[17px] font-bold text-[var(--text)] leading-snug truncate"
                  >
                    {resolvedModalTitle}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="বন্ধ করুন"
                  className="min-h-[44px] min-w-[44px] -mr-1 inline-flex items-center justify-center rounded-xl text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {/* Optional 2-Tab Switcher (List | Create New) */}
              {hasCreateTab && (
                <div
                  role="tablist"
                  className="grid grid-cols-2 border-b border-[var(--line)] bg-[var(--card)] shrink-0"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'list'}
                    onClick={() => setActiveTab('list')}
                    className={`min-h-[46px] px-3 text-sm font-semibold transition-colors border-b-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                      activeTab === 'list'
                        ? 'border-[var(--accent)] text-[var(--accent)]'
                        : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {listTabLabel || `বিদ্যমান তালিকা (${parsedOptions.length})`}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'create'}
                    onClick={() => setActiveTab('create')}
                    className={`min-h-[46px] px-3 text-sm font-semibold transition-colors border-b-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                      activeTab === 'create'
                        ? 'border-[var(--accent)] text-[var(--accent)]'
                        : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {createTabLabel}
                  </button>
                </div>
              )}

              {/* Tab Content */}
              {activeTab === 'create' && renderCreateTab ? (
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
                  {renderCreateTab({ close: closeModal, search })}
                </div>
              ) : (
                <>
                  {resolvedSearchable && (
                    <div className="px-4 pt-3.5 pb-1 shrink-0">
                      <div className="relative">
                        <Search
                          className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          ref={searchInputRef}
                          type="text"
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value);
                            setActiveIndex(0);
                          }}
                          placeholder={searchPlaceholder}
                          aria-label={searchPlaceholder}
                          className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[16px] md:text-sm text-[var(--text)] placeholder:text-[var(--muted)] placeholder:opacity-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] focus:border-[var(--accent)]"
                        />
                      </div>
                    </div>
                  )}

                  <div
                    id={listboxId}
                    role="listbox"
                    aria-labelledby={titleId}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2.5"
                  >
                    {filteredOptions.length === 0 ? (
                      <div className="py-8 text-center space-y-3">
                        <p className="text-sm text-[var(--muted)]">{emptyMessage}</p>
                        {hasCreateTab && (
                          <button
                            type="button"
                            onClick={() => setActiveTab('create')}
                            className="min-h-[44px] px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)] text-sm font-semibold inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                          >
                            <PlusCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>{createTabLabel}</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredOptions.map((opt, idx) => {
                        const isSelected = opt.value === value;
                        const isActive = idx === activeIndex;
                        const cardIcon = opt.icon ?? optionIcon;
                        const hasMetaRow = Boolean(opt.subtitle || opt.metaRight);

                        return (
                          <button
                            key={opt.value}
                            ref={(el) => {
                              optionRefs.current[idx] = el;
                            }}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            disabled={opt.disabled}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => handleSelectOption(opt)}
                            className={`w-full text-left rounded-xl border p-3.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                              isSelected
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                : isActive
                                  ? 'border-[var(--accent)] bg-[var(--surface-subtle)]'
                                  : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]/60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {cardIcon && (
                                  <span className="text-[var(--accent)] shrink-0" aria-hidden="true">
                                    {cardIcon}
                                  </span>
                                )}
                                <span className="text-sm font-bold text-[var(--text)] leading-snug break-words">
                                  {opt.label}
                                </span>
                                {opt.badge && <span className="shrink-0">{opt.badge}</span>}
                              </div>
                              {isSelected && (
                                <Check
                                  className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5"
                                  aria-hidden="true"
                                />
                              )}
                            </div>

                            {hasMetaRow && (
                              <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)] mt-1.5">
                                <span className="min-w-0 truncate">{opt.subtitle}</span>
                                {opt.metaRight && (
                                  <span className="shrink-0 tabular-nums">{opt.metaRight}</span>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>,
          portalTarget
        )
      : null;

  if (variant === 'compact') {
    return (
      <div className={`relative w-full ${className}`}>
        <div className="relative flex items-stretch">
          <button
            ref={setTriggerRef}
            id={resolvedId}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={listboxId}
            aria-label={ariaLabel}
            aria-invalid={isInvalid ? true : undefined}
            aria-describedby={resolvedDescribedBy}
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            className={`w-full min-h-[44px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              isInvalid
                ? 'border-[var(--danger-solid)] bg-[var(--card)]'
                : hasSelection
                  ? 'border-[var(--accent)]/45 bg-[var(--accent-soft)]'
                  : 'border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)]/50'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="min-w-0 flex-1 flex items-center gap-2">
              {displayIcon && (
                <span className="text-[var(--accent)] shrink-0" aria-hidden="true">
                  {displayIcon}
                </span>
              )}
              <span
                className={`text-sm truncate ${
                  hasSelection ? 'font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                }`}
              >
                {displayPrimary}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {showClearBtn && <span className="w-8" aria-hidden="true" />}
              <ChevronDown className="w-4 h-4 text-[var(--muted)] shrink-0" aria-hidden="true" />
            </div>
          </button>

          {showClearBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                emitChange('', null);
                internalTriggerRef.current?.focus({ preventScroll: true });
              }}
              aria-label="নির্বাচন মুছুন"
              className="absolute right-7 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {pickerModal}
      </div>
    );
  }

  // Default 'card' variant matching attached screenshots
  return (
    <div className={`relative w-full ${className}`}>
      {!hasSelection ? (
        <button
          ref={setTriggerRef}
          id={resolvedId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={listboxId}
          aria-label={ariaLabel}
          aria-invalid={isInvalid ? true : undefined}
          aria-describedby={resolvedDescribedBy}
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          className={`w-full min-h-[56px] px-4 py-3 rounded-xl border-[1.5px] border-dashed flex items-center justify-center gap-2 text-center bg-[var(--card)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
            isInvalid
              ? 'border-[var(--danger-solid)]'
              : 'border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/35'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[var(--accent)] shrink-0" aria-hidden="true">
            {emptyIcon || optionIcon || <ListFilter className="w-4 h-4" />}
          </span>
          <span className="text-sm font-semibold text-[var(--accent)]">{resolvedPlaceholder}</span>
        </button>
      ) : (
        <div className="relative flex items-stretch">
          <button
            ref={setTriggerRef}
            id={resolvedId}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={listboxId}
            aria-label={ariaLabel}
            aria-invalid={isInvalid ? true : undefined}
            aria-describedby={resolvedDescribedBy}
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            className={`w-full min-h-[56px] px-4 py-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              isInvalid
                ? 'border-[var(--danger-solid)] bg-[var(--danger-bg)]/40'
                : 'border-[var(--accent)]/40 bg-[var(--accent-soft)] hover:border-[var(--accent)]'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {displayIcon && (
                  <span className="text-[var(--accent)] shrink-0" aria-hidden="true">
                    {displayIcon}
                  </span>
                )}
                <span className="text-sm font-bold text-[var(--text)] leading-snug break-words">
                  {displayPrimary}
                </span>
              </div>
              {(displaySubtitle || displayMetaRight) && (
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)] mt-1">
                  <span className="min-w-0 truncate">{displaySubtitle}</span>
                  {displayMetaRight && (
                    <span className="shrink-0 tabular-nums">{displayMetaRight}</span>
                  )}
                </div>
              )}
            </div>

            {showClearBtn ? (
              <span className="w-9 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--muted)] shrink-0" aria-hidden="true" />
            )}
          </button>

          {showClearBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                emitChange('', null);
                internalTriggerRef.current?.focus({ preventScroll: true });
              }}
              aria-label="নির্বাচন মুছুন"
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--card)]/60 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {pickerModal}
    </div>
  );
});
