import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getCurrentFiscalYear } from '../lib/fy';
import { translate, type TranslationKey } from '../i18n';
import { useAuth } from './AuthContext';
import type { LanguageCode, OfficeSettings } from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
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
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { accessState } = useAuth();
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(defaultOfficeSettings);
  const [selectedFy, setSelectedFy] = useState<string>(defaultFy);
  const [fyInitializedFromServer, setFyInitializedFromServer] = useState(false);

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

  useEffect(() => {
    if (accessState !== 'active') return;
    const unsub = onSnapshot(
      doc(db, 'settings', 'office'),
      (snap) => {
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
          });
          if (!fyInitializedFromServer) {
            setSelectedFy(activeFy);
            setFyInitializedFromServer(true);
          }
        }
      },
      () => {
        // Offline or initial read error ignored silently
      }
    );
    return () => unsub();
  }, [accessState, fyInitializedFromServer]);

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
