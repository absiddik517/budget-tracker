import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User, UserPlus } from 'lucide-react';
import { Field, Select, TextInput, focusFirstInvalidField } from './form';
import type { SelectOption } from './form';
import type { UserDoc } from '../types';

export interface ResponsibleEmployeeValue {
  employeeMode: 'user' | 'manual';
  userId: string;
  employeeName: string;
  employeeDesignation: string;
}

export interface MentionedEmployeeEntry {
  userId?: string | null;
  name: string;
  designation: string;
}

export interface ResponsibleEmployeeSelectProps {
  value: ResponsibleEmployeeValue;
  onChange: (next: ResponsibleEmployeeValue) => void;
  activeUsers: UserDoc[];
  mentionedEmployees?: MentionedEmployeeEntry[];
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

function normText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function personKey(name: string, designation: string): string {
  return `${normText(name)}||${normText(designation)}`;
}

interface ManualEmployeeTabProps {
  initialName: string;
  initialDesignation: string;
  onConfirm: (name: string, designation: string) => void;
  onCancel: () => void;
}

function ManualEmployeeTab({
  initialName,
  initialDesignation,
  onConfirm,
  onCancel,
}: ManualEmployeeTabProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [designation, setDesignation] = useState(initialDesignation);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmedName = name.trim();
    const trimmedDesig = designation.trim();
    if (!trimmedName) {
      setNameError('দায়িত্বপ্রাপ্ত কর্মচারীর নাম দিন।');
      window.requestAnimationFrame(() => focusFirstInvalidField(formRef.current));
      return;
    }
    setNameError('');
    onConfirm(trimmedName, trimmedDesig);
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label="কর্মচারীর নাম" required error={nameError}>
        <TextInput
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError('');
          }}
          placeholder="কর্মচারীর নাম লিখুন"
          className="bn"
        />
      </Field>

      <Field label="পদবি">
        <TextInput
          type="text"
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="পদবি (যেমন: অফিস সহায়ক)"
          className="bn"
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          বাতিল
        </button>
        <button
          type="submit"
          className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          নির্বাচন ও সংযুক্ত করুন
        </button>
      </div>
    </form>
  );
}

interface ParsedOptionRecord {
  option: SelectOption;
  payload: ResponsibleEmployeeValue;
}

