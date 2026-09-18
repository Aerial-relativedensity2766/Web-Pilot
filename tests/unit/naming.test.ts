import { describe, expect, it } from 'vitest';
import {
  buildFilename,
  resolveExtension,
  sanitizeDownloadFilename,
  splitExtension,
  uniqueFilename,
} from '@webpilot/download-core';

describe('sanitizeDownloadFilename', () => {
  it('keeps an ordinary basename', () => {
    expect(sanitizeDownloadFilename('photo.jpg')).toBe('photo.jpg');
  });

  it('uses only the last path segment', () => {
    expect(sanitizeDownloadFilename('album/summer/tree.jpg')).toBe('tree.jpg');
    expect(sanitizeDownloadFilename('album\\summer\\tree.jpg')).toBe('tree.jpg');
  });

  it('strips query strings before sanitizing', () => {
    expect(sanitizeDownloadFilename('tree.jpg?token=abc')).toBe('tree.jpg');
  });

  it('removes unsafe filename characters', () => {
    expect(sanitizeDownloadFilename('evil<>:name.jpg')).toBe('evilname.jpg');
  });

  it('falls back when the name is empty after cleaning', () => {
    expect(sanitizeDownloadFilename('???')).toBe('download');
    expect(sanitizeDownloadFilename('???', 'asset')).toBe('asset');
  });
});

describe('splitExtension', () => {
  it('splits a normal filename', () => {
    expect(splitExtension('tree.jpg')).toEqual({ base: 'tree', ext: 'jpg' });
  });

  it('lowercases the extension', () => {
    expect(splitExtension('tree.PNG')).toEqual({ base: 'tree', ext: 'png' });
  });

  it('returns empty extension when missing or leading-only', () => {
    expect(splitExtension('README')).toEqual({ base: 'README', ext: '' });
    expect(splitExtension('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
  });
});

describe('buildFilename', () => {
  it('builds a numbered filename with extension', () => {
    expect(buildFilename('tree', 3, 'jpg')).toBe('tree-003.jpg');
  });

  it('slugifies the base and normalizes the extension', () => {
    expect(buildFilename('Green Tree!', 1, '.PNG')).toBe('green-tree-001.png');
  });

  it('uses download fallback and clamps index to at least 1', () => {
    expect(buildFilename('', 0, '')).toBe('download-001');
  });
});

describe('uniqueFilename', () => {
  it('returns the original name when free', () => {
    expect(uniqueFilename('tree-001.jpg', new Set())).toBe('tree-001.jpg');
  });

  it('appends -2, -3, … until free', () => {
    const taken = new Set(['tree-001.jpg', 'tree-001-2.jpg']);
    expect(uniqueFilename('tree-001.jpg', taken)).toBe('tree-001-3.jpg');
  });

  it('works without an extension', () => {
    const taken = new Set(['readme']);
    expect(uniqueFilename('readme', taken)).toBe('readme-2');
  });
});

describe('resolveExtension', () => {
  it('prefers sniffed extension', () => {
    expect(
      resolveExtension({
        sniffedExt: 'png',
        url: 'https://cdn.example/a.jpg',
        hintFilename: 'hint.webp',
      }),
    ).toBe('png');
  });

  it('uses hint filename when sniff is missing', () => {
    expect(
      resolveExtension({
        url: 'https://cdn.example/no-ext',
        hintFilename: 'photo.JPEG',
      }),
    ).toBe('jpeg');
  });

  it('falls back to the URL extension', () => {
    expect(resolveExtension({ url: 'https://cdn.example/a.webp?x=1' })).toBe('webp');
  });

  it('uses the provided fallback then bin', () => {
    expect(resolveExtension({ url: 'https://cdn.example/no-ext', fallback: 'dat' })).toBe('dat');
    expect(resolveExtension({ url: 'https://cdn.example/no-ext' })).toBe('bin');
  });
});
