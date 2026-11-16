import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLogInBatch, type AuditActor } from './audit';
import type { VatVariant } from '../types';

interface SeedRate {
  economicCode: string;
  description: string;
  descriptionBn: string;
  incomeTax: number;
  vat: VatVariant[];
}

export const SAMPLE_VAT_TAX_RATES_2025_26: SeedRate[] = [
  {
    economicCode: '3211102',
    description: 'Cleaning supplies',
    descriptionBn: 'পরিষ্কার পরিচ্ছন্নতা সামগ্রী',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 10 }],
  },
  {
    economicCode: '3211104',
    description: 'Ancillary staff / institution',
    descriptionBn: 'আনুষঙ্গিক কর্মচারী/প্রতিষ্ঠান',
    incomeTax: 10,
    vat: [{ key: 'default', label: 'Standard', rate: 15 }],
  },
  {
    economicCode: '3211106',
    description: 'Entertainment',
    descriptionBn: 'আপ্যায়ন ব্যয়',
    incomeTax: 5,
    vat: [
      { key: 'ac', label: 'AC', rate: 15 },
      { key: 'nonAc', label: 'Non-AC', rate: 10 },
    ],
  },
  {
    economicCode: '3211111',
    description: 'Training / seminar / conference',
    descriptionBn: 'প্রশিক্ষণ/সেমিনার/কনফারেন্স ব্যয়',
    incomeTax: 10,
    vat: [{ key: 'default', label: 'Standard', rate: 0 }],
  },
  {
    economicCode: '3211113',
    description: 'Electricity',
    descriptionBn: 'বিদ্যুৎ',
    incomeTax: 0,
    vat: [{ key: 'default', label: 'Standard', rate: 0 }],
  },
  {
    economicCode: '3211110',
    description: 'Legal expenses',
    descriptionBn: 'আইন সংক্রান্ত ব্যয়',
    incomeTax: 10,
    vat: [{ key: 'default', label: 'Standard', rate: 15 }],
  },
  {
    economicCode: '3211116',
    description: 'Courier',
    descriptionBn: 'কুরিয়ার',
    incomeTax: 10,
    vat: [{ key: 'default', label: 'Standard', rate: 15 }],
  },
  {
    economicCode: '3211117',
    description: 'Internet',
    descriptionBn: 'ইন্টারনেট',
    incomeTax: 0,
    vat: [{ key: 'default', label: 'Standard', rate: 5 }],
  },
  {
    economicCode: '3211125',
    description: 'Publicity and advertising',
    descriptionBn: 'প্রচার ও বিজ্ঞাপন',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 15 }],
  },
  {
    economicCode: '3211129',
    description: 'Office building rent',
    descriptionBn: 'অফিস ভবন ভাড়া',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 15 }],
  },
  {
    economicCode: '3243101',
    description: 'Petrol, oil and lubricants',
    descriptionBn: 'পেট্রোল অয়েল ও লুব্রিকেন্ট',
    incomeTax: 0,
    vat: [{ key: 'default', label: 'Standard', rate: 2 }],
  },
  {
    economicCode: '3255102',
    description: 'Printing and binding',
    descriptionBn: 'মুদ্রণ ও বাঁধাই',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 10 }],
  },
  {
    economicCode: 'GENERAL-CONSTRUCTION',
    description: 'Construction materials or works',
    descriptionBn: 'নির্মাণ সামগ্রী বা পূর্ত কাজ',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 10 }],
  },
];

