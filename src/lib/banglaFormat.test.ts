import assert from 'node:assert/strict';
import {
  formatBanglaGroupedInt,
  formatBanglaLongDate,
  formatBanglaShortDate,
  formatFyShortBn,
  integerToBanglaWords,
  paisaToBanglaWords,
  splitPaisaForTr21,
  toBanglaDigits,
} from './banglaFormat';

assert.equal(toBanglaDigits('120001417'), '১২০০০১৪১৭');
assert.equal(toBanglaDigits('2025-26/001'), '২০২৫-২৬/০০১');

assert.equal(formatBanglaGroupedInt(58900), '৫৮,৯০০');
assert.equal(formatBanglaGroupedInt(54700), '৫৪,৭০০');
assert.equal(formatBanglaGroupedInt(123456), '১,২৩,৪৫৬');
assert.equal(formatBanglaGroupedInt(1000000), '১০,০০,০০০');
assert.equal(formatBanglaGroupedInt(0), '০');

assert.equal(integerToBanglaWords(0), 'শূন্য');
assert.equal(integerToBanglaWords(58900), 'আটান্ন হাজার নয়শত');
assert.equal(integerToBanglaWords(43760), 'তেতাল্লিশ হাজার সাতশত ষাট');
assert.equal(integerToBanglaWords(123456), 'এক লক্ষ তেইশ হাজার চারশত ছাপ্পান্ন');
assert.equal(integerToBanglaWords(10000000), 'এক কোটি');

assert.equal(paisaToBanglaWords(5890000), 'আটান্ন হাজার নয়শত টাকা মাত্র');
assert.equal(paisaToBanglaWords(4376000), 'তেতাল্লিশ হাজার সাতশত ষাট টাকা মাত্র');
assert.equal(paisaToBanglaWords(125050), 'এক হাজার দুইশত পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র');
assert.equal(paisaToBanglaWords(0), 'শূন্য টাকা মাত্র');

assert.deepEqual(splitPaisaForTr21(5470000), { takaStr: '৫৪,৭০০/-', paisaStr: '' });
assert.deepEqual(splitPaisaForTr21(5470050), { takaStr: '৫৪,৭০০/-', paisaStr: '৫০' });
assert.deepEqual(splitPaisaForTr21(0, { blankWhenZero: true }), { takaStr: '', paisaStr: '' });

assert.equal(formatBanglaLongDate('2025-10-23'), '২৩ অক্টোবর ২০২৫');
assert.equal(formatBanglaShortDate('2025-12-15'), '১৫/১২/২০২৫ খ্রি.');
assert.equal(formatFyShortBn('2025-26'), '২৫-২৬');

console.log('All banglaFormat tests passed!');
