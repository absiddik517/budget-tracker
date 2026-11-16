import { Timestamp } from 'firebase/firestore';

export type Role = 'superAdmin' | 'ddo' | 'employee';
export type UserStatus = 'invited' | 'active' | 'disabled';
export type ThemeMode = 'light' | 'dark' | 'system';
export type LanguageCode = 'en' | 'bn';

export interface BaseAuditFields {
  createdAt?: Timestamp | null;
  createdBy?: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

export interface UserDoc extends BaseAuditFields {
  id: string;
  name: string;
  designation: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastActiveAt?: Timestamp | null;
}

export interface InviteDoc extends BaseAuditFields {
  id: string; // emailLowercase
  email: string;
  name?: string;
  role: Role;
  designation: string;
  invitedBy: string;
}

export interface OfficeSettings extends BaseAuditFields {
  officeName: string;
  address: string;
  activeFiscalYear: string;
  fiscalYears: string[];
  language: LanguageCode;
}

export interface VatVariant {
  key: string;
  label: string;
  rate: number;
}

export interface VatTaxRateDoc extends BaseAuditFields {
  id: string; // `${fiscalYear}_${economicCode}`
  fiscalYear: string;
  economicCode: string;
  description: string;
  descriptionBn: string;
  incomeTax: number;
  vat: VatVariant[];
}

export interface DeductionRates {
  basis: 'gross';
  incomeTax: number;
  vat: VatVariant[];
  serviceCharge: number;
}

export type BudgetEntryType = 'original' | 'revision';
export type BudgetStatus = 'active' | 'executed';

export interface BudgetDoc extends BaseAuditFields {
  id: string;
  fiscalYear: string;
  memoNo: string;
  memoDate: string; // YYYY-MM-DD
  economicCode: string;
  headName: string;
  headNameBn: string;
  allocated: number; // integer paisa (may be negative for reduction revision)
  entryType: BudgetEntryType;
  revisionOf: string | null;
  deductionRates: DeductionRates;
  spent: number; // integer paisa
  remaining: number; // integer paisa
  status: BudgetStatus;
  deleted?: boolean;
}

export type SpendingStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'voided';

export interface OtherDeduction {
  label: string;
  amount: number; // integer paisa
}

export interface SpendingDeductions {
  vat: number; // integer paisa
  it: number; // integer paisa
  serviceCharge: number; // integer paisa
  others: OtherDeduction[];
}

export interface DeductionsApplied {
  vatRate: number;
  itRate: number;
  serviceChargeRate: number;
}

export interface SpendingDoc extends BaseAuditFields {
  id: string;
  budgetId: string;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string; // YYYY-MM-DD
  billNo: string;
  chequeNo: string | null;
  payee: string;
  gross: number; // integer paisa
  vatVariant: string;
  deductions: SpendingDeductions;
  netPayable: number; // integer paisa
  deductionsApplied: DeductionsApplied;
  status: SpendingStatus;
  submittedAt: Timestamp | null;
  approvedBy: string | null;
  approvedAt: Timestamp | null;
  rejectReason: string | null;
  voidedBy: string | null;
  voidedAt: Timestamp | null;
  voidReason: string | null;
  deleted: boolean;
  createdByName?: string;
}

export type SpendingLimitType = 'code' | 'budget';
export type SpendingLimitStatus = 'active' | 'withdrawn';

export interface SpendingLimitDoc extends BaseAuditFields {
  id: string;
  type: SpendingLimitType;
  budgetId: string | null;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn: string;
  rate: number; // percentage e.g. 80
  unit: 'percent';
  effectiveDate: string; // YYYY-MM-DD
  refNo: string;
  status: SpendingLimitStatus;
}

export interface FyCodeTotalDoc extends BaseAuditFields {
  id: string; // `${fiscalYear}_${economicCode}`
  fiscalYear: string;
  economicCode: string;
  allocated: number; // integer paisa
  spent: number; // integer paisa
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'void';

export interface AuditLogDoc {
  id: string;
  collection: string;
  docId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userId: string;
  userName: string;
  timestamp: Timestamp | null;
}
