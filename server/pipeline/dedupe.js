import { normalize } from './text.js';

function trigrams(s) {
  const t = ` ${normalize(s)} `;
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

export function similarity(a, b) {
  const A = trigrams(a), B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Evita gerar cards repetidos para a mesma afirmacao dentro de uma janela de tempo. */
export class Deduper {
  constructor(windowMs = 20 * 60 * 1000, threshold = 0.7) {
    this.windowMs = windowMs; this.threshold = threshold; this.items = [];
  }
  /** Retorna true se a afirmacao for nova (e a registra); false se for duplicada. */
  accept(claim, now = Date.now()) {
    this.items = this.items.filter((i) => now - i.t < this.windowMs);
    if (this.items.some((i) => similarity(i.claim, claim) >= this.threshold)) return false;
    this.items.push({ claim, t: now });
    return true;
  }
}
