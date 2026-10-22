import { refreshDevices, unlockLabels, save, loadSaved, playTestTone, supportsSinkId } from './devices.js';
import { Capture } from './capture.js';
import { Socket } from './ws.js';
import { Cards, QuestionBanner } from './cards.js';

const $ = (id) => document.getElementById(id);
const sel = { cam: $('sel-camera'), input: $('sel-input'), output: $('sel-output'), source: $('sel-source') };

/* ---------- utilidades de UI ---------- */
function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('toasts').append(t);
  setTimeout(() => t.remove(), err ? 6500 : 3500);
}
const setPill = (id, cls, title) => {
  const p = $(id);
  p.className = `pill ${cls}`;
  if (title) p.title = title;
};

const cards = new Cards($('cards'), $('cards-empty'), $('cards-count'));
const banner = new QuestionBanner($('question-banner'), $('question-text'));

/* ---------- transcricao ---------- */
const transcriptEl = $('transcript');
let partialEl = null;
const lines = new Map();

function addTranscript(text, { manual = false } = {}) {
  $('transcript-empty')?.remove();
  partialEl?.remove(); partialEl = null;
  const p = document.createElement('p');
  p.className = 'tline' + (manual ? ' manual' : '');
  p.textContent = text;
  transcriptEl.append(p);
  lines.set(text, p);
  while (transcriptEl.children.length > 40) transcriptEl.firstChild.remove();
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
function setPartial(text) {
  $('transcript-empty')?.remove();
  if (!partialEl) {
    partialEl = document.createElement('p');
    partialEl.className = 'tline partial';
    transcriptEl.append(partialEl);
  }
  partialEl.textContent = text + ' …';
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

/* ---------- websocket ---------- */
const socket = new Socket(`ws://${location.host}/ws`, {
  onState: (ok) => { if (!ok) { setPill('pill-llm', 'bad'); setPill('pill-stt', 'bad'); } },
  onMessage: (m) => {
    switch (m.type) {
      case 'status':
        setPill('pill-llm', m.llm ? 'ok' : 'warn', m.llm ? `LLM: ${m.model}` : 'LLM iniciando ou indisponível');
        setPill('pill-stt', m.stt ? 'ok' : 'warn', m.stt ? `Whisper ${m.whisper}` : 'Whisper iniciando ou indisponível');
        setPill('pill-fc', m.factcheck === 'configurada' ? 'ok' : 'bad', `Fact Check: ${m.factcheck}`);
        setPill('pill-gn', m.gnews.includes('restantes') ? 'ok' : 'bad', `GNews: ${m.gnews}`);
        break;
      case 'transcript':
        if (m.final) addTranscript(m.text, { manual: m.manual }); else setPartial(m.text);
        break;
      case 'question': banner.show(m.text); break;
      case 'card':
        cards.upsert(m.card);
        if (m.card.sentence) lines.get(m.card.sentence)?.classList.add('has-claim');
        break;
      case 'stt':
        $('stt-state').textContent = { ready: 'ouvindo', error: 'erro no Whisper', closed: 'parado' }[m.state] || m.state;
        if (m.state === 'error') toast('Não consegui conectar ao serviço de transcrição (Whisper).', true);
        break;
      case 'info': if (m.msg) console.info('[info]', m.msg); break;
    }
  },
});
setInterval(() => socket.json({ type: 'status' }), 8000);

/* ---------- captura ---------- */
const capture = new Capture({
  camVideo: $('video-cam'),
  screenVideo: $('video-screen'),
  monitorAudio: $('monitor-audio'),
  onPcm: (buf) => socket.binary(buf),
  onLevel: (peak) => { $('level-bar').style.width = `${Math.min(100, peak * 160)}%`; },
  onScreenEnded: () => { updateLayout(); toast('Compartilhamento de tela encerrado.'); },
});

function updateLayout() {
  const cam = !!capture.camStream, scr = !!capture.screenStream;
  $('card-cam').classList.toggle('live', cam);
  $('card-screen').classList.toggle('live', scr);
  $('video-grid').dataset.layout = cam && scr ? 'both' : scr ? 'screen-only' : 'cam-only';
}

let monitoring = false;

async function ensureDevices() {
  await unlockLabels();
  await refreshDevices({ cam: sel.cam, input: sel.input, output: sel.output });
}

$('btn-devices').addEventListener('click', async () => {
  try {
    await ensureDevices();
    await capture.startCamera(sel.cam.value);
    updateLayout();
    toast('Dispositivos ativados.');
  } catch (e) {
    toast(`Não foi possível acessar câmera/microfone: ${e.message}`, true);
  }
});

$('btn-screen').addEventListener('click', async () => {
  try {
    const { hasAudio } = await capture.startScreen();
    updateLayout();
    toast(hasAudio ? 'Tela compartilhada com áudio.' : 'Tela compartilhada SEM áudio — marque “Compartilhar áudio”.', !hasAudio);
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast(`Erro ao compartilhar tela: ${e.message}`, true);
  }
});

async function startMonitoring() {
  const source = sel.source.value;
  try {
    if (source !== 'screen' && !capture.camStream) await ensureDevices();
    await capture.startAudio({
      source, micId: sel.input.value, outputId: sel.output.value, monitor: $('chk-monitor').checked,
    });
  } catch (e) {
    toast(e.message || String(e), true);
    return;
  }
  socket.json({ type: 'start' });
  monitoring = true;
  $('btn-start').classList.add('running');
  $('btn-start-label').textContent = 'Parar monitoramento';
}

function stopMonitoring() {
  socket.json({ type: 'stop' });
  capture.stopAudio();
  monitoring = false;
  $('level-bar').style.width = '0%';
  $('btn-start').classList.remove('running');
  $('btn-start-label').textContent = 'Iniciar monitoramento';
}

$('btn-start').addEventListener('click', () => (monitoring ? stopMonitoring() : startMonitoring()));

/* ---------- seletores ---------- */
sel.cam.addEventListener('change', async () => {
  save({ camera: sel.cam.value });
  if (capture.camStream) {
    try { await capture.startCamera(sel.cam.value); } catch (e) { toast(`Erro ao trocar câmera: ${e.message}`, true); }
  }
});
sel.input.addEventListener('change', () => {
  save({ input: sel.input.value });
  if (monitoring && sel.source.value !== 'screen') toast('Pare e inicie o monitoramento para aplicar a nova entrada.');
});
sel.output.addEventListener('change', async () => {
  save({ output: sel.output.value });
  try {
    await capture.setOutput(sel.output.value);
    toast('Saída de áudio alterada.');
  } catch (e) { toast(e.message, true); }
});
sel.source.addEventListener('change', () => {
  save({ source: sel.source.value });
  $('field-mic').style.display = sel.source.value === 'screen' ? 'none' : '';
  if (monitoring) toast('Pare e inicie o monitoramento para trocar a origem.');
});
$('chk-monitor').addEventListener('change', (e) => capture.setMonitor(e.target.checked));
$('btn-test-out').addEventListener('click', async () => {
  try { await playTestTone($('monitor-audio'), sel.output.value); } catch (e) { toast(e.message, true); }
});

/* ---------- modo de teste ---------- */
$('manual-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('manual-input');
  const text = input.value.trim();
  if (!text) return;
  socket.json({ type: 'text', text });
  input.value = '';
});

/* ---------- init ---------- */
(async function init() {
  const saved = loadSaved();
  if (saved.source) sel.source.value = saved.source;
  $('field-mic').style.display = sel.source.value === 'screen' ? 'none' : '';
  if (!supportsSinkId()) {
    sel.output.disabled = true;
    $('btn-test-out').disabled = true;
    toast('Seu navegador não permite escolher a saída de áudio. Use Chrome ou Edge.', true);
  }
  try { await refreshDevices({ cam: sel.cam, input: sel.input, output: sel.output }); } catch { /* sem permissao ainda */ }
  navigator.mediaDevices.addEventListener('devicechange', () => {
    refreshDevices({ cam: sel.cam, input: sel.input, output: sel.output }).catch(() => {});
  });
})();
