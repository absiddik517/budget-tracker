import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getCurrentFiscalYear } from '../lib/fy';
import { translate, type TranslationKey } from '../i18n';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import { DEFAULT_NET_PAYABLE_CODE, resolveTr21Clauses } from '../lib/tr21Defaults';
import { useAuth } from './AuthContext';
import type { EconomicCodeDoc, LanguageCode, OfficeSettings } from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface HeadLookupResult {
  code: string;
  headName: string;
  headNameBn: string;
  active: boolean;
  special: boolean;
  found: boolean;
}

interface AppContextValue {
  officeSettings: OfficeSettings;
  selectedFy: string;
  setSelectedFy: (fy: string) => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: TranslationKey) => string;
  toasts: ToastMessage[];
  pushToast: (type: ToastMessage['type'], text: string) => void;
  dismissToast: (id: string) => void;
  economicCodes: EconomicCodeDoc[];
  economicCodesLoading: boolean;
  getCodeEntry: (code: string) => EconomicCodeDoc | undefined;
  getHead: (
    code: string,
    fallback?: { headName?: string; headNameBn?: string }
  ) => HeadLookupResult;
  permissionDeniedPaths: string[];
  reportPermissionError: (path: string) => void;
  clearPermissionError: (path: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
const LANG_STORAGE_KEY = 'bt_language';

const defaultFy = getCurrentFiscalYear();
const defaultOfficeSettings: OfficeSettings = {
  officeName: 'Sample Office',
  address: '',
  activeFiscalYear: defaultFy,
  fiscalYears: [defaultFy],
  language: 'en',
  institutionalCode: '',
  defaultPayeeText: '',
  placeName: '',
  defaultNetPayableCode: DEFAULT_NET_PAYABLE_CODE,
  tr21Clauses: resolveTr21Clauses(null),
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { accessState } = useAuth();
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(defaultOfficeSettings);
  const [selectedFy, setSelectedFy] = useState<string>(defaultFy);
  const [fyInitializedFromServer, setFyInitializedFromServer] = useState(false);

  const [economicCodes, setEconomicCodes] = useState<EconomicCodeDoc[]>([]);
  const [economicCodesLoading, setEconomicCodesLoading] = useState(true);
  const [permissionDeniedPaths, setPermissionDeniedPaths] = useState<string[]>([]);

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === 'en' || saved === 'bn') return saved;
    } catch {
      // ignore
    }
    return 'en';
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const reportPermissionError = useCallback((path: string) => {
    setPermissionDeniedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const clearPermissionError = useCallback((path: string) => {
    setPermissionDeniedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : prev));
  }, []);

  useEffect(() => {
    if (accessState !== 'active') {
      setPermissionDeniedPaths([]);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'settings', 'office'),
      (snap) => {
        clearPermissionError('settings/office');
        if (snap.exists()) {
          const data = snap.data() as Partial<OfficeSettings>;
          const activeFy = data.activeFiscalYear || defaultFy;
          const fiscalYears =
            Array.isArray(data.fiscalYears) && data.fiscalYears.length > 0
              ? data.fiscalYears
              : [activeFy];
          setOfficeSettings({
            officeName: data.officeName || 'Government Office',
            address: data.address || '',
            activeFiscalYear: activeFy,
            fiscalYears,
            language: data.language || 'en',
            institutionalCode: data.institutionalCode || '',
            defaultPayeeText: data.defaultPayeeText || '',
            placeName: data.placeName || '',
            defaultNetPayableCode: data.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE,
            tr21Clauses: resolveTr21Clauses(data.tr21Clauses),
          });
          if (!fyInitializedFromServer) {
            setSelectedFy(activeFy);
            setFyInitializedFromServer(true);
          }
        }
      },
      (err) => {
        logFirestoreError(err, OperationType.GET, 'settings/office');
        if (isPermissionDeniedError(err)) {
          reportPermissionError('settings/office');
        }
      }
    );
    return () => unsub();
  }, [accessState, fyInitializedFromServer, clearPermissionError, reportPermissionError]);

  // Single Firestore listener for economicCodes across the entire app (cached offline)
  useEffect(() => {
    if (accessState !== 'active') {
      setEconomicCodes([]);
      setEconomicCodesLoading(false);
      return;
    }
    setEconomicCodesLoading(true);
    const unsub = onSnapshot(
      collection(db, 'economicCodes'),
      (snap) => {
        clearPermissionError('economicCodes');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as EconomicCodeDoc))
          .sort((a, b) => a.code.localeCompare(b.code));
        setEconomicCodes(list);
        setEconomicCodesLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'economicCodes');
        if (isPermissionDeniedError(err)) {
          reportPermissionError('economicCodes');
        }
        setEconomicCodesLoading(false);
      }
    );
    return () => unsub();
  }, [accessState, clearPermissionError, reportPermissionError]);

  const economicCodeMap = useMemo(() => {
    const map = new Map<string, EconomicCodeDoc>();
    for (const item of economicCodes) {
      map.set(item.code, item);
    }
    return map;
  }, [economicCodes]);

  const getCodeEntry = useCallback(
    (code: string) => economicCodeMap.get(code.trim()),
    [economicCodeMap]
  );

  const getHead = useCallback(
    (code: string, fallback?: { headName?: string; headNameBn?: string }): HeadLookupResult => {
      const trimmed = (code || '').trim();
      const found = economicCodeMap.get(trimmed);
      if (found) {
        return {
          code: found.code,
          headName: found.headName,
          headNameBn: found.headNameBn,
          active: found.active,
          special: found.special,
          found: true,
        };
      }
      return {
        code: trimmed,
        headName: fallback?.headName || trimmed,
        headNameBn: fallback?.headNameBn || '',
        active: true,
        special: trimmed === 'GENERAL-CONSTRUCTION',
        found: false,
      };
    },
    [economicCodeMap]
  );

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (type: ToastMessage['type'], text: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, text }]);
      setTimeout(() => {
        dismissToast(id);
      }, 5000);
    },
    [dismissToast]
  );

  return (
    <AppContext.Provider
      value={{
        officeSettings,
        selectedFy,
        setSelectedFy,
        language,
        setLanguage,
        t,
        toasts,
        pushToast,
        dismissToast,
        economicCodes,
        economicCodesLoading,
        getCodeEntry,
        getHead,
        permissionDeniedPaths,
        reportPermissionError,
        clearPermissionError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
