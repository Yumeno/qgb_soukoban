// ゲーム状態機械: 移動・押し・undo・リセット・勝利判定・歩数・リプレイログ (docs/design.md §5)
// DOM 非依存の純粋 ESM。

const DIRS = {
  U: { dx: 0, dy: -1 },
  D: { dx: 0, dy: 1 },
  L: { dx: -1, dy: 0 },
  R: { dx: 1, dy: 0 },
};

function cloneBoard(board) {
  return {
    width: board.width,
    height: board.height,
    walls: new Set(board.walls),
    goals: new Set(board.goals),
    boxes: new Set(board.boxes),
    player: board.player,
  };
}

export class Game {
  /**
   * @param {object} board Board (defensive copy して初期状態として保持)
   */
  constructor(board) {
    this._initial = cloneBoard(board);
    this._width = board.width;
    this._height = board.height;
    this._walls = new Set(board.walls);
    this._goals = new Set(board.goals);
    this._boxes = new Set(board.boxes);
    this._player = board.player;
    this._moves = 0;
    this._log = '';
    this._won = this._checkWon();
    // undo 用の履歴スタック: 各要素は直前状態へ戻すための情報
    this._history = [];
  }

  _checkWon() {
    if (this._boxes.size === 0) return false;
    for (const b of this._boxes) {
      if (!this._goals.has(b)) return false;
    }
    return true;
  }

  /**
   * @param {'U'|'D'|'L'|'R'} dir
   * @returns {{moved:boolean, pushed:boolean, won:boolean}}
   */
  move(dir) {
    if (this._won) {
      return { moved: false, pushed: false, won: true };
    }
    const d = DIRS[dir];
    if (!d) {
      throw new TypeError(`move: 不正な方向 '${dir}'`);
    }

    const width = this._width;
    const px = this._player % width;
    const py = Math.floor(this._player / width);
    const nx = px + d.dx;
    const ny = py + d.dy;

    if (nx < 0 || nx >= width || ny < 0 || ny >= this._height) {
      return { moved: false, pushed: false, won: false };
    }
    const nIdx = ny * width + nx;

    if (this._walls.has(nIdx)) {
      return { moved: false, pushed: false, won: false };
    }

    let pushed = false;
    let boxToIdx = null;

    if (this._boxes.has(nIdx)) {
      // 箱を押す: さらに先のマスが床/ゴールである必要がある
      const bx = nx + d.dx;
      const by = ny + d.dy;
      if (bx < 0 || bx >= width || by < 0 || by >= this._height) {
        return { moved: false, pushed: false, won: false };
      }
      const bIdx = by * width + bx;
      if (this._walls.has(bIdx) || this._boxes.has(bIdx)) {
        return { moved: false, pushed: false, won: false };
      }
      // 押す
      this._boxes.delete(nIdx);
      this._boxes.add(bIdx);
      pushed = true;
      boxToIdx = bIdx;
    }

    // 履歴に記録(undo 用)
    this._history.push({
      player: this._player,
      pushed,
      boxFrom: pushed ? nIdx : null,
      boxTo: boxToIdx,
    });

    this._player = nIdx;
    this._moves += 1;
    this._log += dir;

    const won = this._checkWon();
    this._won = won;

    return { moved: true, pushed, won };
  }

  /**
   * 直前の1歩を巻き戻す。多段可。
   * 勝利後は不発(状態不変)。reset のみ有効 (docs/design.md §5 v0.2)。
   * @returns {boolean} 戻せたか
   */
  undo() {
    if (this._won) {
      return false;
    }
    if (this._history.length === 0) {
      return false;
    }
    const last = this._history.pop();
    if (last.pushed) {
      this._boxes.delete(last.boxTo);
      this._boxes.add(last.boxFrom);
    }
    this._player = last.player;
    this._moves -= 1;
    this._log = this._log.slice(0, -1);
    this._won = this._checkWon();
    return true;
  }

  /**
   * 初期状態へ完全復帰。
   */
  reset() {
    const init = this._initial;
    this._walls = new Set(init.walls);
    this._goals = new Set(init.goals);
    this._boxes = new Set(init.boxes);
    this._player = init.player;
    this._moves = 0;
    this._log = '';
    this._history = [];
    this._won = this._checkWon();
  }

  /**
   * 'UDLR' 列を順に move()。不正文字が含まれたら適用前に TypeError を投げる。
   * @param {string} str
   */
  applyMoves(str) {
    for (const ch of str) {
      if (!DIRS[ch]) {
        throw new TypeError(`applyMoves: 不正な文字 '${ch}' を含む移動列です`);
      }
    }
    for (const ch of str) {
      this.move(ch);
    }
  }

  get moves() {
    return this._moves;
  }

  get log() {
    return this._log;
  }

  get won() {
    return this._won;
  }

  /**
   * 現在の Board のスナップショット(外部から書き換えても内部状態に影響しない)。
   */
  get board() {
    return {
      width: this._width,
      height: this._height,
      walls: new Set(this._walls),
      goals: new Set(this._goals),
      boxes: new Set(this._boxes),
      player: this._player,
    };
  }
}
