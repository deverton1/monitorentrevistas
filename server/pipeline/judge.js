import { chatJson } from '../llm/client.js';
import { VERDICT_SCHEMA } from '../llm/schemas.js';
import { VERDICT_SYSTEM, verdictUser } from '../llm/prompts.js';
import { normalize, overlap, isRelevant } from './text.js';

export const NO_EVIDENCE_SUMMARY = 'Nenhuma checagem ou notícia relevante foi encontrada nas fontes consultadas.';

/**
 * Mapeia o rating textual de um checador (tier A) para um veredito.
 * Os publicadores variam caixa e sinonimos ("Falso", "falso", "Errado", "Distorcido"...).
 * Ordem importa: FALSO e ENGANOSO sao testados antes de VERDADEIRO ("parcialmente verdadeiro" => ENGANOSO).
 */
export function mapRating(rating) {
  const r = normalize(rating);
  if (!r) return null;
  const has = (re) => re.test(r);
  if (has(/\b(nao e verdade|nao e verdadeir[oa]|falso|falsa|fake|errad[oa]|mentira|mentiros[oa]|golpe|boato|inverdade|sem fundamento|nao procede|incorret[oa])\b/)) return 'FALSO';
  if (has(/\b(enganos[oa]|distorcid[oa]|exagerad[oa]|impreciso|imprecisa|meia verdade|meio verdadeir[oa]|parcialmente|sem contexto|fora de contexto|descontextualizad[oa]|discutivel|misto|mixed|misleading|inflad[oa]|nao e bem assim|cuidado|alterad[oa]|manipulad[oa]|insustentavel|contraditori[oa])\b/)) return 'ENGANOSO';
  if (has(/\b(verdadeir[oa]|verdade|correct[oa]|correto|correta|certo|certa|real|confirmad[oa]|fato|true|procede|e fato)\b/)) return 'VERDADEIRO';
  return null;
}

const evText = (e) => (e.tier === 'A' ? `${e.claimText} ${e.title}` : `${e.title} ${e.description || ''}`);

function toSource(e) {
  return {
    id: e.id,
    tier: e.tier,
    name: e.tier === 'A' ? e.publisher : e.source,
    title: e.title,
    url: e.url, // sempre do objeto original da API, nunca do texto do modelo
    date: (e.reviewDate || e.publishedAt || '').slice(0, 10),
    rating: e.tier === 'A' ? e.textualRating : undefined,
  };
}

export function makeNoEvidenceSummary(notes = {}) {
  const parts = [];
  if (notes.factcheck === 'ok') {
    parts.push('Nenhuma checagem publicada encontrada nos checadores oficiais (Aos Fatos, Estadão, UOL).');
  } else if (notes.factcheck === 'nao_configurada') {
    parts.push('Google Fact Check não configurado.');
  }

  if (notes.gnews === 'ok') {
    parts.push('Nenhuma notícia recente correspondente na imprensa.');
  } else if (notes.gnews === 'limite_frequencia') {
    parts.push('A busca de notícias aguarda intervalo entre requisições da cota gratuita.');
  } else if (notes.gnews === 'cota_esgotada') {
    parts.push('O limite diário de notícias gratuitas do GNews foi atingido hoje.');
  } else if (notes.gnews === 'timeout') {
    parts.push('A consulta de notícias demorou mais que o esperado.');
  }

  return parts.length ? parts.join(' ') : NO_EVIDENCE_SUMMARY;
}

/**
 * Regras deterministicas aplicadas apos o LLM. O modelo NAO tem a palavra final.
 * @param {string} claim
 * @param {Array} evidences evidencias numeradas (com .id)
 * @param {object|null} llm saida do LLM (ou null se nao foi chamado)
 * @param {object} notes status das fontes
 */
