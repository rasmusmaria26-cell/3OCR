import { describe, it, expect } from 'vitest';
import { parseDecimal } from '../src/core/decimal/decimalParser.js';

describe('Shared Decimal Parser', () => {
  it('parses standard numbers without commas or symbols', () => {
    expect(parseDecimal('1000')).toEqual({ value: '1000', currency: null });
    expect(parseDecimal('42.5')).toEqual({ value: '42.5', currency: null });
    expect(parseDecimal('0.0025')).toEqual({ value: '0.0025', currency: null });
  });

  it('parses en-IN Indian number formatting', () => {
    expect(parseDecimal('₹5,00,000')).toEqual({ value: '500000', currency: 'INR' });
    expect(parseDecimal('₹12,500.50')).toEqual({ value: '12500.50', currency: 'INR' });
    expect(parseDecimal('1,10,000')).toEqual({ value: '110000', currency: null });
    expect(parseDecimal('INR 5,00,000')).toEqual({ value: '500000', currency: 'INR' });
  });

  it('parses standard thousands formatting', () => {
    expect(parseDecimal('1,000')).toEqual({ value: '1000', currency: null });
    expect(parseDecimal('$1,000,000.75')).toEqual({ value: '1000000.75', currency: 'USD' });
    expect(parseDecimal('€ 25,000')).toEqual({ value: '25000', currency: 'EUR' });
  });

  it('handles negative sign explicitly for rounding adjustments', () => {
    expect(parseDecimal('-10.50')).toEqual({ value: '-10.50', currency: null });
    expect(parseDecimal('-₹500')).toEqual({ value: '-500', currency: 'INR' });
    expect(parseDecimal('₹ -500')).toEqual({ value: '-500', currency: 'INR' });
    expect(parseDecimal('-$50.25')).toEqual({ value: '-50.25', currency: 'USD' });
  });

  it('differentiates currencies ($500 never equals ₹500)', () => {
    const usd = parseDecimal('$500');
    const inr = parseDecimal('₹500');
    expect(usd).toEqual({ value: '500', currency: 'USD' });
    expect(inr).toEqual({ value: '500', currency: 'INR' });
    expect(usd?.currency).not.toEqual(inr?.currency);
  });

  it('trims whitespace only at ends and right after currency symbol', () => {
    expect(parseDecimal('  ₹  500.00  ')).toEqual({ value: '500.00', currency: 'INR' });
    expect(parseDecimal('  $  1200  ')).toEqual({ value: '1200', currency: 'USD' });
  });

  it('rejects embedded whitespace like "10 20"', () => {
    expect(parseDecimal('10 20')).toBeNull();
    expect(parseDecimal('₹ 10 20')).toBeNull();
    expect(parseDecimal('10  00')).toBeNull();
  });

  it('rejects alphanumeric or letter O strings like abc100 and 1O00', () => {
    expect(parseDecimal('abc100')).toBeNull();
    expect(parseDecimal('1O00')).toBeNull(); // with capital O
    expect(parseDecimal('100a')).toBeNull();
    expect(parseDecimal('foo')).toBeNull();
  });

  it('enforces maximum 4 decimal places', () => {
    expect(parseDecimal('10.1234')).toEqual({ value: '10.1234', currency: null });
    expect(parseDecimal('10.12345')).toBeNull(); // 5 decimal places is invalid
  });

  it('rejects empty or whitespace-only strings', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });
});

