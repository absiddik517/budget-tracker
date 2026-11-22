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

// Test 6: Per-product x-driven calculations + sumProducts + aggregateDeductions
{
  const p1 = calcProduct({
    id: 'p1',
    name: 'ব্যানার',
    amount: 500000, // 5000.00
    by: 'x',
    vatRate: 15,
    itRate: 5,
  });
  assert.equal(p1.actualAmount, 500000);
  assert.equal(p1.vatAmount, 75000); // 750.00
  assert.equal(p1.itAmount, 25000); // 250.00
  assert.equal(p1.deductionAmount, 100000);
  assert.equal(p1.voucherAmount, 600000); // 6000.00

  const p2 = calcProduct({
    id: 'p2',
    name: 'কেক',
    amount: 300000, // 3000.00
    by: 'x',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(p2.actualAmount, 300000);
  assert.equal(p2.vatAmount, 30000); // 300.00
  assert.equal(p2.itAmount, 15000); // 150.00
  assert.equal(p2.deductionAmount, 45000);
  assert.equal(p2.voucherAmount, 345000); // 3450.00

  const p3 = calcProduct({
    id: 'p3',
    name: 'মিষ্টি',
    amount: 200000, // 2000.00
    by: 'x',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(p3.actualAmount, 200000);
  assert.equal(p3.vatAmount, 20000); // 200.00
  assert.equal(p3.itAmount, 10000); // 100.00
  assert.equal(p3.deductionAmount, 30000);
  assert.equal(p3.voucherAmount, 230000); // 2300.00

  const totals = sumProducts([p1, p2, p3]);
  assert.equal(totals.baseTotal, 1000000); // 10000.00
  assert.equal(totals.vatTotal, 125000); // 1250.00
  assert.equal(totals.itTotal, 50000); // 500.00
  assert.equal(totals.deductionTotal, 175000); // 1750.00
  assert.equal(totals.voucherTotal, 1175000); // 11750.00

  const ded = aggregateDeductions([p1, p2, p3]);
  assert.equal(ded.length, 3);
  assert.deepEqual(
    ded.map((d) => ({ kind: d.kind, rate: d.rate, amount: d.amount })),
    [
      { kind: 'it', rate: 5, amount: 50000 },
      { kind: 'vat', rate: 15, amount: 75000 },
      { kind: 'vat', rate: 10, amount: 50000 },
    ]
  );
}

// Test 7: Per-product y-driven reverse calculation (exact sum y = x + vat + it)
{
  const py = calcProduct({
    id: 'py',
    name: 'কলম',
    amount: 100000, // 1000.00
    by: 'y',
    vatRate: 10,
    itRate: 5,
  });
  assert.equal(py.voucherAmount, 100000);
  assert.equal(py.actualAmount, 86957); // 869.57
  assert.equal(py.deductionAmount, 13043); // 130.43
  assert.equal(py.vatAmount, 8695); // 86.95
  assert.equal(py.itAmount, 4348); // 43.48
  assert.equal(py.actualAmount + py.vatAmount + py.itAmount, py.voucherAmount);
}

// Test 8: Product calculation validation guards and key normalization
{
  assert.throws(() => calcProduct({ amount: 0, by: 'x', vatRate: 10, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: -100, by: 'y', vatRate: 10, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: -1, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: 101, itRate: 5 }));
  assert.throws(() => calcProduct({ amount: 10000, by: 'x', vatRate: 10, itRate: 105 }));

  assert.equal(normalizeProductRateKey('  Banner  /   Poster '), 'banner _ poster');
  assert.equal(normalizeProductRateKey('  ব্যানার  '), 'ব্যানার');
}

console.log('All money tests (gross-up + per-product) passed!');

