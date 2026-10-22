import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch { /* .env malformado: usa defaults */ }
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const e = process.env;

export const config = {
  port: int(e.PORT, 3000),
  llm: {
    autostart: bool(e.AUTOSTART_LLM, true),
    exe: e.LLAMA_SERVER_EXE || 'llama-server',
    model: e.LLAMA_MODEL || '',
    port: int(e.LLAMA_PORT, 8081),
    args: (e.LLAMA_ARGS || '-ngl 99 -c 8192 --parallel 2 --no-webui').split(/\s+/).filter(Boolean),
    get url() { return e.LLM_URL || `http://127.0.0.1:${this.port}`; },
    timeoutMs: int(e.LLM_TIMEOUT_MS, 20000),
  },
  stt: {
    autostart: bool(e.AUTOSTART_STT, true),
    port: int(e.STT_PORT, 8765),
    model: e.WHISPER_MODEL || 'large-v3-turbo',
    get url() { return `ws://127.0.0.1:${this.port}`; },
  },
  sources: {
    factCheckKey: e.GOOGLE_FACTCHECK_API_KEY || '',
    gnewsKey: e.GNEWS_API_KEY || '',
    gnewsDailyLimit: int(e.GNEWS_DAILY_LIMIT, 90),
    factCheckMaxAgeDays: int(e.FACTCHECK_MAX_AGE_DAYS, 1095),
    timeoutMs: int(e.SOURCES_TIMEOUT_MS, 4000),
  },
  pipeline: {
    contextSentences: 6,
    maxConcurrent: 2,
    maxQueueAgeMs: 20000,
    dedupeWindowMs: 20 * 60 * 1000,
    minWords: 5,
  },
  dataDir: path.join(ROOT, 'data'),
};
