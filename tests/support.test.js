import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Deduper, similarity } from '../server/pipeline/dedupe.js';
import { Context } from '../server/pipeline/context.js';
import { DailyBudget, LruCache } from '../server/pipeline/budget.js';
import { normalizeFactCheck } from '../server/sources/googleFactCheck.js';
import { normalizeGNews } from '../server/sources/gnews.js';

test('similarity: textos quase iguais > 0.7; diferentes < 0.4', () => {
  assert.ok(similarity('O desemprego caiu para 6% em 2024', 'o desemprego caiu para 6% em 2024.') > 0.9);
  assert.ok(similarity('O desemprego caiu para 6% em 2024', 'A vacina contra gripe é gratuita no SUS') < 0.4);
});

test('Deduper: segunda ocorrencia e rejeitada; expira apos a janela', () => {
  const d = new Deduper(1000, 0.7);
  assert.equal(d.accept('A taxa de desemprego caiu para 6% em 2024', 0), true);
  assert.equal(d.accept('A taxa de desemprego caiu para 6% em 2024.', 500), false);
  assert.equal(d.accept('A taxa de desemprego caiu para 6% em 2024', 2000), true);
});

test('Context: mantem janela e respeita limite de caracteres', () => {
  const c = new Context(3, 60);
  ['frase um aqui', 'frase dois aqui', 'frase tres aqui', 'frase quatro aqui'].forEach((s) => c.push(s));
  const snap = c.snapshot();
  assert.ok(snap.length <= 3);
  assert.equal(snap.at(-1), 'frase quatro aqui');
});

test('DailyBudget: conta, persiste e bloqueia no limite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
  const b = new DailyBudget('gnews', 2, dir);
  assert.equal(b.remaining(), 2);
  b.spend(); b.spend();
  assert.equal(b.canSpend(), false);
  assert.equal(new DailyBudget('gnews', 2, dir).used(), 2); // persistido
  fs.rmSync(dir, { recursive: true, force: true });
});

test('LruCache: expira por TTL e respeita capacidade', async () => {
  const c = new LruCache(2, 30);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('c'), 3);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(c.get('c'), undefined);
});

test('normalizeFactCheck: formato real do Google (rating variado, data ausente)', () => {
  const body = { claims: [
    { text: 'IBGE considera beneficiários do Bolsa Família como "empregados"', claimant: 'Redes', claimReview: [
      { publisher: { name: 'UOL Notícias', site: 'noticias.uol.com.br' }, url: 'https://x/1', title: 'É falso', textualRating: 'Falso', languageCode: 'pt' }] },
    { text: 'O IBGE considera empregados os beneficiários', claimReview: [
      { publisher: { name: 'Aos Fatos', site: 'aosfatos.org' }, url: 'https://x/2', title: 'Falso', textualRating: 'falso', reviewDate: '2026-08-03T00:00:00Z' },
      { publisher: { name: 'Sem URL' }, title: 'ignorado', textualRating: 'x' }] },
  ] };
  const items = normalizeFactCheck(body);
  assert.equal(items.length, 2);
  assert.equal(items[0].publisher, 'UOL Notícias');
  assert.equal(items[0].tier, 'A');
  assert.equal(items[1].reviewDate, '2026-08-03T00:00:00Z');
  assert.deepEqual(normalizeFactCheck({}), []);
});

test('normalizeGNews: mapeia artigos e ignora sem url/titulo', () => {
  const items = normalizeGNews({ articles: [
    { title: 'Desemprego cai', description: 'IBGE', url: 'https://g/1', publishedAt: '2026-09-29T16:22:00Z', source: { name: 'UOL', url: 'https://uol.com.br' } },
    { title: '', url: 'https://g/2' },
    { title: 'sem url' },
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].tier, 'B');
  assert.equal(items[0].source, 'UOL');
});
