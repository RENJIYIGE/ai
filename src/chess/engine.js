/**
 * 国际象棋规则引擎
 * ------------------------------------------------------------
 * 棋盘使用长度为 64 的一维数组表示：
 *   index 0   = a8（黑方底线，左上角）
 *   index 63  = h1（白方底线，右下角）
 * 棋子使用 FEN 单字符表示：大写为白方（P N B R Q K），小写为黑方。
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const PIECE_CN = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
export const PIECE_GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

export const isWhite = (piece) => !!piece && piece === piece.toUpperCase();
export const colorOf = (piece) => (piece ? (isWhite(piece) ? 'w' : 'b') : null);
export const typeOf = (piece) => (piece ? piece.toLowerCase() : null);

export const fileOf = (sq) => sq & 7;
export const rowOf = (sq) => sq >> 3;
export const squareName = (sq) => 'abcdefgh'[fileOf(sq)] + (8 - rowOf(sq));
export const squareFromName = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
export const opponent = (color) => (color === 'w' ? 'b' : 'w');

const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const KING_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

/* ------------------------------------------------------------------ */
/* FEN                                                                */
/* ------------------------------------------------------------------ */

export function parseFen(fen = START_FEN) {
  const parts = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  let sq = 0;
  for (const ch of parts[0]) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) sq += Number(ch);
    else board[sq++] = ch;
  }
  return {
    board,
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: parts[2] && parts[2] !== '-' ? parts[2] : '',
    ep: parts[3] && parts[3] !== '-' ? squareFromName(parts[3]) : -1,
    halfmove: Number(parts[4] || 0),
    fullmove: Number(parts[5] || 1),
  };
}

export function toFen(state) {
  let out = '';
  for (let row = 0; row < 8; row++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = state.board[row * 8 + file];
      if (!p) empty++;
      else {
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
    }
    if (empty) out += empty;
    if (row < 7) out += '/';
  }
  return [
    out,
    state.turn,
    state.castling || '-',
    state.ep >= 0 ? squareName(state.ep) : '-',
    state.halfmove,
    state.fullmove,
  ].join(' ');
}

export function createInitialState() {
  return parseFen(START_FEN);
}

