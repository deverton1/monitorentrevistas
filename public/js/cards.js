/** Renderizacao de cards de checagem e do banner de pergunta. */

const LABELS = {
  VERDADEIRO: 'Verdadeiro',
  FALSO: 'Falso',
  ENGANOSO: 'Enganoso',
  SEM_EVIDENCIA: 'Sem evidência',
  INCONCLUSIVO: 'Inconclusivo',
};
const KIND = {
  estatistica: 'Estatística', acusacao: 'Acusação', fato_historico: 'Fato histórico',
  atribuicao: 'Atribuição', outro: 'Afirmação',
};
const NOTE = {
  nao_configurada: 'não configurada',
  cota_esgotada: 'cota esgotada',
  limite_frequencia: 'limite de frequência (1/s)',
  timeout: 'tempo limite excedido',
  erro: 'instável',
  ok: 'ok',
};

const MAX_VISIBLE = 4;
const EXPIRE_MS = 45000;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export class Cards {
  constructor(container, emptyEl, countEl) {
    this.container = container; this.emptyEl = emptyEl; this.countEl = countEl;
    this.nodes = new Map();
    this.total = 0;
  }

  upsert(card) {
    let node = this.nodes.get(card.id);
    const isNew = !node;
    if (isNew) {
      node = el('article', 'card');
      node.dataset.id = card.id;
      node.tabIndex = 0;
      this.nodes.set(card.id, node);
      this.container.prepend(node);
      this.total++;
      this.countEl.textContent = String(this.total);
      this.emptyEl.hidden = true;
    }
    this._render(node, card);
    if (card.state === 'done') this._scheduleExpiry(node);
    this._trim();
  }

  _render(node, c) {
    node.className = 'card' + (c.state === 'checking' ? ' checking' : '');
    node.dataset.verdict = c.verdict || '';
    node.replaceChildren();

    const top = el('div', 'card-top');
    const badge = el('span', 'badge');
    if (c.state === 'checking') {
      badge.append(el('span', 'spinner'), document.createTextNode('Verificando'));
    } else {
      badge.textContent = LABELS[c.verdict] || c.verdict;
    }
    const tools = el('div', 'card-tools');
    const pin = el('button', 'icon-btn', '📌');
    pin.type = 'button';
    pin.title = 'Fixar card';
    pin.setAttribute('aria-label', 'Fixar card');
    pin.setAttribute('aria-pressed', node.dataset.pinned === '1' ? 'true' : 'false');
    pin.addEventListener('click', () => {
      const on = node.dataset.pinned !== '1';
      node.dataset.pinned = on ? '1' : '';
      pin.setAttribute('aria-pressed', String(on));
      if (!on) this._scheduleExpiry(node);
    });
    const close = el('button', 'icon-btn', '✕');
    close.type = 'button';
    close.title = 'Dispensar';
    close.setAttribute('aria-label', 'Dispensar card');
    close.addEventListener('click', () => this._remove(node));
    tools.append(pin, close);
    top.append(badge, el('span', 'muted', KIND[c.kind] || ''), tools);
    node.append(top);

    node.append(el('p', 'card-claim', c.claim));
    const q = el('div', 'card-query');
    q.append(el('span', null, 'Pesquisado:'), el('code', null, c.query || '—'));
    node.append(q);

    if (c.state === 'done') {
      node.append(el('p', 'card-summary', c.summary));
      if (c.leaning) {
        node.append(el('p', 'card-leaning', `Indício (só notícias): tende a “${LABELS[c.leaning].toLowerCase()}”.`));
      }
      if (c.sources?.length) {
        const ul = el('ul', 'sources');
        for (const s of c.sources) {
          const li = el('li');
          const a = el('a');
          a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.append(el('span', `src-tier ${s.tier === 'A' ? 'a' : 'b'}`, s.tier === 'A' ? 'CHECAGEM' : 'NOTÍCIA'));
          const main = el('span', 'src-main');
          main.append(el('b', null, s.name), el('small', null, `${s.title}${s.date ? ' · ' + s.date : ''}`));
          a.append(main);
          if (s.rating) a.append(el('span', 'src-rating', s.rating));
          li.append(a);
          ul.append(li);
        }
        node.append(ul);
      }
      const foot = el('div', 'card-foot');
      const notes = c.notes
        ? Object.entries(c.notes).map(([k, v]) => `${k === 'factcheck' ? 'Fact Check' : 'GNews'}: ${NOTE[v] || v}`).join(' · ')
        : '';
      foot.append(el('span', null, notes), el('span', null, c.timings ? `⏱ ${(c.timings.total / 1000).toFixed(1)}s` : ''));
      node.append(foot);
    }
  }

  _scheduleExpiry(node) {
    clearTimeout(node._timer);
    node._timer = setTimeout(() => {
      if (node.dataset.pinned === '1' || node.matches(':hover, :focus-within')) return this._scheduleExpiry(node);
      this._remove(node);
    }, EXPIRE_MS);
  }

  _remove(node) {
    clearTimeout(node._timer);
    node.classList.add('fading');
    setTimeout(() => {
      node.remove();
      for (const [k, v] of this.nodes) if (v === node) this.nodes.delete(k);
      if (!this.container.querySelector('.card')) this.emptyEl.hidden = false;
    }, 600);
  }

  _trim() {
    const live = [...this.container.querySelectorAll('.card:not(.fading)')];
    const loose = live.filter((n) => n.dataset.pinned !== '1');
    for (const n of loose.slice(MAX_VISIBLE)) this._remove(n);
  }
}

export class QuestionBanner {
  constructor(banner, textEl) { this.banner = banner; this.textEl = textEl; this.timer = null; }
  show(text) {
    this.textEl.textContent = text;
    this.banner.hidden = false;
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth; // reinicia a animacao
    this.banner.style.animation = '';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.banner.hidden = true; }, 60000);
  }
}
