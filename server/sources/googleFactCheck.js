import { config } from '../config.js';

/**
 * Normaliza a resposta de claims:search para evidencias tier A.
 * Exportada separadamente para testes com fixtures.
 */
export function normalizeFactCheck(body) {
  const out = [];
  for (const c of body?.claims ?? []) {
    for (const rv of c.claimReview ?? []) {
      if (!rv.url) continue;
      out.push({
        tier: 'A',
        publisher: rv.publisher?.name || rv.publisher?.site || 'Checador',
        site: rv.publisher?.site || '',
        title: rv.title || '',
        url: rv.url,
        textualRating: (rv.textualRating || '').trim(),
        claimText: c.text || '',
        claimant: c.claimant || '',
        reviewDate: rv.reviewDate || c.claimDate || '',
      });
    }
  }
  return out;
}

export async function searchFactCheck(query) {
  const key = config.sources.factCheckKey;
  if (!key) return { configured: false, items: [] };
  const params = new URLSearchParams({
    query,
    languageCode: 'pt-BR',
    pageSize: '6',
    maxAgeDays: String(config.sources.factCheckMaxAgeDays),
    key,
  });
  const r = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`, {
    signal: AbortSignal.timeout(config.sources.timeoutMs),
  });
  if (!r.ok) throw new Error(`FactCheck HTTP ${r.status}`);
  return { configured: true, items: normalizeFactCheck(await r.json()) };
}
