import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { config, ROOT } from './config.js';
import { startLlm, startStt, llmHealthy } from './processes.js';
import { Pipeline } from './pipeline/pipeline.js';
import { gnewsBudget } from './sources/gnews.js';

const app = express();
app.use(express.static(path.join(ROOT, 'public')));

const state = { llm: false, stt: false };

async function sttReachable() {
  return new Promise((resolve) => {
    const ws = new WebSocket(config.stt.url);
    const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve(false); }, 1200);
    ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

async function statusSnapshot() {
  [state.llm, state.stt] = await Promise.all([llmHealthy(), sttReachable()]);
  return {
    type: 'status',
    llm: state.llm,
    stt: state.stt,
    factcheck: config.sources.factCheckKey ? 'configurada' : 'nao_configurada',
    gnews: config.sources.gnewsKey ? `${gnewsBudget.remaining()} restantes hoje` : 'nao_configurada',
    model: config.llm.model.split(/[\\/]/).pop(),
    whisper: config.stt.model,
  };
}

app.get('/api/status', async (_req, res) => res.json(await statusSnapshot()));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (client) => {
  const send = (obj) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(obj)); };
  const pipeline = new Pipeline();
  let stt = null;

  pipeline.on('question', (q) => send({ type: 'question', ...q }));
  pipeline.on('card', (c) => send({ type: 'card', card: c }));
  pipeline.on('info', (i) => send({ type: 'info', ...i }));

  const closeStt = () => { if (stt) { try { stt.close(); } catch {} stt = null; } };

  function openStt() {
    closeStt();
    const ws = new WebSocket(config.stt.url);
    stt = ws;
    ws.on('open', () => send({ type: 'stt', state: 'ready' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'final') {
        send({ type: 'transcript', final: true, text: m.text, t0: m.t0, t1: m.t1 });
        pipeline.ingest(m.text);
      } else if (m.type === 'partial') {
        send({ type: 'transcript', final: false, text: m.text });
      } else if (m.type === 'info') {
        send({ type: 'info', msg: m.msg });
      }
    });
    ws.on('error', () => send({ type: 'stt', state: 'error' }));
    ws.on('close', () => { if (stt === ws) { stt = null; send({ type: 'stt', state: 'closed' }); } });
  }

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      if (stt && stt.readyState === WebSocket.OPEN) stt.send(data, { binary: true });
      return;
    }
    let m; try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'start') openStt();
    else if (m.type === 'stop') { if (stt?.readyState === WebSocket.OPEN) stt.send(JSON.stringify({ type: 'flush' })); setTimeout(closeStt, 1500); }
    else if (m.type === 'text') {
      const text = String(m.text ?? '').trim();
      if (!text) return;
      send({ type: 'transcript', final: true, text, manual: true });
      pipeline.ingest(text);
    } else if (m.type === 'status') statusSnapshot().then(send);
  });

  client.on('close', closeStt);
  statusSnapshot().then(send);
});

async function main() {
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`\nMonitor de Entrevistas em http://localhost:${config.port}\n`);
  });
  // Servicos pesados sobem em paralelo sem bloquear a interface.
  startLlm().then(async (ok) => {
    console.log(`[llm] ${ok ? 'pronto' : 'indisponivel'}`);
    if (ok) {
      try {
        const { extract } = await import('./pipeline/extractor.js');
        await extract('Olá, boa noite a todos.', []);
        console.log('[llm] warmup concluido');
      } catch (e) {
        console.warn(`[llm] warmup falhou: ${e.message}`);
      }
    }
  });
  startStt().then((ok) => console.log(`[stt] ${ok ? 'pronto' : 'indisponivel'}`));
}

main();