export function cloneState(state) {
  return {
    board: state.board.slice(),
    turn: state.turn,
    castling: state.castling,
    ep: state.ep,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
}

/* ------------------------------------------------------------------ */
/* 攻击检测                                                            */
/* ------------------------------------------------------------------ */

export function findKing(board, color) {
  const king = color === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (board[i] === king) return i;
  return -1;
}

export function isSquareAttacked(board, sq, byColor) {
  const row = rowOf(sq);
  const file = fileOf(sq);

  // 兵：白兵从下方（row + 1）斜向攻击，黑兵从上方（row - 1）斜向攻击
  const pawnRow = byColor === 'w' ? row + 1 : row - 1;
  if (pawnRow >= 0 && pawnRow < 8) {
    const pawn = byColor === 'w' ? 'P' : 'p';
    if (file > 0 && board[pawnRow * 8 + file - 1] === pawn) return true;
    if (file < 7 && board[pawnRow * 8 + file + 1] === pawn) return true;
  }

  // 马
  const knight = byColor === 'w' ? 'N' : 'n';
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const r = row + dr;
    const c = file + dc;
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    if (board[r * 8 + c] === knight) return true;
  }

  // 王
  const king = byColor === 'w' ? 'K' : 'k';
  for (const [dr, dc] of KING_DIRS) {
    const r = row + dr;
    const c = file + dc;
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    if (board[r * 8 + c] === king) return true;
  }

  // 象 / 后（斜线）
  const bishop = byColor === 'w' ? 'B' : 'b';
  const queen = byColor === 'w' ? 'Q' : 'q';
  for (const [dr, dc] of BISHOP_DIRS) {
    let r = row + dr;
    let c = file + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = board[r * 8 + c];
      if (p) {
        if (p === bishop || p === queen) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // 车 / 后（直线）
  const rook = byColor === 'w' ? 'R' : 'r';
  for (const [dr, dc] of ROOK_DIRS) {
    let r = row + dr;
    let c = file + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = board[r * 8 + c];
      if (p) {
        if (p === rook || p === queen) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

export function isInCheck(state, color = state.turn) {
  const king = findKing(state.board, color);
  if (king < 0) return false;
  return isSquareAttacked(state.board, king, opponent(color));
}

/* ------------------------------------------------------------------ */
/* 走法生成                                                            */
/* ------------------------------------------------------------------ */

const CASTLE_RIGHTS = {
  w: { k: { right: 'K', king: 'e1', rook: 'h1', empty: ['f1', 'g1'], path: ['e1', 'f1', 'g1'] },
       q: { right: 'Q', king: 'e1', rook: 'a1', empty: ['b1', 'c1', 'd1'], path: ['e1', 'd1', 'c1'] } },
  b: { k: { right: 'k', king: 'e8', rook: 'h8', empty: ['f8', 'g8'], path: ['e8', 'f8', 'g8'] },
       q: { right: 'q', king: 'e8', rook: 'a8', empty: ['b8', 'c8', 'd8'], path: ['e8', 'd8', 'c8'] } },
};

function pushMove(moves, from, to, piece, extra = {}) {
  moves.push({
    from,
    to,
    piece,
    captured: extra.captured ?? null,
    promotion: extra.promotion ?? null,
    castle: extra.castle ?? null,
    ep: extra.ep ?? false,
    double: extra.double ?? false,
  });
}

/**
 * 生成伪合法走法（不检查己方王是否被将军）。
 */
export function generatePseudoMoves(state, color = state.turn) {
  const { board } = state;
  const moves = [];
  const white = color === 'w';

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const type = typeOf(piece);
    const row = rowOf(from);
    const file = fileOf(from);

    if (type === 'p') {
      const dir = white ? -1 : 1;
      const startRow = white ? 6 : 1;
      const promoRow = white ? 0 : 7;
      const oneR = row + dir;
      if (oneR >= 0 && oneR < 8) {
        const one = oneR * 8 + file;
        if (!board[one]) {
          if (oneR === promoRow) {
            for (const promo of ['q', 'r', 'b', 'n']) pushMove(moves, from, one, piece, { promotion: promo });
          } else {
            pushMove(moves, from, one, piece);
            if (row === startRow) {
              const two = (row + dir * 2) * 8 + file;
              if (!board[two]) pushMove(moves, from, two, piece, { double: true });
            }
          }
        }
        for (const dc of [-1, 1]) {
          const c = file + dc;
          if (c < 0 || c > 7) continue;
          const to = oneR * 8 + c;
          const target = board[to];
          if (target && colorOf(target) !== color) {
            if (oneR === promoRow) {
              for (const promo of ['q', 'r', 'b', 'n']) {
                pushMove(moves, from, to, piece, { promotion: promo, captured: target });
              }
            } else {
              pushMove(moves, from, to, piece, { captured: target });
            }
          } else if (!target && to === state.ep) {
            pushMove(moves, from, to, piece, { captured: white ? 'p' : 'P', ep: true });
          }
        }
      }
      continue;
    }

    if (type === 'n' || type === 'k') {
      const deltas = type === 'n' ? KNIGHT_DELTAS : KING_DIRS;
      for (const [dr, dc] of deltas) {
        const r = row + dr;
        const c = file + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        const to = r * 8 + c;
        const target = board[to];
        if (target && colorOf(target) === color) continue;
        pushMove(moves, from, to, piece, { captured: target || null });
      }
      continue;
    }

    const dirs = type === 'b' ? BISHOP_DIRS : type === 'r' ? ROOK_DIRS : KING_DIRS;
    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = file + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const to = r * 8 + c;
        const target = board[to];
        if (target && colorOf(target) === color) break;
        pushMove(moves, from, to, piece, { captured: target || null });
        if (target) break;
        r += dr;
        c += dc;
      }
    }
  }

  // 王车易位（仅限当前走子方）
  const rights = state.castling || '';
  const home = CASTLE_RIGHTS[color];
  const kingChar = white ? 'K' : 'k';
  if (color === state.turn && board[squareFromName(home.k.king)] === kingChar) {
    for (const side of ['k', 'q']) {
      const cfg = home[side];
      if (!rights.includes(cfg.right)) continue;
      if (board[squareFromName(cfg.rook)] !== (white ? 'R' : 'r')) continue;
      if (cfg.empty.some((s) => board[squareFromName(s)])) continue;
      if (cfg.path.some((s) => isSquareAttacked(board, squareFromName(s), opponent(color)))) continue;
      pushMove(moves, squareFromName(cfg.king), squareFromName(side === 'k' ? 'g' + (white ? '1' : '8') : 'c' + (white ? '1' : '8')), kingChar, { castle: side });
    }
  }

  return moves;
}

export function applyMove(state, move) {
  const board = state.board.slice();
  const piece = board[move.from];
  const color = colorOf(piece);
  const white = color === 'w';
  let castling = state.castling || '';

  board[move.from] = null;

  // 吃过路兵时移除被吃掉的兵
  if (move.ep) {
    board[move.to + (white ? 8 : -8)] = null;
  }

  board[move.to] = move.promotion
    ? (white ? move.promotion.toUpperCase() : move.promotion.toLowerCase())
    : piece;

  // 易位：同步移动车
  if (move.castle) {
    const fromName = squareName(move.from);
    const rank = white ? '1' : '8';
    if (fromName === 'e' + rank) {
      const rookFrom = squareFromName((move.castle === 'k' ? 'h' : 'a') + rank);
      const rookTo = squareFromName((move.castle === 'k' ? 'f' : 'd') + rank);
      board[rookTo] = board[rookFrom];
      board[rookFrom] = null;
    }
  }

  // 更新易位权
  const fromName = squareName(move.from);
  const toName = squareName(move.to);
  const remove = (chars) => {
    for (const ch of chars) castling = castling.replace(ch, '');
  };
  if (typeOf(piece) === 'k') remove(white ? 'KQ' : 'kq');
  if (fromName === 'a1' || toName === 'a1') remove('Q');
  if (fromName === 'h1' || toName === 'h1') remove('K');
  if (fromName === 'a8' || toName === 'a8') remove('q');
  if (fromName === 'h8' || toName === 'h8') remove('k');

  const ep = move.double ? (move.from + move.to) / 2 : -1;
  const resetHalf = typeOf(piece) === 'p' || !!move.captured;
  const halfmove = resetHalf ? 0 : state.halfmove + 1;
  const fullmove = state.fullmove + (color === 'b' ? 1 : 0);

  return {
    board,
    turn: opponent(color),
    castling,
    ep,
    halfmove,
    fullmove,
  };
}

export function generateLegalMoves(state, color = state.turn) {
  const pseudo = generatePseudoMoves(state, color);
  const legal = [];
  for (const move of pseudo) {
    const next = applyMove(state, move);
    const king = findKing(next.board, color);
    if (king < 0) continue;
    if (!isSquareAttacked(next.board, king, opponent(color))) legal.push(move);
  }
  return legal;
}

export function movesFrom(state, sq) {
  return generateLegalMoves(state).filter((m) => m.from === sq);
}

/* ------------------------------------------------------------------ */
/* 局面信息                                                            */
/* ------------------------------------------------------------------ */

export function positionKey(state) {
  return state.board.join('') + state.turn + state.castling + (state.ep >= 0 ? state.ep : '');
}

export function isInsufficientMaterial(state) {
  const pieces = [];
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p) pieces.push({ type: typeOf(p), color: colorOf(p), sq: i });
  }
  const nonKings = pieces.filter((p) => p.type !== 'k');
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1 && ['b', 'n'].includes(nonKings[0].type)) return true;
  if (nonKings.every((p) => p.type === 'b')) {
    // 所有象同色格 → 无法将死
    const colors = new Set(nonKings.map((p) => (rowOf(p.sq) + fileOf(p.sq)) & 1));
    if (colors.size === 1) return true;
  }
  return false;
}

