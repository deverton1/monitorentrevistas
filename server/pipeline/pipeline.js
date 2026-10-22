import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { Context } from './context.js';
import { Deduper } from './dedupe.js';
import { extract } from './extractor.js';
import { retrieve } from './retriever.js';
import { judge } from './judge.js';
import { wordCount } from './text.js';

let cardSeq = 0;

/**
 * Orquestra: frase final -> extracao -> (pergunta | cards de afirmacoes) -> busca -> veredito.
 * Emite eventos: 'question' {text}, 'card' {id,state,...}, 'info' {msg}.
 */
export class Pipeline extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cfg = { ...config.pipeline, ...opts };
    this.context = new Context(this.cfg.contextSentences);
    this.deduper = new Deduper(this.cfg.dedupeWindowMs);
    this.queue = [];
    this.running = 0;
    this._extract = opts.extract || extract;
    this._retrieve = opts.retrieve || retrieve;
    this._judge = opts.judge || judge;
  }

  /** Recebe uma frase final transcrita (ou digitada). */
  ingest(text) {
    const sentence = String(text ?? '').trim();
    if (!sentence) return;
    const ctx = this.context.snapshot();
    this.context.push(sentence);
    // Perguntas curtas ainda valem ("Por que?"): so descarta o que nao tem conteudo nem '?'.
    if (wordCount(sentence) < this.cfg.minWords && !sentence.includes('?')) return;
    this.queue.push({ sentence, ctx, t: Date.now() });
    this._pump();
  }

  _pump() {
    while (this.running < this.cfg.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      if (Date.now() - job.t > this.cfg.maxQueueAgeMs) {
        this.emit('info', { msg: 'Frase descartada (fila atrasada)', sentence: job.sentence });
        continue;
      }
      this.running++;
      this._process(job)
        .catch((e) => this.emit('info', { msg: `Erro no pipeline: ${e.message}` }))
        .finally(() => { this.running--; this._pump(); });
    }
  }

  async _process({ sentence, ctx, t }) {
    const t0 = Date.now();
    const ex = await this._extract(sentence, ctx);
    const tExtract = Date.now() - t0;

    if (ex.segment_type === 'pergunta' && ex.question_text) {
      this.emit('question', { text: ex.question_text });
    }

    // Processa as afirmacoes em paralelo, cada uma com seu card.
    await Promise.all(ex.claims.map(async (c) => {
      if (!this.deduper.accept(c.claim)) return;
      const id = `c${++cardSeq}`;
      this.emit('card', {
        id, state: 'checking', claim: c.claim, kind: c.kind, query: c.search_query, sentence, t,
      });
      const t1 = Date.now();
      const ev = await this._retrieve(c.claim, c.kind, c.search_query);
      const tSearch = Date.now() - t1;
      const t2 = Date.now();
      const verdict = await this._judge(c.claim, ev.evidences, ev.notes);
      const tJudge = Date.now() - t2;
      this.emit('card', {
        id, state: 'done', claim: c.claim, kind: c.kind, query: ev.query, sentence, t,
        ...verdict,
        notes: ev.notes,
        timings: { extract: tExtract, search: tSearch, judge: tJudge, total: Date.now() - t0 },
      });
    }));
  }
}
