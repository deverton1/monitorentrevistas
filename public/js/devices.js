/** Enumeracao e selecao de dispositivos (camera, entrada e saida de audio). */

const STORE_KEY = 'monitor.devices.v1';

export function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
export function save(partial) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadSaved(), ...partial }));
}

function fill(select, devices, kind, savedId) {
  const prev = savedId ?? select.value;
  select.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Padrão do sistema';
  select.appendChild(def);
  devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `${kind === 'videoinput' ? 'Câmera' : kind === 'audioinput' ? 'Entrada' : 'Saída'} ${i + 1}`;
    select.appendChild(o);
  });
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
}

export async function refreshDevices({ cam, input, output }) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const saved = loadSaved();
  fill(cam, devices, 'videoinput', saved.camera);
  fill(input, devices, 'audioinput', saved.input);
  fill(output, devices, 'audiooutput', saved.output);
  return devices;
}

/** Pede permissao uma vez para liberar os rotulos dos dispositivos. */
export async function unlockLabels() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  stream.getTracks().forEach((t) => t.stop());
}

export const supportsSinkId = () => 'setSinkId' in HTMLMediaElement.prototype;

/** Aplica o dispositivo de saida ao elemento de audio/video. */
export async function setOutput(el, deviceId) {
  if (!supportsSinkId()) throw new Error('Este navegador não permite escolher a saída de áudio (use Chrome ou Edge).');
  await el.setSinkId(deviceId || '');
}

/** Toca um sinal de teste (dois bips) na saida escolhida. */
export async function playTestTone(audioEl, deviceId) {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(dest);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.connect(gain);
  const t = ctx.currentTime;
  [[880, 0], [1175, 0.35]].forEach(([f, off]) => {
    osc.frequency.setValueAtTime(f, t + off);
    gain.gain.setValueAtTime(0, t + off);
    gain.gain.linearRampToValueAtTime(0.25, t + off + 0.03);
    gain.gain.linearRampToValueAtTime(0, t + off + 0.28);
  });
  osc.start(t);
  osc.stop(t + 0.8);
  const prev = audioEl.srcObject;
  audioEl.srcObject = dest.stream;
  await setOutput(audioEl, deviceId);
  await audioEl.play();
  await new Promise((r) => setTimeout(r, 900));
  audioEl.srcObject = prev || null;
  ctx.close();
}
