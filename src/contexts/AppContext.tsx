import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildActorSnapshot } from '../lib/actor';
import { getCurrentFiscalYear } from '../lib/fy';
import { translate, type TranslationKey } from '../i18n';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_TR21_FONT_FAMILY,
  DEFAULT_TR21_FONT_SIZE,
  DEFAULT_TR21_FOOTER_TEXT,
  DEFAULT_TR21_MARGINS,
  DEFAULT_TR21_P1S3_MODE,
  DEFAULT_TR21_VOUCHER_LABEL,
  DEFAULT_VAT_CODE,
  resolveTr21Clauses,
  resolveTr21FontFamily,
  resolveTr21FontSize,
  resolveTr21Margins,
  resolveTr21P1S3Mode,
  resolveTr21VoucherLabel,
} from '../lib/tr21Defaults';
import { useAuth } from './AuthContext';
import type {
  ActorSnapshot,
  EconomicCodeDoc,
  LanguageCode,
  OfficeDoc,
  OfficeRole,
  OfficeSettings,
  Role,
} from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface HeadLookupResult {
  code: string;
  headName: string;
  headNameBn: string;
  displayName: string;
  active: boolean;
  special: boolean;
  found: boolean;
}

export const ALL_OFFICES_ID = 'ALL';
export const LEGACY_UNMIGRATED_OFFICE_ID = '__LEGACY__';

interface AppContextValue {
  offices: OfficeDoc[];
  officesLoading: boolean;
  officesById: Map<string, OfficeDoc>;
  currentOfficeId: string | null;
  setCurrentOfficeId: (officeId: string) => void;
  currentOffice: OfficeDoc | null;
  currentOfficeRole: OfficeRole | null;
  effectiveRole: Role | null;
  isAllOfficesMode: boolean;
  isLegacyPreMigration: boolean;
  actorSnapshot: ActorSnapshot | null;
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
  officeName: 'Government Office',
  address: '',
  activeFiscalYear: defaultFy,
  fiscalYears: [defaultFy],
  language: 'bn',
  institutionalCode: '',
  ministryName: '',
  officeMobileNo: '',
  defaultPayeeText: '',
  placeName: '',
  defaultNetPayableCode: DEFAULT_NET_PAYABLE_CODE,
  defaultItCode: DEFAULT_IT_CODE,
  defaultVatCode: DEFAULT_VAT_CODE,
  defaultSecurityCode: DEFAULT_SECURITY_CODE,
  tr21FooterText: DEFAULT_TR21_FOOTER_TEXT,
  tr21FontFamily: DEFAULT_TR21_FONT_FAMILY,
  tr21FontSize: DEFAULT_TR21_FONT_SIZE,
  tr21P1S3Mode: DEFAULT_TR21_P1S3_MODE,
  tr21VoucherLabel: DEFAULT_TR21_VOUCHER_LABEL,
  tr21Margins: DEFAULT_TR21_MARGINS,
  tr21Clauses: resolveTr21Clauses(null),
};