export function getGameStatus(state, repetitionKeys = []) {
  const legal = generateLegalMoves(state);
  const check = isInCheck(state, state.turn);
  if (!legal.length) {
    return check
      ? { over: true, result: opponent(state.turn), reason: 'checkmate', check: true }
      : { over: true, result: 'draw', reason: 'stalemate', check: false };
  }
  if (state.halfmove >= 100) return { over: true, result: 'draw', reason: 'fifty', check };
  if (isInsufficientMaterial(state)) return { over: true, result: 'draw', reason: 'material', check };
  if (repetitionKeys.length) {
    const key = positionKey(state);
    if (repetitionKeys.filter((k) => k === key).length >= 3) {
      return { over: true, result: 'draw', reason: 'repetition', check };
    }
  }
  return { over: false, result: null, reason: null, check };
}

/* ------------------------------------------------------------------ */
/* 记谱                                                                */
/* ------------------------------------------------------------------ */

export function moveToNotation(state, move, status = null) {
  const piece = typeOf(move.piece);
  const color = colorOf(move.piece);
  const file = 'abcdefgh';
  const from = file[fileOf(move.from)] + (8 - rowOf(move.from));
  const to = file[fileOf(move.to)] + (8 - rowOf(move.to));

  let text;
  if (move.castle) {
    text = move.castle === 'k' ? '王 0-0' : '王 0-0-0';
  } else if (piece === 'p') {
    text = `${move.captured ? file[fileOf(move.from)] + '×' : ''}${to}`;
    if (move.promotion) text += `=${PIECE_CN[move.promotion]}`;
  } else {
    text = `${PIECE_CN[piece]} ${from}${move.captured ? '×' : '-'}${to}`;
  }
  if (status?.check) text += status.over ? '#' : '+';
  return { text, color };
}

export function materialCount(state) {
  let white = 0;
  let black = 0;
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  for (const p of state.board) {
    if (!p) continue;
    const v = values[typeOf(p)] || 0;
    if (colorOf(p) === 'w') white += v;
    else black += v;
  }
  return { white, black };
}
