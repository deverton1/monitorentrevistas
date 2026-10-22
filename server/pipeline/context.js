/** Janela deslizante das ultimas frases finais (para resolver pronomes). */
export class Context {
  constructor(maxSentences = 6, maxChars = 400) {
    this.maxSentences = maxSentences; this.maxChars = maxChars; this.items = [];
  }
  /** Contexto atual (antes de adicionar a frase corrente). */
  snapshot() {
    const picked = [];
    let chars = 0;
    for (let i = this.items.length - 1; i >= 0 && picked.length < this.maxSentences; i--) {
      chars += this.items[i].length;
      if (chars > this.maxChars && picked.length) break;
      picked.unshift(this.items[i]);
    }
    return picked;
  }
  push(sentence) {
    this.items.push(sentence);
    if (this.items.length > this.maxSentences * 2) this.items.shift();
  }
}
