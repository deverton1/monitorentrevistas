/** Cliente WebSocket com reconexao automatica. */
export class Socket {
  constructor(url, { onMessage, onState }) {
    this.url = url; this.onMessage = onMessage; this.onState = onState;
    this.ws = null; this.closed = false; this.retry = 0;
    this._connect();
  }
  _connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => { this.retry = 0; this.onState?.(true); };
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try { this.onMessage(JSON.parse(ev.data)); } catch { /* ignora */ }
    };
    this.ws.onclose = () => {
      this.onState?.(false);
      if (this.closed) return;
      setTimeout(() => this._connect(), Math.min(5000, 600 * ++this.retry));
    };
  }
  get open() { return this.ws?.readyState === WebSocket.OPEN; }
  json(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  binary(buf) { if (this.open) this.ws.send(buf); }
}