export async function loadSampleData(actor: AuditActor): Promise<void> {
  const fy = '2025-26';
  const batch = writeBatch(db);

  // 1. Ensure settings/office has 2025-26
  const officeRef = doc(db, 'settings', 'office');
  batch.set(
    officeRef,
    {
      activeFiscalYear: fy,
      fiscalYears: ['2025-26', '2026-27'],
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    },
    { merge: true }
  );

  // 2. Insert all 13 vatTaxRates for FY 2025-26
  for (const r of SAMPLE_VAT_TAX_RATES_2025_26) {
    const id = `${fy}_${r.economicCode}`;
    batch.set(doc(db, 'vatTaxRates', id), {
      fiscalYear: fy,
      economicCode: r.economicCode,
      description: r.description,
      descriptionBn: r.descriptionBn,
      incomeTax: r.incomeTax,
      vat: r.vat,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  // 3. Two sample budgets with consistent fyCodeTotals
  const b1Ref = doc(db, 'budgets', 'sample_budget_3211106');
  const b1Allocated = 30000000; // ৳ 3,00,000
  const b1Spent = 18000000; // ৳ 1,80,000
  batch.set(b1Ref, {
    fiscalYear: fy,
    memoNo: 'Memo 01/26',
    memoDate: '2025-07-05',
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    allocated: b1Allocated,
    entryType: 'original',
    revisionOf: null,
    deductionRates: {
      basis: 'gross',
      incomeTax: 5,
      vat: [
        { key: 'ac', label: 'AC', rate: 15 },
        { key: 'nonAc', label: 'Non-AC', rate: 10 },
      ],
      serviceCharge: 0,
    },
    spent: b1Spent,
    remaining: b1Allocated - b1Spent,
    status: 'active',
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  const b2Ref = doc(db, 'budgets', 'sample_budget_3255102');
  const b2Allocated = 20000000; // ৳ 2,00,000
  const b2Spent = 17000000; // ৳ 1,70,000
  batch.set(b2Ref, {
    fiscalYear: fy,
    memoNo: 'Memo 02/26',
    memoDate: '2025-07-18',
    economicCode: '3255102',
    headName: 'Printing and binding',
    headNameBn: 'মুদ্রণ ও বাঁধাই',
    allocated: b2Allocated,
    entryType: 'original',
    revisionOf: null,
    deductionRates: {
      basis: 'gross',
      incomeTax: 5,
      vat: [{ key: 'default', label: 'Standard', rate: 10 }],
      serviceCharge: 0,
    },
    spent: b2Spent,
    remaining: b2Allocated - b2Spent,
    status: 'active',
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // fyCodeTotals matching sample budgets
  batch.set(doc(db, 'fyCodeTotals', `${fy}_3211106`), {
    fiscalYear: fy,
    economicCode: '3211106',
    allocated: b1Allocated,
    spent: b1Spent,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  batch.set(doc(db, 'fyCodeTotals', `${fy}_3255102`), {
    fiscalYear: fy,
    economicCode: '3255102',
    allocated: b2Allocated,
    spent: b2Spent,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // 4. Sample spendings (matching the spent amounts above + 1 draft + 1 submitted)
  const sp1Ref = doc(db, 'spendings', 'sample_sp_1');
  batch.set(sp1Ref, {
    budgetId: b1Ref.id,
    fiscalYear: fy,
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    date: '2025-11-12',
    billNo: 'B-101',
    chequeNo: 'C-5521',
    payee: 'Payee 1',
    gross: 18000000, // ৳ 1,80,000
    vatVariant: 'nonAc',
    deductions: {
      vat: 1800000,
      it: 900000,
      serviceCharge: 0,
      others: [],
    },
    netPayable: 15300000,
    deductionsApplied: { vatRate: 10, itRate: 5, serviceChargeRate: 0 },
    status: 'approved',
    submittedAt: serverTimestamp(),
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  const sp2Ref = doc(db, 'spendings', 'sample_sp_2');
  batch.set(sp2Ref, {
    budgetId: b2Ref.id,
    fiscalYear: fy,
    economicCode: '3255102',
    headName: 'Printing and binding',
    headNameBn: 'মুদ্রণ ও বাঁধাই',
    date: '2025-10-08',
    billNo: 'B-098',
    chequeNo: 'C-5510',
    payee: 'Dhaka Press',
    gross: 17000000, // ৳ 1,70,000
    vatVariant: 'default',
    deductions: {
      vat: 1700000,
      it: 850000,
      serviceCharge: 0,
      others: [],
    },
    netPayable: 14450000,
    deductionsApplied: { vatRate: 10, itRate: 5, serviceChargeRate: 0 },
    status: 'approved',
    submittedAt: serverTimestamp(),
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  const sp3Ref = doc(db, 'spendings', 'sample_sp_3');
  batch.set(sp3Ref, {
    budgetId: b1Ref.id,
    fiscalYear: fy,
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    date: '2026-01-10',
    billNo: 'B-102',
    chequeNo: null,
    payee: 'Payee 2',
    gross: 1000000, // ৳ 10,000
    vatVariant: 'nonAc',
    deductions: {
      vat: 100000,
      it: 50000,
      serviceCharge: 20000,
      others: [{ label: 'Security deposit', amount: 30000 }],
    },
    netPayable: 800000,
    deductionsApplied: { vatRate: 10, itRate: 5, serviceChargeRate: 2 },
    status: 'submitted',
    submittedAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  const sp4Ref = doc(db, 'spendings', 'sample_sp_4');
  batch.set(sp4Ref, {
    budgetId: b2Ref.id,
    fiscalYear: fy,
    economicCode: '3255102',
    headName: 'Printing and binding',
    headNameBn: 'মুদ্রণ ও বাঁধাই',
    date: '2026-01-14',
    billNo: 'B-103',
    chequeNo: null,
    payee: 'Metro Stationery',
    gross: 600000, // ৳ 6,000
    vatVariant: 'default',
    deductions: {
      vat: 60000,
      it: 30000,
      serviceCharge: 0,
      others: [],
    },
    netPayable: 510000,
    deductionsApplied: { vatRate: 10, itRate: 5, serviceChargeRate: 0 },
    status: 'draft',
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // 5. One sample code-level spending limit (3211106, 80%)
  const limitRef = doc(db, 'spendingLimits', 'sample_limit_3211106');
  batch.set(limitRef, {
    type: 'code',
    budgetId: null,
    fiscalYear: fy,
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    rate: 80,
    unit: 'percent',
    effectiveDate: '2025-12-01',
    refNo: 'Ref-001',
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  writeAuditLogInBatch(batch, {
    collection: 'settings',
    docId: 'seed_2025_26',
    action: 'create',
    before: null,
    after: { seededFiscalYear: fy, ratesCount: SAMPLE_VAT_TAX_RATES_2025_26.length },
    actor,
  });

  await batch.commit();
}
