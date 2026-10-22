/** Utilitarios de texto compartilhados (normalizacao, tokens, relevancia lexical). */

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalize(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set((
  'para como mais mas pelo pela pelos pelas esse essa esses essas este esta estes estas isso isto aquele aquela ' +
  'quando onde quem qual quais sobre entre ate apos antes depois desde sempre nunca tambem ainda muito muita ' +
  'muitos muitas pouco pouca tudo todo toda todos todas cada outro outra outros outras seu sua seus suas dele dela ' +
  'deles delas nosso nossa nossos nossas disse falou foi foram sao esta estao tem tinha tinham ter teve fez fazer ' +
  'ser sido pode podem deve devem esta numa num uma uns umas dos das nos nas aos com sem por que nao sim ' +
  'vez ano anos disso nisso aqui alem ja so apenas mesmo mesma'
).split(/\s+/));

const stem = (w) => (/^\d/.test(w) ? w.replace(/%$/, '') : w.slice(0, 5));

/** Palavras inteiras de conteudo (sem truncar radical) para buscas em APIs. */
export function contentWords(text) {
  const out = [];
  const seen = new Set();
  for (const w of normalize(text).split(' ')) {
    if (!w) continue;
    if ((/^\d/.test(w) || w.length >= 4) && !STOPWORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/** Tokens de conteudo (palavras relevantes com stem curto e numeros). */
export function contentTokens(text) {
  const out = new Set();
  for (const w of normalize(text).split(' ')) {
    if (!w) continue;
    if (/^\d/.test(w)) { out.add(stem(w)); continue; }
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(stem(w));
  }
  return out;
}

/** Fracao dos tokens da afirmacao presentes no texto da evidencia, e contagem absoluta. */
export function overlap(claim, evidenceText) {
  const c = contentTokens(claim);
  if (c.size === 0) return { score: 0, hits: 0, size: 0 };
  const e = contentTokens(evidenceText);
  let hits = 0;
  for (const t of c) if (e.has(t)) hits++;
  return { score: hits / c.size, hits, size: c.size };
}

/** Evidencia relevante: termos em comum suficientes (para afirmacoes curtas, exige todos os termos). */
export function isRelevant(claim, evidenceText, minScore = 0.34) {
  const { score, hits, size } = overlap(claim, evidenceText);
  if (size === 0) return false;
  const minHits = size <= 2 ? size : 2;
  return hits >= minHits && score >= minScore;
}

export function digitSequences(text) {
  return (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
}

export function wordCount(s) {
  return (String(s ?? '').trim().match(/\S+/g) || []).length;
}