export function applyRules(claim, evidences, llm, notes = {}) {
  const byId = new Map(evidences.map((e) => [e.id, e]));
  const noEvidenceSummary = (llm && llm.verdict === 'SEM_EVIDENCIA' && llm.summary?.trim())
    ? llm.summary.trim()
    : makeNoEvidenceSummary(notes);
  const result = {
    verdict: 'SEM_EVIDENCIA',
    confidence: 'baixa',
    summary: noEvidenceSummary,
    sources: [],
    leaning: null,
    rule: 'sem_evidencia',
  };
  if (!evidences.length) return result;

  // Quando o LLM está disponível, a decisão de quais evidências tratam da alegação é dele:
  if (llm) {
    let ids = (llm.used_evidence_ids || []).filter((id) => byId.has(id));
    // Regra anti-alucinação: a evidência selecionada precisa conter termos-chave mínimos da alegação.
    ids = ids.filter((id) => isRelevant(claim, evText(byId.get(id))));

    if (llm.verdict === 'SEM_EVIDENCIA' || ids.length === 0) {
      return result;
    }

    const used = ids.map((id) => byId.get(id));

    // Regra: se o LLM utilizou uma checagem Tier A com classificação mapeável,
    // o rating oficial da agência define o veredito (ex.: Falso, Enganoso),
    // DESDE QUE a afirmação do checador trate substancialmente do que foi falado (não um boato diferente).
    const tierA = used.find((e) => {
      if (e.tier !== 'A' || !mapRating(e.textualRating)) return false;
      const ov = overlap(e.claimText || e.title, claim);
      return ov.score >= 0.34;
    });
    if (tierA) {
      return {
        verdict: mapRating(tierA.textualRating),
        confidence: 'alta',
        summary: llm.summary || `${tierA.publisher} classificou a afirmação como "${tierA.textualRating}".`,
        sources: used.map(toSource),
        leaning: null,
        rule: 'rating_checador',
      };
    }

    const onlyB = used.every((e) => e.tier === 'B');
    let { verdict, confidence } = llm;
    let leaning = null;
    let rule = 'llm';

    // Regra: só notícias (tier B) não bastam para VERDADEIRO/FALSO definitivo => INCONCLUSIVO com "indício".
    if (onlyB) {
      if (verdict === 'VERDADEIRO' || verdict === 'FALSO' || verdict === 'ENGANOSO') {
        leaning = verdict;
        verdict = 'INCONCLUSIVO';
        rule = 'rebaixado_tier_b';
      }
      if (confidence === 'alta') confidence = 'media';
    }

    return { verdict, confidence, summary: llm.summary, sources: used.map(toSource), leaning, rule };
  }

  // Fallback quando o LLM está indisponível:
  // Só aplica rating de checador Tier A se a similaridade com a alegação for altíssima (>= 80% e >= 3 hits).
  const tierAFallback = evidences
    .filter((e) => e.tier === 'A' && mapRating(e.textualRating))
    .map((e) => ({ e, ov: overlap(claim, e.claimText) }))
    .filter(({ ov }) => ov.score >= 0.8 && ov.hits >= 3)
    .sort((a, b) => b.ov.score - a.ov.score);

  if (tierAFallback.length) {
    const best = tierAFallback[0].e;
    return {
      verdict: mapRating(best.textualRating),
      confidence: 'alta',
      summary: `${best.publisher} classificou afirmação semelhante como "${best.textualRating}".`,
      sources: [toSource(best)],
      leaning: null,
      rule: 'rating_checador',
    };
  }

  return result;
}

export async function judge(claim, evidences, notes = {}) {
  if (!evidences.length) return applyRules(claim, evidences, null, notes);
  // Se ja ha checagem tier A inequivoca, o LLM so resume; ainda assim chamamos para o resumo.
  let llm = null;
  try {
    llm = await chatJson({
      system: VERDICT_SYSTEM,
      user: verdictUser(claim, evidences),
      schema: VERDICT_SCHEMA,
      schemaName: 'veredito',
      maxTokens: 300,
    });
  } catch (e) {
    console.warn(`[judge] LLM falhou: ${e.message}`);
  }
  const res = applyRules(claim, evidences, llm, notes);
  if (!llm && res.rule === 'sem_evidencia') {
    // LLM indisponivel mas ha evidencias: mostrar como inconclusivo com fontes.
    return {
      verdict: 'INCONCLUSIVO', confidence: 'baixa',
      summary: 'Fontes encontradas, mas a análise automática não pôde ser concluída.',
      sources: evidences.slice(0, 3).map(toSource), leaning: null, rule: 'llm_indisponivel',
    };
  }
  return res;
}
