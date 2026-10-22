import { config } from '../config.js';
import { DailyBudget } from '../pipeline/budget.js';

export const gnewsBudget = new DailyBudget('gnews', config.sources.gnewsDailyLimit);

export function normalizeGNews(body) {
  return (body?.articles ?? [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      tier: 'B',
      source: a.source?.name || 'Veículo',
      site: a.source?.url || '',
      title: a.title,
      description: a.description || '',
      url: a.url,
      publishedAt: a.publishedAt || '',
    }));
}


let lastGNewsCall = 0;
const MIN_INTERVAL_MS = 1150; // Plano gratuito do GNews limita a 1 req/s

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastGNewsCall;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastGNewsCall = Date.now();
}

export async function searchGNews(query, budget = gnewsBudget) {
  const key = config.sources.gnewsKey;
  if (!key) return { configured: false, items: [] };
  if (!budget.canSpend()) return { configured: true, exhausted: true, items: [] };

  const params = new URLSearchParams({
    q: query, lang: 'pt', country: 'br', max: '6', in: 'title,description', apikey: key,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    try {
      const r = await fetch(`https://gnews.io/api/v4/search?${params}`, {
        signal: AbortSignal.timeout(config.sources.timeoutMs + 2000),
      });

      if (r.status === 429) {
        console.warn('[gnews] 429 Rate limit atingido; aguardando backoff...');
        if (attempt === 0) {
          await new Promise((res) => setTimeout(res, 1600));
          continue;
        }
        return { configured: true, rateLimited: true, items: [] };
      }

      if (r.status === 403) {
        console.warn('[gnews] 403 Cota diária do GNews esgotada na API.');
        return { configured: true, exhausted: true, items: [] };
      }

      if (!r.ok) {
        throw new Error(`GNews HTTP ${r.status}`);
      }

      const body = await r.json();
      budget.spend(); // só desconta da cota quando a requisição realmente teve sucesso!
      return { configured: true, items: normalizeGNews(body) };
    } catch (e) {
      if (attempt === 1 || e.name === 'AbortError') {
        throw e;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  return { configured: true, items: [] };
}
