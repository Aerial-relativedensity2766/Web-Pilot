import type { RankedItem } from '@webpilot/schemas';
import { lexicalSimilarity } from '@webpilot/shared';
import type { RankCandidate, RankOptions } from './types';

/**
 * Hybrid ranking: deterministic lexical overlap blended with an optional
 * MiniLM semantic signal.
 *
 * `score = (1 - w) * lexical + w * semantic` (default `w = 0.4`).
 * Without semantic scores the ranking is purely lexical — still deterministic
 * and good enough for the fixture site's tree/engine/laptop distractors.
 */
export function rankCandidates(
  query: string,
  candidates: readonly RankCandidate[],
  options: RankOptions = {},
): RankedItem[] {
  const weight = clamp01(options.semanticWeight ?? 0.4);
  const ranked = candidates.map((candidate, index) => {
    const lexicalScore = clamp01(lexicalSimilarity(query, candidate.text));
    const semanticRaw = options.semanticScores?.[index];
    const semanticScore =
      typeof semanticRaw === 'number' && Number.isFinite(semanticRaw) ? clamp01(semanticRaw) : undefined;
    const score =
      semanticScore === undefined ? lexicalScore : (1 - weight) * lexicalScore + weight * semanticScore;
    const rankedItem: RankedItem = {
      key: candidate.key,
      kind: candidate.kind,
      text: candidate.text,
      score,
      lexicalScore,
      item: candidate.item,
    };
    if (semanticScore !== undefined) rankedItem.semanticScore = semanticScore;
    return { rankedItem, index };
  });

  ranked.sort((a, b) => b.rankedItem.score - a.rankedItem.score || a.index - b.index);
  const sorted = ranked.map((entry) => entry.rankedItem);
  return typeof options.topK === 'number' ? sorted.slice(0, Math.max(0, options.topK)) : sorted;
}

/** Ranks extracted images by alt text (falls back to the URL slug). */
export function rankImages<T extends { url: string; alt: string }>(
  query: string,
  images: readonly T[],
  options: RankOptions = {},
): Array<RankedItem & { image: T }> {
  const candidates: RankCandidate[] = images.map((image) => ({
    key: image.url,
    kind: 'image' as const,
    text: image.alt && image.alt.trim().length > 1 ? image.alt : slugToWords(image.url),
    item: image,
  }));
  return rankCandidates(query, candidates, options).map((ranked) => ({
    ...ranked,
    image: ranked.item as T,
  }));
}

/** Ranks extracted links by link text (falls back to the URL). */
export function rankLinks<T extends { url: string; text: string }>(
  query: string,
  links: readonly T[],
  options: RankOptions = {},
): Array<RankedItem & { link: T }> {
  const candidates: RankCandidate[] = links.map((link) => ({
    key: link.url,
    kind: 'link' as const,
    text: link.text && link.text.trim().length > 1 ? link.text : slugToWords(link.url),
    item: link,
  }));
  return rankCandidates(query, candidates, options).map((ranked) => ({
    ...ranked,
    link: ranked.item as T,
  }));
}

/** Ranks free text blocks by their content. */
export function rankTexts<T extends { text: string }>(
  query: string,
  blocks: readonly T[],
  options: RankOptions = {},
): Array<RankedItem & { block: T }> {
  const candidates: RankCandidate[] = blocks.map((block, index) => ({
    key: `${block.text.slice(0, 80)}#${index}`,
    kind: 'text' as const,
    text: block.text,
    item: block,
  }));
  return rankCandidates(query, candidates, options).map((ranked) => ({
    ...ranked,
    block: ranked.item as T,
  }));
}

function slugToWords(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split('/').filter(Boolean).pop() ?? url;
    return last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ');
  } catch {
    return url;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
