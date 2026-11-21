import * as THREE from 'three';
import { createScene } from './scene/scene.js';
import { createBoard, squareToWorld, worldToSquare, BOARD_TOP } from './scene/board.js';
import { createPieceMesh } from './scene/pieces.js';
import { easeInOutCubic, easeOutBack } from './scene/animate.js';
import { shatterPiece, warmShatterTemplates } from './scene/shatter.js';
import * as E from './chess/engine.js';
import { UI } from './ui/ui.js';
import { Sound } from './audio.js';

const REASON_TEXT = {
  checkmate: '将死',
  stalemate: '无子可动 · 逼和',
  fifty: '50 回合规则',
  material: '子力不足',
  repetition: '三次重复局面',
};

const STORAGE_KEY = 'chess3d.settings.v1';

/** 走子动画时长（毫秒），吃子命中特效与之对齐 */
function moveDuration(type) {
  return type === 'n' ? 470 : 340;
}

/** 吃子命中时刻：略早于进攻方落子，让撞击与爆炸同时发生 */
function impactDelay(type) {
  return Math.max(140, moveDuration(type) - 40);
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = createScene(canvas);
    this.board = createBoard();
    this.scene.scene.add(this.board.group);

    this.piecesGroup = new THREE.Group();
    this.piecesGroup.name = 'pieces';
    this.scene.scene.add(this.piecesGroup);
    this.pieceMeshes = new Map();
    this.shatters = new Set();

    this.animator = this.scene.animator;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tmpVec = new THREE.Vector3();
    this.pointerDown = null;

    const settings = loadSettings();
    this.mode = settings.mode === 'pvp' ? 'pvp' : 'ai';
    this.level = [1, 2, 3].includes(settings.level) ? settings.level : 2;
    this.sound = new Sound(settings.sound !== false);
    this.aiColor = 'b';
    this.view = 'white';

    this.ui = new UI({
      onNew: () => this.newGame(),
      onUndo: () => this.undo(),
      onFlip: () => this.flipView(),
      onSoundToggle: () => this.toggleSound(),
      onModeChange: (mode) => this.setMode(mode),
      onLevelChange: (level) => this.setLevel(level),
    });
    this.ui.setMode(this.mode);
    this.ui.setLevel(this.level);
    this.ui.setSound(this.sound.enabled);

    this.state = E.createInitialState();
    this.history = [{ state: this.state, move: null, text: null }];
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.selected = -1;
    this.selectedMoves = [];
    this.lastMove = null;
    this.status = E.getGameStatus(this.state, [E.positionKey(this.state)]);
    this.gameOver = false;
    this.thinking = false;
    this.busy = false;
    this.requestId = 0;
    this.aiTimer = null;
    this.aiStart = 0;

    this.rebuildPieces({ intro: true });
    this.refreshHighlights();
    this.updateUI();

    this.setupWorker();
    this.bindEvents();

    // 调试入口
    window.chessGame = this;
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                             */
  /* ------------------------------------------------------------------ */

  setupWorker() {
    try {
      this.worker = new Worker(new URL('./chess/ai.worker.js', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event) => this.onAIResult(event.data);
      this.worker.onerror = (err) => {
        console.error('AI Worker 出错', err);
        this.thinking = false;
        this.busy = false;
        this.fallbackMove();
      };
    } catch (err) {
      console.error('无法启动 AI Worker', err);
      this.worker = null;
    }
  }

  bindEvents() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.sound.ensure();
      if (window.innerWidth <= 780) this.ui.togglePanel(false);
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
      el.style.cursor = 'grabbing';
    });

    el.addEventListener('pointerup', (e) => {
      el.style.cursor = '';
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down) return;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const elapsed = performance.now() - down.t;
      if (dist > 9 || elapsed > 700) return;
      this.onPointerTap(e);
    });

    el.addEventListener('pointermove', (e) => {
      if (this.pointerDown) return;
      this.updateCursor(e);
    });

    el.addEventListener('pointerleave', () => {
      this.canvas.style.cursor = '';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') {
        this.deselect();
      } else if (e.key === 'u' || e.key === 'U') {
        this.undo();
      } else if (e.key === 'f' || e.key === 'F') {
        this.flipView();
      } else if (e.key === 'n' || e.key === 'N') {
        this.newGame();
      }
    });
  }

  start() {
    this.scene.start((dt, time) => {
      this.board.update(time);
    });
    setTimeout(() => this.ui.hideLoading(), 350);
    requestAnimationFrame(() => this.scene.intro());
    // 开场动画之后在空闲时间预生成碎裂模板，第一次吃子也不掉帧
    setTimeout(() => warmShatterTemplates(), 2400);
    if (this.mode === 'ai' && this.state.turn === this.aiColor) this.requestAI();
  }

  /* ------------------------------------------------------------------ */
  /* 棋子网格                                                           */
  /* ------------------------------------------------------------------ */

  rebuildPieces({ intro = false } = {}) {
    for (const child of [...this.piecesGroup.children]) {
      this.piecesGroup.remove(child);
      child.traverse((obj) => {
        if (obj.isMesh && obj.geometry) obj.geometry.dispose();
      });
    }
    this.pieceMeshes.clear();

    for (let sq = 0; sq < 64; sq++) {
      const piece = this.state.board[sq];
      if (!piece) continue;
      const type = E.typeOf(piece);
      const color = E.colorOf(piece);
      const mesh = createPieceMesh(type, color);
      if (type === 'n') {
        // 骑士略向棋盘中心偏转，让侧面轮廓更容易辨认
        const inward = (sq & 7) < 4 ? 0.45 : -0.45;
        mesh.rotation.y += color === 'w' ? -inward : inward;
      }
      const pos = squareToWorld(sq);
      mesh.position.copy(pos);
      mesh.userData.square = sq;
      this.piecesGroup.add(mesh);
      this.pieceMeshes.set(sq, mesh);

      if (intro) {
        mesh.scale.setScalar(0.001);
        const delay = 150 + (sq >> 3) * 40 + Math.random() * 90;
        this.animator.add({
          duration: 520,
          delay,
          easing: easeOutBack,
          onUpdate: (t) => mesh.scale.setScalar(Math.max(0.001, t)),
          onComplete: () => mesh.scale.setScalar(1),
        });
      }
    }
  }

  refreshHighlights() {
    const checkSquare =
      this.status && this.status.check && !this.status.over
        ? E.findKing(this.state.board, this.state.turn)
        : -1;
    this.board.show({
      selected: this.selected,
      moves: this.selectedMoves,
      lastMove: this.lastMove,
      checkSquare,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 交互                                                               */
  /* ------------------------------------------------------------------ */

  eventToSquare(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.scene.camera);

    const hits = this.raycaster.intersectObjects(this.piecesGroup.children, true);
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && obj.userData.square === undefined) obj = obj.parent;
      if (obj) return obj.userData.square;
    }

    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return -1;
    const t = (BOARD_TOP - ray.origin.y) / ray.direction.y;
    if (t <= 0) return -1;
    const point = ray.at(t, this.tmpVec);
    return worldToSquare(point);
  }

  updateCursor(event) {
    if (this.busy || this.gameOver) {
      this.canvas.style.cursor = '';
      return;
    }
    const sq = this.eventToSquare(event);
    let actionable = false;
    if (sq >= 0) {
      const piece = this.state.board[sq];
      const humanTurn = !(this.mode === 'ai' && this.state.turn === this.aiColor);
      if (this.selected >= 0 && this.selectedMoves.some((m) => m.to === sq)) actionable = true;
      else if (piece && E.colorOf(piece) === this.state.turn && humanTurn) actionable = true;
    }
    this.canvas.style.cursor = actionable ? 'pointer' : 'grab';
  }

  async onPointerTap(event) {
    if (this.busy || this.gameOver) return;
    const sq = this.eventToSquare(event);
    if (sq < 0) {
      this.deselect();
      return;
    }
    await this.handleSquare(sq);
  }

  async handleSquare(sq) {
    if (this.busy || this.gameOver) return;

    if (sq === this.selected) {
      this.deselect();
      return;
    }

    if (this.selected >= 0) {
      const candidates = this.selectedMoves.filter((m) => m.to === sq);
      if (candidates.length) {
        let move = candidates[0];
        if (candidates.length > 1 && candidates[0].promotion) {
          this.busy = true;
          const color = E.colorOf(move.piece);
          this.deselect(false);
          this.refreshHighlights();
          const choice = await this.ui.showPromotion(color);
          move = candidates.find((m) => m.promotion === choice) || move;
          this.busy = false;
        }
        await this.executeMove(move);
        return;
      }
    }

    const piece = this.state.board[sq];
    if (piece && E.colorOf(piece) === this.state.turn) {
      if (this.mode === 'ai' && this.state.turn === this.aiColor) return;
      this.select(sq);
    } else {
      this.deselect();
    }
  }

  select(sq) {
    this.selected = sq;
    this.selectedMoves = E.generateLegalMoves(this.state).filter((m) => m.from === sq);
    this.refreshHighlights();
    if (this.selectedMoves.length) this.sound.select();
  }

  deselect(refresh = true) {
    this.selected = -1;
    this.selectedMoves = [];
    if (refresh) this.refreshHighlights();
  }

  /* ------------------------------------------------------------------ */
  /* 走子                                                               */
  /* ------------------------------------------------------------------ */

  async executeMove(move) {
    this.busy = true;

    const nextState = E.applyMove(this.state, move);
    const keys = this.history.map((h) => E.positionKey(h.state));
    keys.push(E.positionKey(nextState));
    const status = E.getGameStatus(nextState, keys);
    const { text } = E.moveToNotation(this.state, move, status);

    this.playMoveSound(move, status);
    await this.animateMove(move);

    this.state = nextState;
    this.history.push({ state: nextState, move, text });
    this.lastMove = move;
    this.status = status;
    this.deselect(false);
    this.recomputeCaptured();
    this.rebuildPieces();
    this.refreshHighlights();
    this.updateUI();
    this.busy = false;

    if (status.over) {
      this.gameOver = true;
      this.handleGameOver();
      return;
    }

    if (this.mode === 'ai' && this.state.turn === this.aiColor) {
      this.requestAI();
    }
  }

  animateMove(move) {
    const mesh = this.pieceMeshes.get(move.from);
    if (!mesh) return Promise.resolve();

    const from = squareToWorld(move.from);
    const to = squareToWorld(move.to);
    const type = E.typeOf(move.piece);
    const white = E.colorOf(move.piece) === 'w';
    const isKnight = type === 'n';
    const duration = moveDuration(type);
    const arc = isKnight ? 0.95 : 0.1;
    const startRot = mesh.rotation.x;
    const promises = [];

    promises.push(
      this.animator.add({
        duration,
        easing: isKnight ? easeInOutCubic : easeInOutCubic,
        onUpdate: (t) => {
          mesh.position.x = from.x + (to.x - from.x) * t;
          mesh.position.z = from.z + (to.z - from.z) * t;
          mesh.position.y = BOARD_TOP + Math.sin(Math.PI * t) * arc;
          if (isKnight) mesh.rotation.x = startRot + Math.sin(Math.PI * t) * -0.18;
        },
        onComplete: () => {
          mesh.position.set(to.x, BOARD_TOP, to.z);
          mesh.rotation.x = startRot;
        },
      })
    );

    // 被吃棋子
    let capturedSq = -1;
    if (move.ep) capturedSq = move.to + (white ? 8 : -8);
    else if (move.captured && !move.castle) capturedSq = move.to;

    if (capturedSq >= 0) {
      const capturedMesh = this.pieceMeshes.get(capturedSq);
      if (capturedMesh) {
        // 命中瞬间：被吃的棋子粉碎（不阻塞棋局状态推进）
        this.spawnShatter(capturedMesh, impactDelay(type), from, to);

        // 进攻方落子时的下压回弹，强化撞击感
        promises.push(
          this.animator.add({
            duration: 90,
            delay: Math.max(0, duration - 45),
            easing: (t) => t,
            onUpdate: (t) => {
              const k = Math.sin(Math.PI * t);
              mesh.scale.set(1 + 0.12 * k, 1 - 0.14 * k, 1 + 0.12 * k);
            },
            onComplete: () => mesh.scale.set(1, 1, 1),
          })
        );
      }
    }

    // 易位时的车
    if (move.castle) {
      const rank = white ? 7 : 0;
      const rookFrom = rank * 8 + (move.castle === 'k' ? 7 : 0);
      const rookTo = rank * 8 + (move.castle === 'k' ? 5 : 3);
      const rookMesh = this.pieceMeshes.get(rookFrom);
      if (rookMesh) {
        const rf = squareToWorld(rookFrom);
        const rt = squareToWorld(rookTo);
        promises.push(
          this.animator.add({
            duration,
            easing: easeInOutCubic,
            onUpdate: (t) => {
              rookMesh.position.x = rf.x + (rt.x - rf.x) * t;
              rookMesh.position.z = rf.z + (rt.z - rf.z) * t;
              rookMesh.position.y = BOARD_TOP + Math.sin(Math.PI * t) * 0.12;
            },
            onComplete: () => rookMesh.position.set(rt.x, BOARD_TOP, rt.z),
          })
        );
      }
    }

    return Promise.all(promises);
  }

  spawnShatter(piece, delay, fromPoint, toPoint) {
    // 撞击方向（世界坐标，水平分量）：镜头冲撞与碎片抛射都朝这个方向
    const dir = new THREE.Vector3(
      toPoint.x - fromPoint.x,
      0,
      toPoint.z - fromPoint.z
    );
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    let effect = null;
    effect = shatterPiece({
      piece,
      parent: this.scene.scene,
      animator: this.animator,
      delay,
      lowPower: this.scene.lowPower,
      reducedMotion: this.prefersReducedMotion(),
      from: fromPoint,
      onImpact: () => {
        this.scene.impact(dir, 0.3, 220);
        this.ui.flashImpact(1);
      },
      onDone: () => this.shatters.delete(effect),
    });
    this.shatters.add(effect);
    return effect;
  }

  clearShatters() {
    for (const effect of this.shatters) effect.kill();
    this.shatters.clear();
  }

  prefersReducedMotion() {
    return !!(
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  playMoveSound(move, status) {
    if (move.castle) this.sound.castle();
    else if (move.captured) {
      // 先是一声划过的气声，命中瞬间再放重击
      this.sound.slide();
      setTimeout(() => {
        if (this.sound.enabled) this.sound.impact(this.level === 1 ? 0.85 : 1);
      }, impactDelay(E.typeOf(move.piece)));
    } else this.sound.move();
    if (status.check) setTimeout(() => this.sound.check(), 130);
    if (move.promotion) setTimeout(() => this.sound.promote(), 240);
  }

  recomputeCaptured() {
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    for (const entry of this.history) {
      const move = entry.move;
      if (!move || !move.captured) continue;
      const type = E.typeOf(move.captured);
      if (E.colorOf(move.piece) === 'w') this.capturedByWhite.push(type);
      else this.capturedByBlack.push(type);
    }
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                 */
  /* ------------------------------------------------------------------ */

  requestAI() {
    if (this.gameOver) return;
    if (!this.worker) {
      this.thinking = true;
      this.busy = true;
      this.updateUI();
      setTimeout(() => this.fallbackMove(), 600);
      return;
    }
    this.cancelAI(false);
    this.thinking = true;
    this.busy = true;
    this.aiStart = performance.now();
    const id = ++this.requestId;
    this.worker.postMessage({
      type: 'search',
      id,
      level: this.level,
      key: E.positionKey(this.state),
      state: this.state,
    });
    this.updateUI();
  }

  fallbackMove() {
    if (this.gameOver || this.state.turn !== this.aiColor) {
      this.thinking = false;
      this.busy = false;
      this.updateUI();
      return;
    }
    const legal = E.generateLegalMoves(this.state);
    this.thinking = false;
    this.busy = false;
    if (!legal.length) {
      this.updateUI();
      return;
    }
    const move = legal[Math.floor(Math.random() * legal.length)];
    this.executeMove(move);
  }

  onAIResult(data) {
    if (!data || data.type !== 'result' || data.id !== this.requestId) return;
    this.thinking = false;
    const key = E.positionKey(this.state);
    if (this.gameOver) {
      this.busy = false;
      this.updateUI();
      return;
    }
    if (!data.move || data.key !== key) {
      const legal = E.generateLegalMoves(this.state);
      this.busy = false;
      if (legal.length && this.state.turn === this.aiColor) this.executeMove(legal[0]);
      else this.updateUI();
      return;
    }
    const wait = Math.max(0, 380 - (performance.now() - this.aiStart));
    clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      this.busy = false;
      if (this.gameOver || this.state.turn !== this.aiColor) {
        this.updateUI();
        return;
      }
      this.executeMove(data.move);
    }, wait);
  }

  cancelAI(resetBusy = true) {
    clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.requestId++;
    this.thinking = false;
    if (resetBusy) this.busy = false;
  }

  /* ------------------------------------------------------------------ */
  /* 状态与界面                                                         */
  /* ------------------------------------------------------------------ */

  updateUI() {
    const status = this.status;
    const turn = this.state.turn;
    let title;
    let sub;

    if (status.over) {
      title = status.result === 'draw' ? '和棋' : `${status.result === 'w' ? '白方' : '黑方'}获胜`;
      sub = REASON_TEXT[status.reason] || '对局结束';
    } else if (this.thinking) {
      title = 'AI 思考中';
      sub = '正在搜索最佳着法…';
    } else if (status.check) {
      title = '将军！';
      sub = `${turn === 'w' ? '白方' : '黑方'}必须应将`;
    } else {
      title = turn === 'w' ? '轮到白方' : '轮到黑方';
      if (this.mode === 'ai') {
        sub = turn === this.aiColor ? '对手行棋' : '你执白方 · 点击棋子';
      } else {
        sub = '双人对战';
      }
    }

    this.ui.setTurn({
      turn,
      title,
      sub,
      check: status.check && !status.over,
      thinking: this.thinking,
    });
    this.ui.renderMoves(this.history.slice(1));
    this.ui.renderCaptured({ byWhite: this.capturedByWhite, byBlack: this.capturedByBlack });
    this.ui.setUndoEnabled(this.history.length > 1);
    this.ui.setMode(this.mode);
  }

  handleGameOver() {
    const status = this.status;
    const human = this.aiColor === 'w' ? 'b' : 'w';
    let payload;
    if (status.result === 'draw') {
      payload = { title: '和棋', sub: REASON_TEXT[status.reason] || '双方各得半分', icon: '½' };
      this.sound.end('draw');
    } else {
      payload = {
        title: '将死',
        sub: `${status.result === 'w' ? '白方' : '黑方'}获胜`,
        icon: status.result === 'w' ? '♔' : '♚',
      };
      if (this.mode === 'ai') this.sound.end(status.result === human ? 'win' : 'lose');
      else this.sound.end('win');
    }
    setTimeout(() => {
      if (this.gameOver) this.ui.showGameOver(payload);
    }, 800);
  }

  /* ------------------------------------------------------------------ */
  /* 操作                                                               */
  /* ------------------------------------------------------------------ */

  newGame() {
    this.cancelAI();
    this.clearShatters();
    this.ui.hideGameOver();
    this.ui.hidePromotion();
    this.state = E.createInitialState();
    this.history = [{ state: this.state, move: null, text: null }];
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.selected = -1;
    this.selectedMoves = [];
    this.lastMove = null;
    this.gameOver = false;
    this.status = E.getGameStatus(this.state, [E.positionKey(this.state)]);
    this.rebuildPieces({ intro: true });
    this.refreshHighlights();
    this.updateUI();
    this.sound.start();
    if (this.mode === 'ai' && this.state.turn === this.aiColor) {
      setTimeout(() => this.requestAI(), 900);
    }
  }

  undo() {
    if (this.history.length <= 1) return;
    this.cancelAI();
    this.clearShatters();
    this.ui.hideGameOver();
    const human = this.aiColor === 'w' ? 'b' : 'w';
    let plies = 1;
    if (this.mode === 'ai') {
      plies = this.state.turn === human ? 2 : 1;
    }
    plies = Math.min(plies, this.history.length - 1);

    this.history = this.history.slice(0, this.history.length - plies);
    this.state = this.history[this.history.length - 1].state;
    this.gameOver = false;
    this.lastMove = this.history[this.history.length - 1].move || null;
    this.status = E.getGameStatus(
      this.state,
      this.history.map((h) => E.positionKey(h.state))
    );
    this.deselect(false);
    this.recomputeCaptured();
    this.rebuildPieces();
    this.refreshHighlights();
    this.updateUI();

    if (this.mode === 'ai' && this.state.turn === this.aiColor) {
      setTimeout(() => this.requestAI(), 200);
    }
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.cancelAI();
    this.mode = mode;
    this.ui.setMode(mode);
    saveSettings({ ...loadSettings(), mode });
    this.updateUI();
    if (mode === 'ai' && !this.gameOver && this.state.turn === this.aiColor) {
      this.requestAI();
    }
  }

  setLevel(level) {
    this.level = level;
    this.ui.setLevel(level);
    saveSettings({ ...loadSettings(), level });
    if (this.thinking) this.requestAI();
  }

  toggleSound() {
    this.sound.enabled = !this.sound.enabled;
    saveSettings({ ...loadSettings(), sound: this.sound.enabled });
    this.ui.setSound(this.sound.enabled);
    if (this.sound.enabled) {
      this.sound.ensure();
      this.sound.select();
    }
  }

  flipView() {
    this.view = this.view === 'white' ? 'black' : 'white';
    this.scene.flyToView(this.view, { duration: 850 });
  }

  resetView() {
    this.view = 'white';
    this.scene.flyToView('white', { duration: 850 });
  }
}
