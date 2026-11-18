import {
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

  // 2. Insert all 13 vatTaxRates for FY 2025-26 and master economicCodes
  for (const r of SAMPLE_VAT_TAX_RATES_2025_26) {
    batch.set(doc(db, 'economicCodes', r.economicCode), {
      code: r.economicCode,
      headName: r.description,
      headNameBn: r.descriptionBn,
      active: true,
      special: r.economicCode === 'GENERAL-CONSTRUCTION',
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

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

  // 3. Two sample budgets with consistent fyCodeTotals (including pendingAmount)
  const b1Ref = doc(db, 'budgets', 'sample_budget_3211106');
  const b1Allocated = 30000000; // ৳ 3,00,000
  const b1Spent = 18000000;     // ৳ 1,80,000 (approved bill #1)
  const b1Pending = 1000000;    // ৳ 10,000 (submitted bill #3)
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
    approvedSpent: b1Spent,
    pendingAmount: b1Pending,
    remaining: b1Allocated - b1Spent - b1Pending,
    status: 'active',
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  const b2Ref = doc(db, 'budgets', 'sample_budget_3255102');
  const b2Allocated = 20000000; // ৳ 2,00,000
  const b2Spent = 17000000;     // ৳ 1,70,000 (approved bill #2)
  const b2Pending = 0;
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
    approvedSpent: b2Spent,
    pendingAmount: b2Pending,
    remaining: b2Allocated - b2Spent - b2Pending,
    status: 'active',
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  batch.set(doc(db, 'fyCodeTotals', `${fy}_3211106`), {
    fiscalYear: fy,
    economicCode: '3211106',
    allocated: b1Allocated,
    spent: b1Spent,
    approvedSpent: b1Spent,
    pendingAmount: b1Pending,
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
    approvedSpent: b2Spent,
    pendingAmount: b2Pending,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // 4. Sample Expense Items (billed + listed ready for bill preparation)
  const items = [
    {
      id: 'sample_ei_1',
      economicCode: '3211106',
      headName: 'Entertainment',
      headNameBn: 'আপ্যায়ন ব্যয়',
      date: '2025-11-10',
      description: 'মাসিক সমন্বয় সভার আপ্যায়ন',
      amount: 10000000, // 1,00,000
      responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      status: 'billed',
      billId: 'sample_bill_1',
    },
    {
      id: 'sample_ei_2',
      economicCode: '3211106',
      headName: 'Entertainment',
      headNameBn: 'আপ্যায়ন ব্যয়',
      date: '2025-11-12',
      description: 'অডিট টিমের মধ্যাহ্নভোজ ও চা-নাস্তা',
      amount: 8000000, // 80,000
      responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      status: 'billed',
      billId: 'sample_bill_1',
    },
    {
      id: 'sample_ei_3',
      economicCode: '3255102',
      headName: 'Printing and binding',
      headNameBn: 'মুদ্রণ ও বাঁধাই',
      date: '2025-10-08',
      description: 'বার্ষিক প্রতিবেদন ও ফরম মুদ্রণ',
      amount: 17000000, // 1,70,000
      responsibleEmployee: { userId: null, name: 'Md. Karim', designation: 'Office Assistant' },
      status: 'billed',
      billId: 'sample_bill_2',
    },
    {
      id: 'sample_ei_4',
      economicCode: '3211106',
      headName: 'Entertainment',
      headNameBn: 'আপ্যায়ন ব্যয়',
      date: '2026-01-10',
      description: 'জরুরি স্টাফ মিটিং রিফ্রেশমেন্ট',
      amount: 1000000, // 10,000
      responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      status: 'billed',
      billId: 'sample_bill_3',
    },
    {
      id: 'sample_ei_5',
      economicCode: '3255102',
      headName: 'Printing and binding',
      headNameBn: 'মুদ্রণ ও বাঁধাই',
      date: '2026-01-14',
      description: 'রেজিস্টার খাতা বাঁধাই ও স্টেশনারি ছাপা',
      amount: 600000, // 6,000
      responsibleEmployee: { userId: null, name: 'Md. Karim', designation: 'Office Assistant' },
      status: 'billed',
      billId: 'sample_bill_4',
    },
    {
      id: 'sample_ei_6',
      economicCode: '3211106',
      headName: 'Entertainment',
      headNameBn: 'আপ্যায়ন ব্যয়',
      date: '2026-01-20',
      description: 'জেলা পর্যায়ের কর্মশালা নাস্তা খরচ',
      amount: 1200000, // 12,000
      responsibleEmployee: { userId: null, name: 'Fatema Begum', designation: 'Accountant' },
      status: 'listed',
      billId: null,
    },
    {
      id: 'sample_ei_7',
      economicCode: '3255102',
      headName: 'Printing and binding',
      headNameBn: 'মুদ্রণ ও বাঁধাই',
      date: '2026-01-22',
      description: 'অফিস প্যাড ও খাম মুদ্রণ',
      amount: 450000, // 4,500
      responsibleEmployee: { userId: null, name: 'Md. Karim', designation: 'Office Assistant' },
      status: 'listed',
      billId: null,
    },
  ];

  for (const item of items) {
    batch.set(doc(db, 'expenseItems', item.id), {
      fiscalYear: fy,
      economicCode: item.economicCode,
      headName: item.headName,
      headNameBn: item.headNameBn,
      date: item.date,
      description: item.description,
      amount: item.amount,
      responsibleEmployee: item.responsibleEmployee,
      status: item.status,
      billId: item.billId,
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      createdByName: actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  // 5. Sample Bills (2 approved, 1 submitted, 1 draft) + FY sequential counter
  batch.set(doc(db, 'bills', 'sample_bill_1'), {
    billNo: '2025-26/001',
    fiscalYear: fy,
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    date: '2025-11-12',
    itemIds: ['sample_ei_1', 'sample_ei_2'],
    items: [
      {
        id: 'sample_ei_1',
        date: '2025-11-10',
        description: 'মাসিক সমন্বয় সভার আপ্যায়ন',
        amount: 10000000,
        responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      },
      {
        id: 'sample_ei_2',
        date: '2025-11-12',
        description: 'অডিট টিমের মধ্যাহ্নভোজ ও চা-নাস্তা',
        amount: 8000000,
        responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      },
    ],
    grossAmount: 18000000,
    vatRate: 10,
    itRate: 5,
    vatVariant: 'nonAc',
    vatVariantLabel: 'Non-AC',
    vatAmount: 1800000,
    itAmount: 900000,
    totalDeduction: 2700000,
    netPayable: 15300000,
    status: 'approved',
    submittedAt: serverTimestamp(),
    submittedBy: actor.uid,
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
    rejectReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    pendingSlices: [],
    budgetDeductions: [{ budgetId: b1Ref.id, amount: 18000000 }],
    migratedFromSpendingId: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  batch.set(doc(db, 'bills', 'sample_bill_2'), {
    billNo: '2025-26/002',
    fiscalYear: fy,
    economicCode: '3255102',
    headName: 'Printing and binding',
    headNameBn: 'মুদ্রণ ও বাঁধাই',
    date: '2025-10-08',
    itemIds: ['sample_ei_3'],
    items: [
      {
        id: 'sample_ei_3',
        date: '2025-10-08',
        description: 'বার্ষিক প্রতিবেদন ও ফরম মুদ্রণ',
        amount: 17000000,
        responsibleEmployee: { userId: null, name: 'Md. Karim', designation: 'Office Assistant' },
      },
    ],
    grossAmount: 17000000,
    vatRate: 10,
    itRate: 5,
    vatVariant: 'default',
    vatVariantLabel: 'Standard',
    vatAmount: 1700000,
    itAmount: 850000,
    totalDeduction: 2550000,
    netPayable: 14450000,
    status: 'approved',
    submittedAt: serverTimestamp(),
    submittedBy: actor.uid,
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
    rejectReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    pendingSlices: [],
    budgetDeductions: [{ budgetId: b2Ref.id, amount: 17000000 }],
    migratedFromSpendingId: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  batch.set(doc(db, 'bills', 'sample_bill_3'), {
    billNo: '2025-26/003',
    fiscalYear: fy,
    economicCode: '3211106',
    headName: 'Entertainment',
    headNameBn: 'আপ্যায়ন ব্যয়',
    date: '2026-01-10',
    itemIds: ['sample_ei_4'],
    items: [
      {
        id: 'sample_ei_4',
        date: '2026-01-10',
        description: 'জরুরি স্টাফ মিটিং রিফ্রেশমেন্ট',
        amount: 1000000,
        responsibleEmployee: { userId: actor.uid, name: actor.name, designation: 'Admin Officer' },
      },
    ],
    grossAmount: 1000000,
    vatRate: 10,
    itRate: 5,
    vatVariant: 'nonAc',
    vatVariantLabel: 'Non-AC',
    vatAmount: 100000,
    itAmount: 50000,
    totalDeduction: 150000,
    netPayable: 850000,
    status: 'submitted',
    submittedAt: serverTimestamp(),
    submittedBy: actor.uid,
    approvedBy: null,
    approvedAt: null,
    rejectReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    pendingSlices: [{ budgetId: b1Ref.id, amount: 1000000 }],
    budgetDeductions: [],
    migratedFromSpendingId: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  batch.set(doc(db, 'bills', 'sample_bill_4'), {
    billNo: '',
    fiscalYear: fy,
    economicCode: '3255102',
    headName: 'Printing and binding',
    headNameBn: 'মুদ্রণ ও বাঁধাই',
    date: '2026-01-14',
    itemIds: ['sample_ei_5'],
    items: [
      {
        id: 'sample_ei_5',
        date: '2026-01-14',
        description: 'রেজিস্টার খাতা বাঁধাই ও স্টেশনারি ছাপা',
        amount: 600000,
        responsibleEmployee: { userId: null, name: 'Md. Karim', designation: 'Office Assistant' },
      },
    ],
    grossAmount: 600000,
    vatRate: 10,
    itRate: 5,
    vatVariant: 'default',
    vatVariantLabel: 'Standard',
    vatAmount: 60000,
    itAmount: 30000,
    totalDeduction: 90000,
    netPayable: 510000,
    status: 'draft',
    submittedAt: null,
    submittedBy: null,
    approvedBy: null,
    approvedAt: null,
    rejectReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    pendingSlices: [],
    budgetDeductions: [],
    migratedFromSpendingId: null,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  batch.set(doc(db, 'counters', `${fy}_bill`), {
    fiscalYear: fy,
    nextNumber: 4,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // 6. One sample code-level spending limit (3211106, 80%)
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
