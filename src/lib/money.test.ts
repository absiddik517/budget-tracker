import assert from 'node:assert/strict';
import {
  aggregateDeductions,
  calcGrossFromNetExpense,
  calcProduct,
  computeGrossedUpBill,
  normalizeProductRateKey,
  sumProducts,
  toPaisa,
} from './money.ts';

// Test 1: User example: Expense = 500, VAT = 5%, IT = 10% -> (500 * 100) / (100 - 15) = 588.24
{
  const expensePaisa = toPaisa('500');
  const gross = calcGrossFromNetExpense(expensePaisa, 15);
  assert.equal(gross, 58824); // 588.24 টাকা

  const bill = computeGrossedUpBill({
    expenseTotalPaisa: expensePaisa,
    vatRate: 5,
    itRate: 10,
  });
  assert.equal(bill.expenseTotal, 50000);
  assert.equal(bill.grossAmount, 58824);
  assert.equal(bill.vatAmount, 2941); // 29.41 (5% of 588.24)
  assert.equal(bill.itAmount, 5882); // 58.82 (10% of 588.24)
  assert.equal(bill.totalDeduction, 8823);
  assert.equal(bill.netPayable, bill.grossAmount - bill.totalDeduction);
  assert.equal(bill.totalPercentRate, 15);
}

// Test 2: Zero deduction rate leaves gross equal to expense
{
  const bill = computeGrossedUpBill({
    expenseTotalPaisa: 50000,
    vatRate: 0,
    itRate: 0,
  });
  assert.equal(bill.grossAmount, 50000);
  assert.equal(bill.totalDeduction, 0);
  assert.equal(bill.netPayable, 50000);
}

// Test 3: Custom deduction rows (VAT 5% + IT 10% + Security 10% = 25%)
{
  const bill = computeGrossedUpBill({
    expenseTotalPaisa: 50000,
    vatRate: 5,
    itRate: 10,
    customDeductions: [
      { id: 'it', code: '1111101', name: 'IT', rate: 10, amount: 0, kind: 'it' },
      { id: 'vat', code: '1141101', name: 'VAT', rate: 5, amount: 0, kind: 'vat' },
      { id: 'sec', code: '8113301', name: 'Security', rate: 10, amount: 0, kind: 'security' },
    ],
  });
  // (50000 * 100) / (100 - 25) = 66666.666... -> 66667 (666.67)
  assert.equal(bill.grossAmount, 66667);
  assert.equal(bill.netPayable, bill.grossAmount - bill.totalDeduction);
}

// Test 4: Fixed deduction (rate = null) alongside percentage deductions
{
  const bill = computeGrossedUpBill({
    expenseTotalPaisa: 50000,
    vatRate: 5,
    itRate: 10,
    customDeductions: [
      { id: 'it', code: '1111101', name: 'IT', rate: 10, amount: 0, kind: 'it' },
      { id: 'vat', code: '1141101', name: 'VAT', rate: 5, amount: 0, kind: 'vat' },
      { id: 'fixed', code: '8113301', name: 'Fixed', rate: null, amount: 10000, kind: 'security' },
    ],
  });
  // ((50000 + 10000) * 100) / (100 - 15) = 70588.235... -> 70588
  assert.equal(bill.grossAmount, 70588);
  assert.equal(bill.netPayable, bill.grossAmount - bill.totalDeduction);
}

// Test 5: Guard when total percentage rate >= 100
{
  assert.throws(() => {
    calcGrossFromNetExpense(50000, 100);
  }, /১০০%/);
}

