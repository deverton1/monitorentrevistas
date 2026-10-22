import { searchFactCheck } from '../sources/googleFactCheck.js';
import { searchGNews } from '../sources/gnews.js';
import { LruCache } from './budget.js';
import { contentTokens, contentWords, isRelevant } from './text.js';

const cache = new LruCache(200, 30 * 60 * 1000);

const evidenceText = (e) => (e.tier === 'A'
  ? `${e.claimText} ${e.title}`
  : `${e.title} ${e.description || ''}`);

/** Query curta com as palavras-chave inteiras da afirmacao (fallback quando a busca longa nao retorna nada). */
export function shortQuery(claim, max = 4) {
  return contentWords(claim).slice(0, max).join(' ');
}

async function safe(fn, label, notes) {
  try {
    const r = await fn();
    notes[label] = r.configured === false
      ? 'nao_configurada'
      : r.exhausted
      ? 'cota_esgotada'
      : r.rateLimited
      ? 'limite_frequencia'
      : 'ok';
    return r.items || [];
  } catch (e) {
    notes[label] = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'erro';
    console.warn(`[fonte:${label}] ${e.message}`);
    return [];
  }
}

/** Remove duplicatas por URL, mantem so evidencias relevantes, tier A primeiro, e numera [1..n]. */
export function rankEvidences(claim, items, max = 6) {
  const seen = new Set();
  const kept = items.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return isRelevant(claim, evidenceText(e));
  });
  kept.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'A' ? -1 : 1;
    return String(b.reviewDate || b.publishedAt || '').localeCompare(String(a.reviewDate || a.publishedAt || ''));
  });
  return kept.slice(0, max).map((e, i) => ({ ...e, id: i + 1 }));
}

export async function retrieve(claim, kind, query) {
  const key = `${kind}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const notes = {};
  const wantsNews = kind === 'estatistica' || kind === 'atribuicao' || kind === 'fato_historico';

  const fcRun = async () => {
    let items = await safe(() => searchFactCheck(query), 'factcheck', notes);
    // Se a query era longa ou retornou 0, tenta versao relaxada com termos centrais
    if (items.length === 0 && notes.factcheck === 'ok') {
      const words = contentWords(query);
      if (words.length > 3) {
        const relaxed = words.slice(0, 3).join(' ');
        items = await safe(() => searchFactCheck(relaxed), 'factcheck', notes);
      }
      if (items.length === 0) {
        const sq = shortQuery(claim, 4);
        if (sq && sq !== query) items = await safe(() => searchFactCheck(sq), 'factcheck', notes);
      }
    }
    return items;
  };
  const gnRun = async () => {
    let items = await safe(() => searchGNews(query), 'gnews', notes);
    if (items.length === 0 && notes.gnews === 'ok') {
      const words = contentWords(query);
      if (words.length > 4) {
        items = await safe(() => searchGNews(words.slice(0, 4).join(' ')), 'gnews', notes);
      }
    }
    return items;
  };

  let items;
  if (wantsNews) {
    const [a, b] = await Promise.all([fcRun(), gnRun()]);
    items = [...a, ...b];
  } else {
    const a = await fcRun();
    const relevantA = a.filter((e) => isRelevant(claim, evidenceText(e))).length;
    items = relevantA >= 1 ? a : [...a, ...(await gnRun())];
  }

  const result = { evidences: rankEvidences(claim, items), notes, query, rawCount: items.length };
  cache.set(key, result);
  return result;
}
