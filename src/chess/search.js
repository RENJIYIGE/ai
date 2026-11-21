/**
 * 简易国际象棋 AI：Alpha-Beta 剪枝 + 静态搜索 + 局面评估表
 * 在 Web Worker 中运行，避免阻塞渲染。
 */
import {
  applyMove,
  colorOf,
  findKing,
  generateLegalMoves,
  isInCheck,
  typeOf,
} from './engine.js';

const VALUE = { p: 100, n: 320, b: 335, r: 500, q: 950, k: 20000 };
export const MATE = 100000;

const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const ROOK_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_MID_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const KING_END_PST = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const PST = { p: PAWN_PST, n: KNIGHT_PST, b: BISHOP_PST, r: ROOK_PST, q: QUEEN_PST };

const mirror = (sq) => sq ^ 56;

function evaluate(state) {
  const { board } = state;
  let score = 0;
  let phaseMaterial = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  const whitePawnFiles = new Array(8).fill(0);
  const blackPawnFiles = new Array(8).fill(0);
  const pawnSquares = [];

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const type = typeOf(piece);
    const white = colorOf(piece) === 'w';
    const idx = white ? sq : mirror(sq);
    const value = VALUE[type] + (PST[type] ? PST[type][idx] : 0);
    score += white ? value : -value;
    if (type !== 'k' && type !== 'p') phaseMaterial += VALUE[type];
    if (type === 'b') white ? whiteBishops++ : blackBishops++;
    if (type === 'p') {
      const file = sq & 7;
      if (white) {
        whitePawnFiles[file]++;
        pawnSquares.push({ sq, white });
      } else {
        blackPawnFiles[file]++;
        pawnSquares.push({ sq, white });
      }
    }
  }

  // 双象优势
  if (whiteBishops >= 2) score += 30;
  if (blackBishops >= 2) score -= 30;

  // 叠兵惩罚
  for (let f = 0; f < 8; f++) {
    if (whitePawnFiles[f] > 1) score -= 12 * (whitePawnFiles[f] - 1);
    if (blackPawnFiles[f] > 1) score -= 12 * (blackPawnFiles[f] - 1);
  }

  // 通路兵奖励
  for (const { sq, white } of pawnSquares) {
    const file = sq & 7;
    const row = sq >> 3;
    const enemies = white ? blackPawnFiles : whitePawnFiles;
    let blocked = false;
    for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
      if (enemies[f]) blocked = true;
    }
    if (!blocked) {
      const advance = white ? 7 - row : row; // 越靠近升变越大
      score += (white ? 1 : -1) * (8 + advance * advance * 2);
    }
  }

  // 残局王的位置表
  const endgame = phaseMaterial < 1500;
  if (endgame) {
    const wk = findKing(board, 'w');
    const bk = findKing(board, 'b');
    if (wk >= 0) score += KING_END_PST[wk] - KING_MID_PST[wk];
    if (bk >= 0) score -= KING_END_PST[mirror(bk)] - KING_MID_PST[mirror(bk)];
  }

  score += state.turn === 'w' ? 8 : -8;
  return score;
}

function orderMoves(moves) {
  for (const m of moves) {
    let s = 0;
    if (m.captured) s += 1000 + VALUE[typeOf(m.captured)] * 10 - VALUE[typeOf(m.piece)];
    if (m.promotion) s += 900 + VALUE[m.promotion];
    if (m.castle) s += 60;
    m._s = s;
  }
  moves.sort((a, b) => b._s - a._s);
  return moves;
}

export class Search {
  constructor({ maxDepth = 3, timeLimit = 2000, randomness = 0 } = {}) {
    this.maxDepth = maxDepth;
    this.timeLimit = timeLimit;
    this.randomness = randomness;
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.repetition = new Map();
  }

  isTimeUp() {
    if (this.aborted) return true;
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  quiescence(state, alpha, beta, depth = 0) {
    this.nodes++;
    if (this.isTimeUp()) return alpha;
    const stand = evaluate(state) * (state.turn === 'w' ? 1 : -1);
    if (depth >= 4) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    const moves = orderMoves(
      generateLegalMoves(state).filter((m) => m.captured || m.promotion)
    );
    for (const move of moves) {
      const next = applyMove(state, move);
      const score = -this.quiescence(next, -beta, -alpha, depth + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(state, depth, alpha, beta, ply) {
    this.nodes++;
    if (this.isTimeUp()) return alpha;

    const moves = orderMoves(generateLegalMoves(state));
    if (!moves.length) {
      if (isInCheck(state, state.turn)) return -MATE + ply;
      return 0;
    }

    if (depth <= 0) return this.quiescence(state, alpha, beta, 0);

    // 50 回合和棋 / 重复局面
    if (state.halfmove >= 100) return 0;

    for (const move of moves) {
      const next = applyMove(state, move);
      const score = -this.negamax(next, depth - 1, -beta, -alpha, ply + 1);
      if (this.aborted) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  searchRoot(state, depth) {
    const moves = orderMoves(generateLegalMoves(state));
    const scored = [];
    let alpha = -Infinity;
    for (const move of moves) {
      const next = applyMove(state, move);
      let score = -this.negamax(next, depth - 1, -Infinity, -alpha, 1);
      if (this.aborted) return null;
      // 仅在“严格更优”时更新最优值，避免把剪枝得到的上界当成真实分数
      if (score > alpha) {
        alpha = score;
        scored.push({ move, score, best: true });
      } else {
        scored.push({ move, score: Math.min(score, alpha), best: false });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  run(state) {
    this.nodes = 0;
    this.aborted = false;
    this.deadline = performance.now() + this.timeLimit;
    const start = performance.now();
    let best = null;
    let bestScore = 0;

    const rootMoves = generateLegalMoves(state);
    if (!rootMoves.length) return { move: null, score: 0, nodes: 0, ms: 0, depth: 0 };

    for (let depth = 1; depth <= this.maxDepth; depth++) {
      const scored = this.searchRoot(state, depth);
      if (!scored || !scored.length) break;
      // 简单难度：从接近最优的走法中随机挑选（偶尔走出不够精确的棋）
      if (this.randomness > 0) {
        const top = scored.filter((s) => s.best && s.score >= scored[0].score - this.randomness);
        const pick = top.length ? top[Math.floor(Math.random() * top.length)] : scored[0];
        best = pick.move;
        bestScore = pick.score;
      } else {
        best = scored[0].move;
        bestScore = scored[0].score;
      }
      if (Math.abs(bestScore) > MATE - 200) break;
      if (performance.now() > this.deadline) break;
    }

    return {
      move: best,
      score: bestScore,
      nodes: this.nodes,
      ms: Math.round(performance.now() - start),
      depth: this.maxDepth,
    };
  }
}
