import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRating, applyRules, NO_EVIDENCE_SUMMARY } from '../server/pipeline/judge.js';
import { sanitizeExtraction } from '../server/pipeline/extractor.js';
import { rankEvidences, shortQuery } from '../server/pipeline/retriever.js';

test('mapRating normaliza caixa e sinonimos dos checadores', () => {
  for (const r of ['Falso', 'falso', 'FALSO', 'Errado', '#FAKE', 'Não é verdade', 'Falsa']) assert.equal(mapRating(r), 'FALSO', r);
  for (const r of ['Enganoso', 'Distorcido', 'Exagerado', 'Impreciso', 'Meia verdade', 'Parcialmente verdadeiro', 'Fora de contexto']) assert.equal(mapRating(r), 'ENGANOSO', r);
  for (const r of ['Verdadeiro', 'verdade', 'Fato', 'Correto', 'É verdade']) assert.equal(mapRating(r), 'VERDADEIRO', r);
  for (const r of ['', 'Apurado', 'Em análise', null, undefined]) assert.equal(mapRating(r), null, String(r));
});

const A = (over = {}) => ({
  id: 1, tier: 'A', publisher: 'Aos Fatos', title: 'IBGE considera empregados os beneficiários do Bolsa Família',
  claimText: 'O IBGE considera empregados os beneficiários do Bolsa Família', textualRating: 'falso',
  url: 'https://aosfatos.org/x', reviewDate: '2026-08-03T00:00:00Z', ...over,
});
const B = (over = {}) => ({
  id: 2, tier: 'B', source: 'UOL', title: 'Taxa de desemprego no Brasil cai para 5,3% no trimestre',
  description: 'Desemprego no Brasil é a menor desde 2012, mostra IBGE', url: 'https://uol.com.br/y', publishedAt: '2026-09-29T16:22:00Z', ...over,
});

test('tier A com rating mapeavel define o veredito (LLM so resume)', () => {
  const r = applyRules('O IBGE considera empregados beneficiários do Bolsa Família', [A()], {
    verdict: 'VERDADEIRO', confidence: 'baixa', summary: 'Resumo do LLM.', used_evidence_ids: [1], reasoning_short: '',
  });
  assert.equal(r.verdict, 'FALSO');
  assert.equal(r.confidence, 'alta');
  assert.equal(r.rule, 'rating_checador');
  assert.equal(r.sources[0].url, 'https://aosfatos.org/x');
  assert.equal(r.sources[0].rating, 'falso');
});

test('tier A de assunto diferente NAO sobrescreve o LLM', () => {
  const r = applyRules('A taxa de desemprego caiu para 6% em 2024', [A(), B()], {
    verdict: 'SEM_EVIDENCIA', confidence: 'baixa', summary: '', used_evidence_ids: [], reasoning_short: '',
  });
  assert.equal(r.verdict, 'SEM_EVIDENCIA');
});

test('quando LLM devolve SEM_EVIDENCIA, evidencia com sobreposicao lexical nao forca veredito falso', () => {
  const avi = A({
    id: 1,
    publisher: 'Observador',
    title: 'Aeronaves dos EUA foram vistas no Brasil antes de eleições?',
    claimText: 'Militares e aeronaves dos Estados Unidos foram vistos no Brasil na véspera da primeira volta das eleições presidenciais',
    textualRating: 'Errado',
  });
  const r = applyRules('O Brasil está passando por eleições.', [avi], {
    verdict: 'SEM_EVIDENCIA',
    confidence: 'alta',
    summary: 'Nenhuma evidência trata do fato de que o Brasil está passando por eleições.',
    used_evidence_ids: [],
    reasoning_short: 'A evidência fala de aeronaves dos EUA.',
  });
  assert.equal(r.verdict, 'SEM_EVIDENCIA');
  assert.equal(r.sources.length, 0);
  assert.match(r.summary, /Nenhuma evidência trata/);
});

test('IDs inexistentes ou vazios forcam SEM_EVIDENCIA', () => {
  const claim = 'A taxa de desemprego no Brasil caiu para 5,3%';
  let r = applyRules(claim, [B()], { verdict: 'VERDADEIRO', confidence: 'alta', summary: 'x', used_evidence_ids: [99], reasoning_short: '' });
  assert.equal(r.verdict, 'SEM_EVIDENCIA');
  assert.equal(r.summary, NO_EVIDENCE_SUMMARY);
  r = applyRules(claim, [B()], { verdict: 'FALSO', confidence: 'alta', summary: 'x', used_evidence_ids: [], reasoning_short: '' });
  assert.equal(r.verdict, 'SEM_EVIDENCIA');
});

