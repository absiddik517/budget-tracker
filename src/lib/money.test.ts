import assert from 'node:assert/strict';
import { calcGrossFromNetExpense, computeGrossedUpBill, toPaisa } from './money.ts';

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

console.log('All money gross-up tests passed!');
