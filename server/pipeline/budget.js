import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Cache LRU simples com TTL. */
export class LruCache {
  constructor(max = 200, ttlMs = 30 * 60 * 1000) {
    this.max = max; this.ttl = ttlMs; this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.t > this.ttl) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, hit);
    return hit.v;
  }
  set(key, v) {
    this.map.set(key, { v, t: Date.now() });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

/** Contador diario de chamadas persistido em disco (para respeitar cota gratuita). */
export class DailyBudget {
  constructor(name, limit, dir = config.dataDir) {
    this.name = name; this.limit = limit; this.file = path.join(dir, 'budget.json');
  }
  _today() { return new Date().toISOString().slice(0, 10); }
  _read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }
  used() {
    const d = this._read()[this.name];
    return d && d.day === this._today() ? d.count : 0;
  }
  remaining() { return Math.max(0, this.limit - this.used()); }
  canSpend() { return this.remaining() > 0; }
  spend() {
    const all = this._read();
    const count = this.used() + 1;
    all[this.name] = { day: this._today(), count };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(all));
    } catch { /* sem persistencia: segue em memoria */ }
    return count;
  }
}
