import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../server/pipeline/pipeline.js';
import { llmHealthy } from '../server/processes.js';

const up = await llmHealthy();
const opts = { skip: up ? false : 'llama-server nao esta rodando' };

test('Pipeline end-to-end: extrai pergunta e emite banner', opts, async () => {
  const p = new Pipeline();
  const questions = [];
  p.on('question', (q) => questions.push(q));

  p.ingest('Candidato, o que o senhor pretende fazer sobre a segurança pública?');
  // aguarda processamento
  await new Promise((r) => setTimeout(r, 2500));

  assert.equal(questions.length, 1);
  assert.match(questions[0].text, /segurança pública/i);
});

test('Pipeline end-to-end: extrai afirmacao, busca e emite card com veredito', opts, async () => {
  const p = new Pipeline();
  const cards = [];
  p.on('card', (c) => cards.push(c));

  // Afirmação com fato conhecido que já testamos com a Fact Check API
  p.ingest('O IBGE considera os beneficiários do Bolsa Família como empregados para maquiar dados.');

  // Aguarda pipeline (extração + busca + veredito)
  for (let i = 0; i < 20; i++) {
    if (cards.some((c) => c.state === 'done')) break;
    await new Promise((r) => setTimeout(r, 800));
  }

  const checking = cards.find((c) => c.state === 'checking');
  const done = cards.find((c) => c.state === 'done');
  console.log('   [checking card]:', checking);
  console.log('   [done card]:', done);

  assert.ok(checking, 'deveria emitir card em estado checking');
  assert.ok(done, 'deveria emitir card em estado done');
  console.log(`   [card emitido] veredito: ${done.verdict} | regra: ${done.rule} | fontes: ${done.sources?.length}`);
  assert.ok(['FALSO', 'ENGANOSO', 'INCONCLUSIVO'].includes(done.verdict));
  assert.ok(done.sources?.length > 0, 'deveria incluir fontes');
  assert.ok(done.timings?.total > 0, 'deveria registrar timings');
});

test('Pipeline end-to-end: opiniao nao gera card de checagem', opts, async () => {
  const p = new Pipeline();
  const cards = [];
  p.on('card', (c) => cards.push(c));

  p.ingest('Eu acho que esse governo é o pior de todos os tempos.');
  await new Promise((r) => setTimeout(r, 2000));

  assert.equal(cards.length, 0, 'opiniao nao deve emitir cards');
});