function officeDocToSettings(office: OfficeDoc | null, fallback: OfficeSettings): OfficeSettings {
  if (!office) return fallback;
  const activeFy = office.activeFiscalYear || fallback.activeFiscalYear || defaultFy;
  const fiscalYears =
    Array.isArray(office.fiscalYears) && office.fiscalYears.length > 0
      ? office.fiscalYears
      : [activeFy];
  return {
    officeId: office.id,
    officeName: office.nameBn || office.name || fallback.officeName,
    officeNameBn: office.nameBn || office.name,
    officeCode: office.code,
    address: office.address ?? '',
    activeFiscalYear: activeFy,
    fiscalYears,
    language: office.language || fallback.language || 'bn',
    institutionalCode: office.institutionalCode ?? '',
    ministryName: office.ministryName ?? '',
    officeMobileNo: office.officeMobileNo ?? '',
    defaultPayeeText: office.defaultPayeeText ?? '',
    placeName: office.placeName ?? '',
    defaultNetPayableCode: office.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE,
    defaultItCode: office.defaultItCode || DEFAULT_IT_CODE,
    defaultVatCode: office.defaultVatCode || DEFAULT_VAT_CODE,
    defaultSecurityCode: office.defaultSecurityCode || DEFAULT_SECURITY_CODE,
    tr21FooterText: office.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT,
    tr21FontFamily: resolveTr21FontFamily(office.tr21FontFamily),
    tr21FontSize: resolveTr21FontSize(office.tr21FontSize),
    tr21P1S3Mode: resolveTr21P1S3Mode(office.tr21P1S3Mode),
    tr21VoucherLabel: resolveTr21VoucherLabel(office.tr21VoucherLabel),
    tr21Margins: resolveTr21Margins(office.tr21Margins, office.tr21VoucherLabel),
    tr21Clauses: resolveTr21Clauses(office.tr21Clauses),
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { accessState, userDoc, isSuperAdmin, myActivePostings } = useAuth();
  const [offices, setOffices] = useState<OfficeDoc[]>([]);
  const [officesLoading, setOfficesLoading] = useState(true);
  const [legacySettings, setLegacySettings] = useState<OfficeSettings>(defaultOfficeSettings);
  const [currentOfficeIdState, setCurrentOfficeIdState] = useState<string | null>(null);
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

  // Subscribe to offices (all for Super Admin, accessible subset for others)
  const accessKeysString = useMemo(
    () => (userDoc ? Object.keys(userDoc.access || {}).sort().join(',') : ''),
    [userDoc]
  );

  useEffect(() => {
    if (accessState !== 'active' || !userDoc) {
      setOffices([]);
      setOfficesLoading(false);
      setPermissionDeniedPaths([]);
      return;
    }

    setOfficesLoading(true);
    const accessibleIds = accessKeysString ? accessKeysString.split(',').filter(Boolean) : [];

    if (!isSuperAdmin && accessibleIds.length === 0) {
      setOffices([]);
      setOfficesLoading(false);
      return;
    }

    if (isSuperAdmin) {
      const unsub = onSnapshot(
        collection(db, 'offices'),
        (snap) => {
          clearPermissionError('offices');
          const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as OfficeDoc))
            .sort((a, b) => (a.nameBn || a.name).localeCompare(b.nameBn || b.name));
          setOffices(list);
          setOfficesLoading(false);
        },
        (err) => {
          logFirestoreError(err, OperationType.LIST, 'offices');
          if (isPermissionDeniedError(err)) reportPermissionError('offices');
          setOfficesLoading(false);
        }
      );

      return () => unsub();
    }

    // For non-SuperAdmin users, subscribe directly to each accessible office doc (allow get)
    // rather than a documentId() 'in' list query, avoiding Firestore Rules query-planner limits.
    const officeMap = new Map<string, OfficeDoc>();
    const settled = new Set<string>();
    const unsubs = accessibleIds.map((officeId) =>
      onSnapshot(
        doc(db, 'offices', officeId),
        (snap) => {
          clearPermissionError('offices');
          if (snap.exists()) {
            officeMap.set(officeId, { id: snap.id, ...snap.data() } as OfficeDoc);
          } else {
            officeMap.delete(officeId);
          }
          settled.add(officeId);
          const list = Array.from(officeMap.values()).sort((a, b) =>
            (a.nameBn || a.name).localeCompare(b.nameBn || b.name)
          );
          setOffices(list);
          if (settled.size >= accessibleIds.length) {
            setOfficesLoading(false);
          }
        },
        (err) => {
          logFirestoreError(err, OperationType.GET, `offices/${officeId}`);
          if (isPermissionDeniedError(err)) reportPermissionError('offices');
          settled.add(officeId);
          if (settled.size >= accessibleIds.length) {
            setOfficesLoading(false);
          }
        }
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [accessState, userDoc, isSuperAdmin, accessKeysString, clearPermissionError, reportPermissionError]);

  // Listen to legacy settings/office as fallback when no offices exist yet (pre-migration)
  useEffect(() => {
    if (accessState !== 'active') return;
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
          setLegacySettings({
            officeName: data.officeName || 'Government Office',
            address: data.address || '',
            activeFiscalYear: activeFy,
            fiscalYears,
            language: data.language || 'bn',
            institutionalCode: data.institutionalCode || '',
            ministryName: data.ministryName || '',
            officeMobileNo: data.officeMobileNo || '',
            defaultPayeeText: data.defaultPayeeText || '',
            placeName: data.placeName || '',
            defaultNetPayableCode: data.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE,
            defaultItCode: data.defaultItCode || DEFAULT_IT_CODE,
            defaultVatCode: data.defaultVatCode || DEFAULT_VAT_CODE,
            defaultSecurityCode: data.defaultSecurityCode || DEFAULT_SECURITY_CODE,
            tr21FooterText: data.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT,
            tr21FontFamily: resolveTr21FontFamily(data.tr21FontFamily),
            tr21FontSize: resolveTr21FontSize(data.tr21FontSize),
            tr21P1S3Mode: resolveTr21P1S3Mode(data.tr21P1S3Mode),
            tr21VoucherLabel: resolveTr21VoucherLabel(data.tr21VoucherLabel),
            tr21Margins: resolveTr21Margins(data.tr21Margins, data.tr21VoucherLabel),
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
      }
    );
    return () => unsub();
  }, [accessState, fyInitializedFromServer, clearPermissionError]);

  const storageKey = userDoc ? `bt_office_id_${userDoc.id}` : '';

  const setCurrentOfficeId = useCallback(
    (officeId: string) => {
      setCurrentOfficeIdState(officeId);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, officeId);
        } catch {
          // ignore
        }
      }
    },
    [storageKey]
  );

  // Resolve valid currentOfficeId whenever user/offices change
  useEffect(() => {
    if (accessState !== 'active' || !userDoc || officesLoading) return;

    let saved: string | null = null;
    if (storageKey) {
      try {
        saved = localStorage.getItem(storageKey);
      } catch {
        saved = null;
      }
    }

    if (isSuperAdmin) {
      if (offices.length === 0) {
        // Pre-migration single-office Super Admin fallback
        setCurrentOfficeIdState(LEGACY_UNMIGRATED_OFFICE_ID);
        return;
      }
      if (
        saved === ALL_OFFICES_ID ||
        (saved && offices.some((o) => o.id === saved))
      ) {
        setCurrentOfficeIdState(saved);
      } else {
        setCurrentOfficeIdState(ALL_OFFICES_ID);
      }
      return;
    }

    // Non-SuperAdmin user
    const accessibleIds = Object.keys(userDoc.access || {});
    if (accessibleIds.length === 0) {
      // Pre-migration legacy single-office role check
      if (userDoc.role === 'ddo' || userDoc.role === 'employee') {
        setCurrentOfficeIdState(LEGACY_UNMIGRATED_OFFICE_ID);
      } else {
        setCurrentOfficeIdState(null);
      }
      return;
    }

    if (saved && accessibleIds.includes(saved)) {
      setCurrentOfficeIdState(saved);
      return;
    }

    if (userDoc.homeOfficeId && accessibleIds.includes(userDoc.homeOfficeId)) {
      setCurrentOfficeIdState(userDoc.homeOfficeId);
      return;
    }

    setCurrentOfficeIdState(accessibleIds[0]);
  }, [accessState, userDoc, isSuperAdmin, offices, officesLoading, storageKey]);

  const officesById = useMemo(() => {
    const map = new Map<string, OfficeDoc>();
    for (const o of offices) map.set(o.id, o);
    return map;
  }, [offices]);

  const isLegacyPreMigration = currentOfficeIdState === LEGACY_UNMIGRATED_OFFICE_ID;
  const isAllOfficesMode = Boolean(isSuperAdmin && currentOfficeIdState === ALL_OFFICES_ID);

  const currentOffice = useMemo(() => {
    if (
      !currentOfficeIdState ||
      currentOfficeIdState === ALL_OFFICES_ID ||
      currentOfficeIdState === LEGACY_UNMIGRATED_OFFICE_ID
    ) {
      return null;
    }
    return officesById.get(currentOfficeIdState) || null;
  }, [currentOfficeIdState, officesById]);

  const currentOfficeRole: OfficeRole | null = useMemo(() => {
    if (!userDoc || isSuperAdmin) return null;
    if (isLegacyPreMigration) {
      if (userDoc.role === 'ddo' || userDoc.role === 'employee') return userDoc.role;
      return null;
    }
    if (!currentOfficeIdState || currentOfficeIdState === ALL_OFFICES_ID) return null;
    return userDoc.access?.[currentOfficeIdState] ?? null;
  }, [userDoc, isSuperAdmin, isLegacyPreMigration, currentOfficeIdState]);

  const effectiveRole: Role | null = useMemo(() => {
    if (isSuperAdmin) return 'superAdmin';
    return currentOfficeRole;
  }, [isSuperAdmin, currentOfficeRole]);

  const officeSettings = useMemo(
    () => officeDocToSettings(currentOffice, legacySettings),
    [currentOffice, legacySettings]
  );

  // Sync selectedFy when switching into a specific office
  useEffect(() => {
    if (currentOffice?.activeFiscalYear) {
      setSelectedFy(currentOffice.activeFiscalYear);
      setFyInitializedFromServer(true);
    }
  }, [currentOffice?.id, currentOffice?.activeFiscalYear]);

  const actorSnapshot = useMemo(() => {
    if (!userDoc) return null;
    if (isSuperAdmin) {
      return buildActorSnapshot({
        user: userDoc,
        officeId: null,
        role: 'superAdmin',
      });
    }
    const officeId =
      currentOfficeIdState &&
      currentOfficeIdState !== ALL_OFFICES_ID &&
      currentOfficeIdState !== LEGACY_UNMIGRATED_OFFICE_ID
        ? currentOfficeIdState
        : null;
    const role: Role = currentOfficeRole || 'employee';
    const matchingPosting =
      (officeId
        ? myActivePostings.find((p) => p.officeId === officeId && p.role === role) ||
          myActivePostings.find((p) => p.officeId === officeId)
        : null) || null;

    return buildActorSnapshot({
      user: userDoc,
      officeId,
      role,
      kind: matchingPosting?.kind ?? 'regular',
      workHistoryId: matchingPosting?.id ?? null,
      activePosting: matchingPosting,
    });
  }, [userDoc, isSuperAdmin, currentOfficeIdState, currentOfficeRole, myActivePostings]);

  // Single global listener for economicCodes
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
        if (isPermissionDeniedError(err)) reportPermissionError('economicCodes');
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
          displayName: found.headNameBn || found.headName || found.code,
          active: found.active,
          special: found.special,
          found: true,
        };
      }
      return {
        code: trimmed,
        headName: fallback?.headName || trimmed,
        headNameBn: fallback?.headNameBn || '',
        displayName: fallback?.headNameBn || fallback?.headName || trimmed,
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
        offices,
        officesLoading,
        officesById,
        currentOfficeId: currentOfficeIdState,
        setCurrentOfficeId,
        currentOffice,
        currentOfficeRole,
        effectiveRole,
        isAllOfficesMode,
        isLegacyPreMigration,
        actorSnapshot,
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