test('so noticias (tier B) rebaixam VERDADEIRO/FALSO para INCONCLUSIVO com indicio', () => {
  const r = applyRules('A taxa de desemprego no Brasil caiu para 5,3%', [B()], {
    verdict: 'VERDADEIRO', confidence: 'alta', summary: 'Notícias confirmam.', used_evidence_ids: [2], reasoning_short: '',
  });
  assert.equal(r.verdict, 'INCONCLUSIVO');
  assert.equal(r.leaning, 'VERDADEIRO');
  assert.equal(r.confidence, 'media');
  assert.equal(r.rule, 'rebaixado_tier_b');
  assert.equal(r.sources[0].url, 'https://uol.com.br/y');
});

test('anti-alucinacao: evidencia usada sem termos da afirmacao => SEM_EVIDENCIA', () => {
  const r = applyRules('O governo dobrou o orçamento da educação em 2023', [B()], {
    verdict: 'FALSO', confidence: 'media', summary: 'x', used_evidence_ids: [2], reasoning_short: '',
  });
  assert.equal(r.verdict, 'SEM_EVIDENCIA');
});

test('sem evidencias => SEM_EVIDENCIA', () => {
  assert.equal(applyRules('qualquer coisa importante aqui', [], null).verdict, 'SEM_EVIDENCIA');
});

test('sanitizeExtraction: descarta opiniao, promessa, numeros inventados e queries fracas', () => {
  const raw = {
    segment_type: 'afirmacao', question_text: '',
    claims: [
      { claim: 'A inflação chegou a 12% em 2022.', kind: 'estatistica', checkworthy: true, reason: '', search_query: 'inflação 12% 2022 IBGE' },
      { claim: 'A inflação chegou a 99% em 2022.', kind: 'estatistica', checkworthy: true, reason: '', search_query: 'inflação 99% 2022' },
      { claim: 'O governo é péssimo.', kind: 'opiniao', checkworthy: false, reason: '', search_query: '' },
      { claim: 'Vai baixar impostos.', kind: 'promessa', checkworthy: true, reason: '', search_query: 'impostos baixar' },
      { claim: 'Fulano roubou dinheiro público.', kind: 'acusacao', checkworthy: true, reason: '', search_query: 'x' },
    ],
  };
  const out = sanitizeExtraction(raw, 'A inflação chegou a 12% em 2022 e o governo é péssimo.', []);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].claim, 'A inflação chegou a 12% em 2022.');
});

test('sanitizeExtraction: numero vindo do contexto e aceito; pergunta preserva texto', () => {
  const ok = sanitizeExtraction(
    { segment_type: 'afirmacao', question_text: '', claims: [{ claim: 'O ministro cortou 50% do orçamento da saúde.', kind: 'acusacao', checkworthy: true, reason: '', search_query: 'ministro cortou 50% orçamento saúde' }] },
    'Ele cortou metade.', ['O ministro disse que cortou 50% do orçamento.']);
  assert.equal(ok.claims.length, 1);
  const q = sanitizeExtraction({ segment_type: 'pergunta', question_text: 'Por que subiu?', claims: [] }, 'Por que subiu?', []);
  assert.equal(q.question_text, 'Por que subiu?');
  assert.equal(q.claims.length, 0);
});

test('sanitizeExtraction: limpa operadores/aspas da query', () => {
  const out = sanitizeExtraction(
    { segment_type: 'afirmacao', question_text: '', claims: [{ claim: 'O PIB cresceu 3% em 2023.', kind: 'estatistica', checkworthy: true, reason: '', search_query: '"PIB" AND crescimento -2023 (3%)' }] },
    'O PIB cresceu 3% em 2023.', []);
  assert.doesNotMatch(out.claims[0].search_query, /["()]|AND/);
});

test('rankEvidences: remove duplicatas e irrelevantes, tier A primeiro, ids sequenciais', () => {
  const items = [
    B({ url: 'https://u/1' }),
    A({ id: undefined, url: 'https://a/1' }),
    B({ url: 'https://u/1' }),
    B({ url: 'https://u/2', title: 'Time vence campeonato', description: 'Futebol' }),
  ];
  const r = rankEvidences('IBGE considera empregados beneficiários do Bolsa Família', items);
  assert.equal(r.length, 1);
  assert.equal(r[0].tier, 'A');
  assert.equal(r[0].id, 1);
});

test('shortQuery gera poucos termos-chave', () => {
  assert.ok(shortQuery('A taxa de desemprego no Brasil caiu para 6% em 2024').split(' ').length <= 5);
});
