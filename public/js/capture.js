import { setOutput } from './devices.js';

/** Captura de camera, tela e audio (microfone/dispositivo, audio da tela ou ambos mixados). */
export class Capture {
  constructor({ camVideo, screenVideo, monitorAudio, onPcm, onLevel, onScreenEnded }) {
    Object.assign(this, { camVideo, screenVideo, monitorAudio, onPcm, onLevel, onScreenEnded });
    this.camStream = null;
    this.screenStream = null;
    this.micStream = null;
    this.ctx = null;
    this.monitorCtx = null;
    this.monitorGain = null;
  }

  /* ---------------- Video ---------------- */
  async startCamera(deviceId) {
    this.stopCamera();
    this.camStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.camVideo.srcObject = this.camStream;
    return this.camStream;
  }
  stopCamera() {
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.camStream = null;
    this.camVideo.srcObject = null;
  }

  async startScreen() {
    this.stopScreen();
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
    });
    this.screenVideo.srcObject = this.screenStream;
    this.screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stopScreen();
      this.onScreenEnded?.();
    });
    return { hasAudio: this.screenStream.getAudioTracks().length > 0 };
  }
  stopScreen() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenVideo.srcObject = null;
  }
  get hasScreenAudio() { return !!this.screenStream?.getAudioTracks().length; }

  /* ---------------- Audio ---------------- */
  async startAudio({ source, micId, outputId, monitor }) {
    this.stopAudio();
    const tracks = [];

    if (source === 'mic' || source === 'both') {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micId ? { exact: micId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      tracks.push(this.micStream);
    }
    if (source === 'screen' || source === 'both') {
      if (!this.hasScreenAudio) {
        this.stopAudio();
        throw new Error('A tela compartilhada não tem áudio. Compartilhe novamente e marque “Compartilhar áudio”.');
      }
      tracks.push(new MediaStream(this.screenStream.getAudioTracks()));
    }

    // Caminho para o servidor: contexto a 16 kHz (o navegador reamostra).
    this.ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('js/pcm-worklet.js');
    const mix = this.ctx.createGain();
    tracks.forEach((s) => this.ctx.createMediaStreamSource(s).connect(mix));
    const node = new AudioWorkletNode(this.ctx, 'pcm-worklet', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (ev) => {
      this.onPcm?.(ev.data.pcm);
      this.onLevel?.(ev.data.peak);
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    mix.connect(node).connect(mute).connect(this.ctx.destination);

    // Caminho de monitoramento: taxa nativa, enviado ao dispositivo de saida escolhido.
    this.monitorCtx = new AudioContext();
    const mMix = this.monitorCtx.createGain();
    tracks.forEach((s) => this.monitorCtx.createMediaStreamSource(s).connect(mMix));
    this.monitorGain = this.monitorCtx.createGain();
    this.monitorGain.gain.value = monitor ? 1 : 0;
    const dest = this.monitorCtx.createMediaStreamDestination();
    mMix.connect(this.monitorGain).connect(dest);
    this.monitorAudio.srcObject = dest.stream;
    await this.setOutput(outputId);
    await this.monitorAudio.play().catch(() => {});
  }

  stopAudio() {
    this.ctx?.close().catch(() => {});
    this.monitorCtx?.close().catch(() => {});
    this.ctx = this.monitorCtx = this.monitorGain = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.monitorAudio.srcObject = null;
  }

  setMonitor(on) {
    if (this.monitorGain) this.monitorGain.gain.value = on ? 1 : 0;
  }

  async setOutput(deviceId) {
    await setOutput(this.monitorAudio, deviceId);
  }
}
