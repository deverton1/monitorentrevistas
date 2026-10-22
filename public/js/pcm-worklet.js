// AudioWorklet: converte o fluxo (contexto a 16 kHz) em blocos PCM16 de ~100 ms e mede o nivel.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600;
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.peak = 0;
    this.frames = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      const a = Math.abs(s);
      if (a > this.peak) this.peak = a;
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        const out = this.buf.slice(0);
        this.port.postMessage({ pcm: out.buffer, peak: this.peak }, [out.buffer]);
        this.n = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
