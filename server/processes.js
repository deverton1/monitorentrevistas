import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.js';

const children = [];

function pipeLogs(name, child) {
  const out = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (line.trim()) console.log(`[${name}] ${line}`);
    }
  };
  child.stdout.on('data', out);
  child.stderr.on('data', out);
}

async function waitFor(check, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await check()) return true; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  console.warn(`[processos] ${label} nao respondeu em ${timeoutMs / 1000}s`);
  return false;
}

export async function llmHealthy() {
  try {
    const r = await fetch(`${config.llm.url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

export async function startLlm() {
  if (await llmHealthy()) { console.log('[llm] servidor ja esta rodando'); return true; }
  if (!config.llm.autostart) return false;
  if (!config.llm.model || !fs.existsSync(config.llm.model)) {
    console.warn(`[llm] modelo nao encontrado: ${config.llm.model}`);
    return false;
  }
  const args = ['-m', config.llm.model, '--port', String(config.llm.port), '--host', '127.0.0.1', ...config.llm.args];
  console.log(`[llm] iniciando: ${path.basename(config.llm.exe)} ${args.join(' ')}`);
  const child = spawn(config.llm.exe, args, { cwd: path.dirname(config.llm.exe), windowsHide: true });
  children.push(child);
  pipeLogs('llm', child);
  child.on('exit', (c) => console.log(`[llm] encerrou (${c})`));
  return waitFor(llmHealthy, 120000, 'llama-server');
}

function sttHealthy() {
  return new Promise((resolve) => {
    import('ws').then(({ WebSocket }) => {
      const ws = new WebSocket(config.stt.url);
      const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve(false); }, 1500);
      ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
      ws.on('error', () => { clearTimeout(t); resolve(false); });
    });
  });
}

export async function startStt() {
  if (await sttHealthy()) { console.log('[stt] servico ja esta rodando'); return true; }
  if (!config.stt.autostart) return false;
  const py = path.join(ROOT, 'stt', '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py)) {
    console.warn('[stt] venv nao encontrado. Rode: npm run setup:stt');
    return false;
  }
  console.log(`[stt] iniciando faster-whisper (${config.stt.model})`);
  const child = spawn(py, [path.join(ROOT, 'stt', 'stt_server.py'), '--port', String(config.stt.port), '--model', config.stt.model], {
    cwd: path.join(ROOT, 'stt'), windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  });
  children.push(child);
  pipeLogs('stt', child);
  child.on('exit', (c) => console.log(`[stt] encerrou (${c})`));
  return waitFor(sttHealthy, 180000, 'servico STT');
}

export function stopAll() {
  for (const c of children) {
    try { if (!c.killed) c.kill(); } catch { /* ja morto */ }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopAll(); process.exit(0); });
}
process.on('exit', stopAll);