// Test 6: Per-product x-driven calculations (deducting VAT+IT from voucher y) + sumProducts + aggregateDeductions
{
  const p1 = calcProduct({
    id: 'p1',
    name: 'ব্যানার',
    amount: 500000, // x = 5000.00, z = 20% -> y = 5000 * 100 / 80 = 6250.00
    by: 'x',
    vatRate: 15,
    itRate: 5,
  });
  assert.equal(p1.actualAmount, 500000);
  assert.equal(p1.voucherAmount, 625000); // 6250.00
  assert.equal(p1.vatAmount, 93750); // 15% of 6250 = 937.50
  assert.equal(p1.itAmount, 31250); // 5% of 6250 = 312.50
  assert.equal(p1.deductionAmount, 125000);
  assert.equal(p1.actualAmount + p1.vatAmount + p1.itAmount, p1.voucherAmount);

  const p2 = calcProduct({
    id: 'p2',
    name: 'কেক',
    amount: 340000, // x = 3400.00, z = 15% -> y = 3400 * 100 / 85 = 4000.00
    by: 'x',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(p2.actualAmount, 340000);
  assert.equal(p2.voucherAmount, 400000); // 4000.00
  assert.equal(p2.vatAmount, 40000); // 10% of 4000 = 400.00
  assert.equal(p2.itAmount, 20000); // 5% of 4000 = 200.00
  assert.equal(p2.deductionAmount, 60000);
  assert.equal(p2.actualAmount + p2.vatAmount + p2.itAmount, p2.voucherAmount);

  const p3 = calcProduct({
    id: 'p3',
    name: 'মিষ্টি',
    amount: 170000, // x = 1700.00, z = 15% -> y = 1700 * 100 / 85 = 2000.00
    by: 'x',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(p3.actualAmount, 170000);
  assert.equal(p3.voucherAmount, 200000); // 2000.00
  assert.equal(p3.vatAmount, 20000); // 10% of 2000 = 200.00
  assert.equal(p3.itAmount, 10000); // 5% of 2000 = 100.00
  assert.equal(p3.deductionAmount, 30000);
  assert.equal(p3.actualAmount + p3.vatAmount + p3.itAmount, p3.voucherAmount);

  // Rounding edge case matching Test 1 (500.00 net, 5% VAT, 10% IT -> 588.24 voucher)
  const pRound = calcProduct({
    id: 'pr',
    name: 'খাতা',
    amount: 50000,
    by: 'x',
    vatRate: 5,
    itRate: 10,
  });
  assert.equal(pRound.actualAmount, 50000);
  assert.equal(pRound.voucherAmount, 58824);
  assert.equal(pRound.actualAmount + pRound.vatAmount + pRound.itAmount, pRound.voucherAmount);

  const totals = sumProducts([p1, p2, p3]);
  assert.equal(totals.baseTotal, 1010000); // 10100.00
  assert.equal(totals.vatTotal, 153750); // 1537.50
  assert.equal(totals.itTotal, 61250); // 612.50
  assert.equal(totals.deductionTotal, 215000); // 2150.00
  assert.equal(totals.voucherTotal, 1225000); // 12250.00

  const ded = aggregateDeductions([p1, p2, p3]);
  assert.equal(ded.length, 3);
  assert.deepEqual(
    ded.map((d) => ({ kind: d.kind, rate: d.rate, amount: d.amount })),
    [
      { kind: 'it', rate: 5, amount: 61250 },
      { kind: 'vat', rate: 15, amount: 93750 },
      { kind: 'vat', rate: 10, amount: 60000 },
    ]
  );
}

// Test 7: Per-product y-driven calculation (VAT & IT deducted directly from voucher y)
{
  const py = calcProduct({
    id: 'py',
    name: 'কলম',
    amount: 100000, // y = 1000.00
    by: 'y',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(py.voucherAmount, 100000);
  assert.equal(py.vatAmount, 10000); // 10% of 1000 = 100.00
  assert.equal(py.itAmount, 5000); // 5% of 1000 = 50.00
  assert.equal(py.deductionAmount, 15000); // 150.00
  assert.equal(py.actualAmount, 85000); // 850.00
  assert.equal(py.actualAmount + py.vatAmount + py.itAmount, py.voucherAmount);

  const pyFrac = calcProduct({
    id: 'pyFrac',
    name: 'কাগজ',
    amount: 100000, // y = 1000.00
    by: 'y',
    vatRate: 7.5,
    itRate: 5,
  });
  assert.equal(pyFrac.voucherAmount, 100000);
  assert.equal(pyFrac.vatAmount, 7500);
  assert.equal(pyFrac.itAmount, 5000);
  assert.equal(pyFrac.deductionAmount, 12500);
  assert.equal(pyFrac.actualAmount, 87500);
  assert.equal(pyFrac.actualAmount + pyFrac.vatAmount + pyFrac.itAmount, pyFrac.voucherAmount);
}

// Test 8: Product calculation validation guards and key normalization
{
  assert.throws(() => calcProduct({ amount: 0, by: 'x', vatRate: 10, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: -100, by: 'y', vatRate: 10, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: -1, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: 101, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: 10, itRate: 105 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: 60, itRate: 40 }), /১০০%/);
  assert.throws(() => calcProduct({ amount: 10000, by: 'y', vatRate: 50, itRate: 50 }), /১০০%/);

  assert.equal(normalizeProductRateKey('  Banner  /   Poster '), 'banner _ poster');
  assert.equal(normalizeProductRateKey('  ব্যানার  '), 'ব্যানার');
}

console.log('All money tests (gross-up + per-product) passed!');

