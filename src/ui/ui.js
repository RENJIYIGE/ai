import { PIECE_GLYPH, colorOf } from '../chess/engine.js';

const $ = (id) => document.getElementById(id);

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'];

export class UI {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.panel = $('panel');
    this.panelToggle = $('panel-toggle');
    this.statusTitle = $('status-title');
    this.statusSub = $('status-sub');
    this.statusCard = $('status-card');
    this.turnDot = $('turn-dot');
    this.thinking = $('thinking');
    this.movesEl = $('moves');
    this.moveCount = $('move-count');
    this.capturedWhite = $('captured-by-white');
    this.capturedBlack = $('captured-by-black');
    this.undoBtn = $('btn-undo');
    this.soundBtn = $('btn-sound');
    this.promotionModal = $('promotion-modal');
    this.promoOptions = $('promo-options');
    this.gameoverModal = $('gameover-modal');
    this.gameoverTitle = $('gameover-title');
    this.gameoverSub = $('gameover-sub');
    this.gameoverIcon = $('gameover-icon');
    this.loadingEl = $('loading');
    this.flashEl = $('impact-flash');
    this.fogNote = $('fog-note');
    this.canvasEl = $('scene');

    this.bind();
  }

  /** 撞击闪光 + 画面轻微推近：重播动画需要先移除类并强制回流 */
  flashImpact(power = 1) {
    const el = this.flashEl;
    if (!el) return;
    el.classList.remove('on');
    void el.offsetWidth;
    el.style.setProperty('--flash-alpha', Math.min(0.72, 0.3 * power).toFixed(2));
    el.classList.add('on');

    const canvas = this.canvasEl;
    if (canvas) {
      canvas.classList.remove('punch');
      void canvas.offsetWidth;
      canvas.classList.add('punch');
    }
  }

  bind() {
    const h = this.handlers;
    $('btn-new').addEventListener('click', () => h.onNew?.());
    $('btn-undo').addEventListener('click', () => h.onUndo?.());
    $('btn-flip').addEventListener('click', () => h.onFlip?.());
    $('btn-sound').addEventListener('click', () => h.onSoundToggle?.());
    $('btn-again').addEventListener('click', () => {
      this.hideGameOver();
      h.onNew?.();
    });
    $('btn-review').addEventListener('click', () => this.hideGameOver());

    this.panelToggle.addEventListener('click', () => this.togglePanel());
    this.panel.addEventListener('click', (e) => e.stopPropagation());

    $('mode-group').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      this.setMode(btn.dataset.mode);
      h.onModeChange?.(btn.dataset.mode);
    });

    $('level-group').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-level]');
      if (!btn) return;
      this.setLevel(Number(btn.dataset.level));
      h.onLevelChange?.(Number(btn.dataset.level));
    });

    $('fog-group').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-fog]');
      if (!btn) return;
      const on = btn.dataset.fog === '1';
      this.setFog(on);
      h.onFogChange?.(on);
    });
  }

  /* ---------------------------- 状态 ---------------------------- */

  setTurn({ turn, title, sub, check = false, thinking = false }) {
    this.turnDot.classList.toggle('is-black', turn === 'b');
    this.statusTitle.textContent = title;
    this.statusTitle.classList.toggle('check', check);
    this.statusSub.textContent = sub;
    this.thinking.hidden = !thinking;
  }

  setThinking(on) {
    this.thinking.hidden = !on;
  }

  setMode(mode) {
    document.querySelectorAll('#mode-group button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    $('level-group').classList.toggle('disabled', mode !== 'ai');
  }

  setLevel(level) {
    document.querySelectorAll('#level-group button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.level) === level);
    });
  }

  setFog(on) {
    document.querySelectorAll('#fog-group button').forEach((b) => {
      b.classList.toggle('active', (b.dataset.fog === '1') === on);
    });
    if (this.fogNote) this.fogNote.hidden = !on;
  }

  setSound(on) {
    this.soundBtn.textContent = on ? '🔊' : '🔇';
    this.soundBtn.title = on ? '关闭音效' : '开启音效';
  }

  setUndoEnabled(on) {
    this.undoBtn.disabled = !on;
  }

  togglePanel(force) {
    const open = force ?? !this.panel.classList.contains('open');
    this.panel.classList.toggle('open', open);
    this.panelToggle.textContent = open ? '✕' : '☰';
    this.panelToggle.setAttribute('aria-expanded', String(open));
  }

  /* ---------------------------- 棋谱 ---------------------------- */

  renderMoves(history, hideColor = null) {
    this.movesEl.innerHTML = '';
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'moves-empty';
      empty.textContent = '尚无着法';
      this.movesEl.appendChild(empty);
      this.moveCount.textContent = '0 步';
      return;
    }

    const rows = Math.ceil(history.length / 2);
    for (let i = 0; i < rows; i++) {
      const row = document.createElement('div');
      row.className = 'move-row';

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${i + 1}.`;
      row.appendChild(num);

      for (let k = 0; k < 2; k++) {
        const idx = i * 2 + k;
        const mv = document.createElement('span');
        mv.className = 'mv';
        const entry = history[idx];
        if (entry) {
          const hidden =
            hideColor && entry.move && colorOf(entry.move.piece) !== hideColor;
          mv.textContent = hidden ? '？' : entry.text;
          if (hidden) mv.classList.add('hidden-move');
          if (idx === history.length - 1) mv.classList.add('last');
        } else {
          mv.classList.add('empty');
          mv.textContent = '·';
        }
        row.appendChild(mv);
      }
      this.movesEl.appendChild(row);
    }

    this.moveCount.textContent = `${history.length} 步`;
    this.movesEl.scrollTop = this.movesEl.scrollHeight;
  }

  /* ---------------------------- 战果 ---------------------------- */

  renderCaptured({ byWhite = [], byBlack = [] }) {
    const render = (container, list, color, lead) => {
      container.innerHTML = '';
      const sorted = [...list].sort(
        (a, b) => CAPTURE_ORDER.indexOf(a) - CAPTURE_ORDER.indexOf(b)
      );
      for (const type of sorted) {
        const span = document.createElement('span');
        span.className = color;
        span.textContent = PIECE_GLYPH[color === 'w' ? 'b' : 'w'][type];
        container.appendChild(span);
      }
      if (lead > 0) {
        const span = document.createElement('span');
        span.className = 'lead';
        span.textContent = `+${lead}`;
        container.appendChild(span);
      }
    };

    const value = (list) => list.reduce((sum, t) => sum + (VALUE[t] || 0), 0);
    const diff = value(byWhite) - value(byBlack);
    render(this.capturedWhite, byWhite, 'b', diff);
    render(this.capturedBlack, byBlack, 'w', -diff);
  }

  /* ---------------------------- 升变 ---------------------------- */

  showPromotion(color) {
    const names = { q: '后', r: '车', b: '象', n: '马' };
    return new Promise((resolve) => {
      this.promoOptions.innerHTML = '';
      for (const type of ['q', 'r', 'b', 'n']) {
        const btn = document.createElement('button');
        btn.className = 'promo-btn' + (color === 'b' ? ' is-black' : '');
        btn.innerHTML = `<span class="glyph">${PIECE_GLYPH[color][type]}</span><span class="label">${names[type]}</span>`;
        btn.addEventListener('click', () => {
          this.promotionModal.hidden = true;
          resolve(type);
        });
        this.promoOptions.appendChild(btn);
      }
      this.promotionModal.hidden = false;
    });
  }

  hidePromotion() {
    this.promotionModal.hidden = true;
  }

  /* ---------------------------- 结束 ---------------------------- */

  showGameOver({ title, sub, icon }) {
    this.gameoverTitle.textContent = title;
    this.gameoverSub.textContent = sub;
    this.gameoverIcon.textContent = icon;
    this.gameoverModal.hidden = false;
  }

  hideGameOver() {
    this.gameoverModal.hidden = true;
  }

  hideLoading() {
    this.loadingEl.classList.add('done');
    setTimeout(() => {
      this.loadingEl.style.display = 'none';
    }, 800);
  }
}
