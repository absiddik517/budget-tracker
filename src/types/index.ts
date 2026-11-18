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

export interface CertificationClause {
  id: string;
  numberBn: string;
  text: string;
  enabled: boolean;
  page: 1 | 2;
}

export interface OfficeSettings extends BaseAuditFields {
  officeName: string;
  address: string;
  activeFiscalYear: string;
  fiscalYears: string[];
  language: LanguageCode;
  ministryName?: string;
  officeMobileNo?: string;
  institutionalCode?: string;
  defaultPayeeText?: string;
  placeName?: string;
  defaultNetPayableCode?: string;
  defaultItCode?: string;
  defaultVatCode?: string;
  defaultSecurityCode?: string;
  tr21FooterText?: string;
  tr21FontFamily?: string;
  tr21FontSize?: number;
  tr21Clauses?: CertificationClause[];
}

export interface EconomicCodeDoc extends BaseAuditFields {
  id: string; // same as code
  code: string; // 7 digits or GENERAL-CONSTRUCTION
  headName: string;
  headNameBn: string;
  active: boolean;
  special: boolean; // true only for GENERAL-CONSTRUCTION
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
  spent: number; // integer paisa (approved spent)
  approvedSpent?: number; // mirror of spent for explicit clarity
  pendingAmount?: number; // integer paisa held by submitted bills
  remaining: number; // integer paisa (allocated - spent - pendingAmount)
  status: BudgetStatus;
  deleted?: boolean;
}

export interface ResponsibleEmployee {
  userId?: string | null;
  name: string;
  designation: string;
}

export type ExpenseItemStatus = 'listed' | 'billed';

export interface ExpenseItemDoc extends BaseAuditFields {
  id: string;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // integer paisa (gross only, no VAT/IT)
  responsibleEmployee: ResponsibleEmployee;
  status: ExpenseItemStatus;
  billId: string | null;
  createdByName?: string;
  deleted: boolean;
}

export type BillStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface BillItemSnapshot {
  id: string;
  date: string;
  description: string;
  amount: number; // integer paisa
  responsibleEmployee: ResponsibleEmployee;
}

export interface BillBudgetSlice {
  budgetId: string;
  amount: number; // integer paisa
}

export interface BillDeductionLine {
  id: string;
  code: string;
  name: string;
  rate?: number | null;
  amount: number; // integer paisa
  kind?: 'it' | 'vat' | 'security' | 'other';
}

export interface BillSupplierInfo {
  name?: string;
  address?: string;
  tinBin?: string;
}

export interface BillDoc extends BaseAuditFields {
  id: string;
  billNo: string; // sequential per FY on submit e.g. "2025-26/001"
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string; // YYYY-MM-DD
  billDate?: string; // optional explicit T.R. 21 bill date (falls back to date)
  tokenNo?: string;
  purposeText?: string;
  payeeText?: string;
  netPayableCode?: string;
  supplier?: BillSupplierInfo | null;
  deductions?: BillDeductionLine[];
  itemIds: string[];
  items: BillItemSnapshot[];
  grossAmount: number; // integer paisa
  vatRate: number; // snapshot %
  itRate: number; // snapshot %
  vatVariant: string;
  vatVariantLabel?: string;
  vatAmount: number; // integer paisa
  itAmount: number; // integer paisa
  totalDeduction: number; // integer paisa (sum of deductions or vatAmount + itAmount)
  netPayable: number; // integer paisa (grossAmount - totalDeduction)
  status: BillStatus;
  submittedAt: Timestamp | null;
  submittedBy?: string | null;
  approvedBy: string | null;
  approvedAt: Timestamp | null;
  rejectReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Timestamp | null;
  cancelReason: string | null;
  pendingSlices?: BillBudgetSlice[];
  budgetDeductions?: BillBudgetSlice[];
  migratedFromSpendingId?: string | null;
  createdByName?: string;
  deleted: boolean;
}

export interface FyCounterDoc {
  id: string; // `${fiscalYear}_bill`
  fiscalYear: string;
  nextNumber: number;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

// Legacy Spending types preserved for Settings migration utility
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
  spent: number; // integer paisa (approved spent)
  approvedSpent?: number; // mirror of spent
  pendingAmount?: number; // integer paisa held by submitted bills
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'void'
  | 'migrate';

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
