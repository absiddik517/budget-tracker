import { Timestamp } from 'firebase/firestore';

export type OfficeRole = 'ddo' | 'employee';
export type Role = 'superAdmin' | OfficeRole;
export type GlobalRole = 'superAdmin' | null;
export type PostingKind = 'regular' | 'additionalCharge';
export type WorkHistoryStatus = 'active' | 'ended';
export type WorkHistoryEndReason =
  | 'transferred'
  | 'charge withdrawn'
  | 'retired'
  | 'relieved'
  | 'other';
export type OfficeStatus = 'active' | 'inactive';
export type UserStatus = 'invited' | 'active' | 'disabled';
export type ThemeMode = 'light' | 'dark' | 'system';
export type LanguageCode = 'en' | 'bn';

export interface ActorSnapshot {
  uid: string;
  name: string;
  designation: string;
  officeId: string | null;
  role: Role;
  kind: PostingKind | null;
  workHistoryId: string | null;
}

export type ActorRef = ActorSnapshot | string;

export interface BaseAuditFields {
  createdAt?: Timestamp | null;
  createdBy?: ActorRef;
  updatedAt?: Timestamp | null;
  updatedBy?: ActorRef;
}

export interface OfficeDoc extends BaseAuditFields {
  id: string;
  name: string;
  nameBn: string;
  code: string;
  address: string;
  status: OfficeStatus;
  activeFiscalYear: string;
  fiscalYears: string[];
  language?: LanguageCode;
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
  tr21P1S3Mode?: Tr21P1S3Mode;
  tr21VoucherLabel?: string;
  tr21Margins?: Tr21Margins;
  tr21Clauses?: CertificationClause[];
}

export interface UserDoc extends BaseAuditFields {
  id: string;
  name: string;
  designation: string;
  email: string;
  phone?: string;
  status: UserStatus;
  globalRole: GlobalRole;
  homeOfficeId: string | null;
  access: Record<string, OfficeRole>;
  officeIds?: string[];
  /** Legacy pre-migration single role; removed during migration */
  role?: Role;
  lastActiveAt?: Timestamp | null;
}

export interface WorkHistoryDoc extends BaseAuditFields {
  id: string;
  userId: string;
  userName: string;
  officeId: string;
  officeName?: string;
  role: OfficeRole;
  kind: PostingKind;
  designation: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  status: WorkHistoryStatus;
  orderNo: string;
  orderDate: string;
  endReason: WorkHistoryEndReason | null;
  assignedBy: {
    uid: string;
    name: string;
  };
  remarks: string;
}

export interface InviteDoc extends BaseAuditFields {
  id: string; // emailLowercase
  email: string;
  name?: string;
  phone?: string;
  officeId: string;
  role: OfficeRole;
  kind: PostingKind;
  designation: string;
  orderNo?: string;
  orderDate?: string;
  invitedBy: ActorRef;
}

export type Tr21P1S3Mode = 'voucher' | 'items';

export interface Tr21Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CertificationClause {
  id: string;
  numberBn: string;
  text: string;
  enabled: boolean;
  page: 1 | 2;
}

export interface OfficeSettings extends BaseAuditFields {
  officeId?: string;
  officeName: string;
  officeNameBn?: string;
  officeCode?: string;
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
  tr21P1S3Mode?: Tr21P1S3Mode;
  tr21VoucherLabel?: string;
  tr21Margins?: Tr21Margins;
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
  officeId: string;
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
  officeId: string;
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
  officeId: string;
  billNo: string; // sequential per office+FY on submit e.g. "2025-26/001"
  voucherNo?: string; // user-entered voucher no. shown in T.R. 21 P1-S2 as "০০১ (২০২৬-২৭)"
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string; // YYYY-MM-DD
  billDate?: string; // optional explicit T.R. 21 bill date (falls back to date)
  tokenNo?: string;
  purposeText?: string;
  tr21P1S3Mode?: Tr21P1S3Mode | null;
  voucherTitle?: string;
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
  submittedBy?: ActorRef | null;
  approvedBy: ActorRef | null;
  approvedAt: Timestamp | null;
  rejectedBy?: ActorRef | null;
  rejectedAt?: Timestamp | null;
  rejectReason: string | null;
  cancelledBy: ActorRef | null;
  cancelledAt: Timestamp | null;
  cancelReason: string | null;
  pendingSlices?: BillBudgetSlice[];
  budgetDeductions?: BillBudgetSlice[];
  migratedFromSpendingId?: string | null;
  createdByName?: string;
  deleted: boolean;
}

export interface FyCounterDoc {
  id: string; // `${officeId}_${fiscalYear}_bill`
  officeId: string;
  fiscalYear: string;
  nextNumber: number;
  updatedAt?: Timestamp | null;
  updatedBy?: ActorRef;
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
  officeId?: string;
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
  submittedBy?: ActorRef | null;
  approvedBy: ActorRef | null;
  approvedAt: Timestamp | null;
  rejectedBy?: ActorRef | null;
  rejectReason: string | null;
  voidedBy: ActorRef | null;
  voidedAt: Timestamp | null;
  voidReason: string | null;
  deleted: boolean;
  createdByName?: string;
}

export type SpendingLimitType = 'code' | 'budget';
export type SpendingLimitStatus = 'active' | 'withdrawn';

export interface SpendingLimitDoc extends BaseAuditFields {
  id: string;
  officeId: string;
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
  id: string; // `${officeId}_${fiscalYear}_${economicCode}`
  officeId: string;
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
  | 'migrate'
  | 'handover'
  | 'transfer'
  | 'chargeGrant'
  | 'chargeWithdraw'
  | 'disable'
  | 'enable'
  | 'correct';

export interface AuditLogDoc {
  id: string;
  officeId: string | null;
  collection: string;
  docId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userId: string;
  userName: string;
  actor?: ActorSnapshot | null;
  timestamp: Timestamp | null;
}
