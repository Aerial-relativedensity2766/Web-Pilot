import { describe, expect, it } from 'vitest';
import { normalizeWhitespace, slugify, uniqueBy } from '@webpilot/shared';

describe('normalizeWhitespace', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeWhitespace('')).toBe('');
  });

  it('collapses repeated spaces', () => {
    expect(normalizeWhitespace('a    b')).toBe('a b');
  });

  it('collapses tabs and newlines into single spaces', () => {
    expect(normalizeWhitespace('a\t\tb\n\nc')).toBe('a b c');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello world  ')).toBe('hello world');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Green Tree Photography')).toBe('green-tree-photography');
  });

  it('strips punctuation', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('strips accented Latin marks', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume');
  });

  it('caps length at 60 characters', () => {
    const long = 'a'.repeat(80);
    expect(slugify(long)).toBe('a'.repeat(60));
  });

  it('uses default fallback when input yields no slug', () => {
    expect(slugify('!!!')).toBe('item');
  });

  it('uses custom fallback when input yields no slug', () => {
    expect(slugify('@@@', 'untitled')).toBe('untitled');
  });
});

describe('uniqueBy', () => {
  it('returns empty array for empty input', () => {
    expect(uniqueBy([], (item) => item)).toEqual([]);
  });

  it('drops later items with duplicate keys', () => {
    const input = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 },
    ];
    expect(uniqueBy(input, (item) => item.id)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });

  it('keeps the first item for each key', () => {
    expect(uniqueBy(['x', 'y', 'x'], (item) => item)).toEqual(['x', 'y']);
  });

  it('preserves encounter order', () => {
    expect(uniqueBy(['c', 'a', 'b', 'a'], (item) => item)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [{ id: '1' }, { id: '1' }, { id: '2' }];
    const snapshot = input.map((item) => ({ ...item }));
    uniqueBy(input, (item) => item.id);
    expect(input).toEqual(snapshot);
  });
});