export function ResponsibleEmployeeSelect({
  value,
  onChange,
  activeUsers,
  mentionedEmployees = [],
  placeholder = 'কর্মচারী নির্বাচন বা হাতে লিখুন',
  disabled = false,
  error,
}: ResponsibleEmployeeSelectProps) {
  const { selectOptions, payloadByValue, currentSelectValue } = useMemo(() => {
    const records: ParsedOptionRecord[] = [];
    const seenPersonKeys = new Set<string>();
    const activeUserIds = new Set<string>();
    const optionValueByPersonKey = new Map<string, string>();

    // 1. Office Users
    for (const u of activeUsers) {
      const name = (u.name || '').trim();
      if (!name) continue;
      const desig = (u.designation || '').trim();
      const optVal = `user:${u.id}`;
      const pKey = personKey(name, desig);

      activeUserIds.add(u.id);
      seenPersonKeys.add(pKey);
      optionValueByPersonKey.set(pKey, optVal);

      records.push({
        option: {
          value: optVal,
          label: name,
          textLabel: name,
          subtitle: desig ? `পদবি: ${desig}` : undefined,
          metaRight: 'অফিস ইউজার',
          keywords: `${name} ${desig}`,
          icon: <User className="w-4 h-4" />,
        },
        payload: {
          employeeMode: 'user',
          userId: u.id,
          employeeName: name,
          employeeDesignation: desig,
        },
      });
    }

    // 2. Previously mentioned employees from expense items / bills / batch rows
    for (const emp of mentionedEmployees) {
      const name = (emp.name || '').trim();
      if (!name) continue;
      const desig = (emp.designation || '').trim();
      const pKey = personKey(name, desig);

      // Avoid duplicating active users unless name/designation differs cleanly
      if (seenPersonKeys.has(pKey)) continue;
      seenPersonKeys.add(pKey);

      const linkedActiveUser = emp.userId && activeUserIds.has(emp.userId);
      const optVal = `prev:${pKey}`;
      optionValueByPersonKey.set(pKey, optVal);

      records.push({
        option: {
          value: optVal,
          label: name,
          textLabel: name,
          subtitle: desig ? `পদবি: ${desig}` : undefined,
          metaRight: 'পূর্বের তথ্য',
          keywords: `${name} ${desig}`,
          icon: <User className="w-4 h-4" />,
        },
        payload: {
          employeeMode: linkedActiveUser ? 'user' : 'manual',
          userId: linkedActiveUser ? (emp.userId as string) : '',
          employeeName: name,
          employeeDesignation: desig,
        },
      });
    }

    // 3. Resolve currently selected value
    let resolvedValue = '';
    const trimmedName = value.employeeName.trim();
    const trimmedDesig = value.employeeDesignation.trim();

    if (value.employeeMode === 'user' && value.userId && activeUserIds.has(value.userId)) {
      resolvedValue = `user:${value.userId}`;
    } else if (trimmedName) {
      const currentKey = personKey(trimmedName, trimmedDesig);
      const matchedOptVal = optionValueByPersonKey.get(currentKey);
      if (matchedOptVal) {
        resolvedValue = matchedOptVal;
      } else {
        resolvedValue = `manual:${currentKey}`;
        records.unshift({
          option: {
            value: resolvedValue,
            label: trimmedName,
            textLabel: trimmedName,
            subtitle: trimmedDesig ? `পদবি: ${trimmedDesig}` : undefined,
            metaRight: 'হাতে লেখা',
            keywords: `${trimmedName} ${trimmedDesig}`,
            icon: <User className="w-4 h-4" />,
          },
          payload: {
            employeeMode: 'manual',
            userId: '',
            employeeName: trimmedName,
            employeeDesignation: trimmedDesig,
          },
        });
      }
    }

    const map = new Map<string, ResponsibleEmployeeValue>();
    for (const r of records) {
      map.set(r.option.value, r.payload);
    }

    return {
      selectOptions: records.map((r) => r.option),
      payloadByValue: map,
      currentSelectValue: resolvedValue,
    };
  }, [activeUsers, mentionedEmployees, value]);

  return (
    <Select
      value={currentSelectValue}
      options={selectOptions}
      onValueChange={(nextVal) => {
        if (!nextVal) {
          onChange({
            employeeMode: 'user',
            userId: '',
            employeeName: '',
            employeeDesignation: '',
          });
          return;
        }
        const matched = payloadByValue.get(nextVal);
        if (matched) {
          onChange(matched);
        }
      }}
      placeholder={placeholder}
      modalTitle="দায়িত্বপ্রাপ্ত কর্মচারী নির্বাচন ও সংযুক্তি"
      modalIcon={<UserPlus className="w-5 h-5" />}
      emptyIcon={<UserPlus className="w-4 h-4" />}
      optionIcon={<User className="w-4 h-4" />}
      searchable
      searchPlaceholder="নাম বা পদবি দিয়ে খুঁজুন…"
      emptyMessage="কোনো কর্মচারী পাওয়া যায়নি"
      clearable
      disabled={disabled}
      invalid={Boolean(error)}
      aria-label="দায়িত্বপ্রাপ্ত কর্মচারী"
      listTabLabel={`বিদ্যমান তালিকা (${selectOptions.length})`}
      createTabLabel="হাতে লিখুন"
      renderCreateTab={({ close, search }) => {
        const trimmedSearch = search.trim();
        const initialName =
          trimmedSearch || (value.employeeMode === 'manual' ? value.employeeName : '');
        const initialDesig =
          trimmedSearch ? '' : value.employeeMode === 'manual' ? value.employeeDesignation : '';

        return (
          <ManualEmployeeTab
            key={`${trimmedSearch}|${value.employeeName}|${value.employeeDesignation}`}
            initialName={initialName}
            initialDesignation={initialDesig}
            onCancel={close}
            onConfirm={(nextName, nextDesig) => {
              onChange({
                employeeMode: 'manual',
                userId: '',
                employeeName: nextName,
                employeeDesignation: nextDesig,
              });
              close();
            }}
          />
        );
      }}
    />
  );
}
