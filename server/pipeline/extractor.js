import { chatJson } from '../llm/client.js';
import { EXTRACTION_SCHEMA } from '../llm/schemas.js';
import { EXTRACTION_SYSTEM, extractionUser } from '../llm/prompts.js';
import { digitSequences, wordCount } from './text.js';
import { similarity } from './dedupe.js';

const NON_CHECKABLE_KINDS = new Set(['opiniao', 'promessa', 'previsao']);

function cleanQuery(q) {
  return String(q ?? '')
    .replace(/["'“”‘’()[\]{}]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/g, ' ')
    .replace(/[:+\-*|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .join(' ');
}

/**
 * A pergunta exibida deve ser literal (o modelo pode parafrasear). Escolhe o trecho da fala original
 * mais parecido com o que o modelo devolveu, preferindo trechos terminados em '?'.
 */
export function verbatimQuestion(modelText, sentence) {
  const pieces = String(sentence).split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  if (pieces.length <= 1) return String(sentence).trim().slice(0, 240);
  const target = modelText || sentence;
  let best = pieces[0], bestScore = -1;
  for (const p of pieces) {
    const s = similarity(p, target) + (p.endsWith('?') ? 0.15 : 0);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return best.slice(0, 240);
}

/**
 * Guardrails em codigo sobre a saida do modelo (que ja vem com schema garantido):
 *  - so mantem afirmacoes checaveis, de tipo factual e com query util;
 *  - descarta afirmacoes que introduzem numeros ausentes da frase/contexto (alucinacao);
 *  - limita tamanho e normaliza a query.
 */
export function sanitizeExtraction(raw, sentence, contextSentences = []) {
  const source = `${contextSentences.join(' ')} ${sentence}`;
  const sourceNums = new Set(digitSequences(source));
  const out = {
    segment_type: raw?.segment_type ?? 'ruido',
    question_text: '',
    claims: [],
  };

  if (out.segment_type === 'pergunta') {
    out.question_text = verbatimQuestion(raw.question_text, sentence);
    return out;
  }

  for (const c of raw?.claims ?? []) {
    if (!c.checkworthy || NON_CHECKABLE_KINDS.has(c.kind)) continue;
    const query = cleanQuery(c.search_query);
    if (wordCount(query) < 2 || wordCount(c.claim) < 3) continue;
    const invented = digitSequences(c.claim).some((n) => !sourceNums.has(n));
    if (invented) continue;
    out.claims.push({ claim: c.claim.trim(), kind: c.kind, reason: c.reason, search_query: query });
  }
  return out;
}

export async function extract(sentence, contextSentences) {
  const raw = await chatJson({
    system: EXTRACTION_SYSTEM,
    user: extractionUser(sentence, contextSentences),
    schema: EXTRACTION_SCHEMA,
    schemaName: 'extracao',
    maxTokens: 320,
  });
  return { raw, ...sanitizeExtraction(raw, sentence, contextSentences) };
}
