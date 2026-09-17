/** Small, dependency free text utilities shared by extraction, ranking and AI. */

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
  'image',
  'images',
  'picture',
  'pictures',
  'photo',
  'photos',
]);

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, maxLength: number, suffix = '…'): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

/** `"Green Tree Photography!"` → `"green-tree-photography"` */
export function slugify(value: string, fallback = 'item'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 60) : fallback;
}

/** Lowercased word tokens, stop words removed. */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

export function keywords(value: string): string[] {
  return tokenize(value).filter((token) => !STOP_WORDS.has(token));
}

/**
 * Deterministic lexical similarity (0..1) used as the rule-based half of the
 * hybrid ranking score. Cosine-ish overlap of keyword multisets plus a bonus
 * for exact phrase containment.
 */
export function lexicalSimilarity(query: string, candidate: string): number {
  const queryTokens = keywords(query);
  const candidateTokens = keywords(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateCounts = new Map<string, number>();
  for (const token of candidateTokens) {
    candidateCounts.set(token, (candidateCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of queryTokens) {
    const available = candidateCounts.get(token) ?? 0;
    if (available > 0) {
      overlap += 1;
      candidateCounts.set(token, available - 1);
    } else if (candidateTokens.some((candidateToken) => candidateToken.startsWith(token))) {
      overlap += 0.5; // partial stem match ("tree" vs "trees")
    }
  }

  const coverage = overlap / queryTokens.length;
  const precision = overlap / candidateTokens.length;
  const f1 = coverage + precision === 0 ? 0 : (2 * coverage * precision) / (coverage + precision);
  const phraseBonus = candidate.toLowerCase().includes(query.trim().toLowerCase()) ? 0.25 : 0;
  return Math.max(0, Math.min(1, f1 * 0.85 + phraseBonus));
}

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(item);
  }
  return output;
}

/** Cheap guard against alt-text style noise in extracted/ranked labels. */
export function isLowValueLabel(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized.length < 2) return true;
  return /^(image|img|photo|picture|thumbnail|unnamed|untitled|logo|icon|banner|ad|advert)$/.test(
    normalized,
  );
}