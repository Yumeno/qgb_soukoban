// 盤面モデル: テキスト形式のパース/シリアライズ/検証 (docs/design.md §4, §5)
// DOM 非依存の純粋 ESM。

// 使用可能文字: 壁 #, 床 (空白), プレイヤー @, プレイヤーonゴール +, 箱 $, 箱onゴール *, ゴール .
const VALID_CHARS = new Set(['#', ' ', '@', '+', '$', '*', '.']);

/**
 * テキスト → Board。
 * 形式不明文字(VALID_CHARS 以外)のみ即エラーとする。他の妥当性検証は行わない(validateBoard の責務)。
 * @param {string} text
 * @returns {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number|null}}
 */
export function parseBoard(text) {
  const lines = text.split('\n');
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const height = lines.length;

  const walls = new Set();
  const goals = new Set();
  const boxes = new Set();
  let player = null;
  let playerCount = 0;

  for (let y = 0; y < height; y += 1) {
    const line = lines[y];
    for (let x = 0; x < width; x += 1) {
      const ch = x < line.length ? line[x] : ' ';
      if (!VALID_CHARS.has(ch)) {
        throw new Error(`parseBoard: 不正な文字 '${ch}' (行 ${y + 1}, 列 ${x + 1})`);
      }
      const idx = y * width + x;
      switch (ch) {
        case '#':
          walls.add(idx);
          break;
        case '.':
          goals.add(idx);
          break;
        case '$':
          boxes.add(idx);
          break;
        case '*':
          goals.add(idx);
          boxes.add(idx);
          break;
        case '@':
          player = idx;
          playerCount += 1;
          break;
        case '+':
          goals.add(idx);
          player = idx;
          playerCount += 1;
          break;
        case ' ':
        default:
          break;
      }
    }
  }

  // playerCount は複数プレイヤー検知のための内部用付随情報 (validateBoard が参照する)。
  // Board の主要フィールド (width/height/walls/goals/boxes/player) は API 契約通り。
  return { width, height, walls, goals, boxes, player, playerCount };
}

/**
 * Board → テキスト (行末空白なし、LF 区切り)。
 * @param {ReturnType<typeof parseBoard>} board
 * @returns {string}
 */
export function serializeBoard(board) {
  const { width, height, walls, goals, boxes, player } = board;
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    let line = '';
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const isWall = walls.has(idx);
      const isGoal = goals.has(idx);
      const isBox = boxes.has(idx);
      const isPlayer = player === idx;

      let ch;
      if (isWall) {
        ch = '#';
      } else if (isBox && isGoal) {
        ch = '*';
      } else if (isPlayer && isGoal) {
        ch = '+';
      } else if (isBox) {
        ch = '$';
      } else if (isPlayer) {
        ch = '@';
      } else if (isGoal) {
        ch = '.';
      } else {
        ch = ' ';
      }
      line += ch;
    }
    // 行末空白を除去(仕様: 行末空白なし)
    lines.push(line.replace(/ +$/, ''));
  }
  return lines.join('\n');
}

/**
 * Board の妥当性検証。
 * @param {ReturnType<typeof parseBoard>} board
 * @returns {{ok:boolean, errors:Array<{code:string,message:string}>}}
 */
export function validateBoard(board) {
  const { width, height, walls, goals, boxes, player } = board;
  const errors = [];

  // 1. プレイヤーがちょうど1人
  // parseBoard は最後に見つかった '@'/'+' しか player に残せないため、
  // 複数プレイヤーの検知はテキストを再走査して数える。
  // ここでは board オブジェクトのみから判定できるよう、player が null かどうかで no_player を判定し、
  // multiple_players は呼び出し元 (parseBoard 経由) で別途カウントする必要がある。
  // → 仕様上 Board 型に複数プレイヤーの情報を残さないため、validateBoard は
  //   board.playerCount があればそれを使い、なければ player の有無のみで判定する。
  const playerCount = typeof board.playerCount === 'number' ? board.playerCount : (player === null ? 0 : 1);

  if (playerCount === 0) {
    errors.push({ code: 'no_player', message: 'プレイヤーが盤面に存在しません' });
  } else if (playerCount > 1) {
    errors.push({ code: 'multiple_players', message: `プレイヤーが ${playerCount} 人存在します(1人である必要があります)` });
  }

  // 2. 箱の数 == ゴールの数、かつ1個以上
  if (boxes.size === 0) {
    errors.push({ code: 'no_boxes', message: '箱が盤面に存在しません' });
  } else if (boxes.size !== goals.size) {
    errors.push({ code: 'box_goal_mismatch', message: `箱の数 (${boxes.size}) とゴールの数 (${goals.size}) が一致しません` });
  }

  // 3. 全ての箱・ゴール・プレイヤーが壁で囲まれた領域内にある (flood fill で検査)
  const enclosed = checkEnclosed(width, height, walls, goals, boxes, player);
  if (!enclosed) {
    errors.push({ code: 'not_enclosed', message: '盤面が壁で閉じられていません(領域が外周に漏れています)' });
  }

  // 5. 既に全箱がゴール上(開始即クリア)の面は不正
  if (boxes.size > 0 && goals.size > 0) {
    let allOnGoal = true;
    for (const b of boxes) {
      if (!goals.has(b)) {
        allOnGoal = false;
        break;
      }
    }
    if (allOnGoal && boxes.size === goals.size) {
      errors.push({ code: 'already_solved', message: '開始時点で既に全ての箱がゴール上にあります' });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 壁で囲まれた領域内にプレイヤー・箱・ゴールが収まっているかを flood fill で検査する。
 * プレイヤー位置から到達可能な床マス(壁でないマス)を探索し、
 * その探索が盤面外周(壁の外側)に漏れ出さないかを確認する。
 * 具体的には: 壁でないマスからなる連結領域が、盤面の境界(x=0,x=width-1,y=0,y=height-1)に
 * 壁を挟まず到達してしまう(=壁で囲われていない)場合を not_enclosed とする。
 */
function checkEnclosed(width, height, walls, goals, boxes, player) {
  if (player === null || player === undefined) {
    // プレイヤーがいない場合は起点が取れないため、箱やゴールを起点にする。
    const seedCandidates = [...boxes, ...goals];
    if (seedCandidates.length === 0) {
      return true; // 検証対象がなければ enclosed 扱い(他のエラーで既に不合格になる)
    }
    return floodFromSeeds(width, height, walls, seedCandidates);
  }
  return floodFromSeeds(width, height, walls, [player]);
}

function floodFromSeeds(width, height, walls, seeds) {
  const visited = new Set();
  const stack = [...seeds];
  let leaked = false;

  while (stack.length > 0) {
    const idx = stack.pop();
    if (visited.has(idx)) continue;
    const x = idx % width;
    const y = Math.floor(idx / width);

    if (x < 0 || x >= width || y < 0 || y >= height) {
      leaked = true;
      continue;
    }
    if (walls.has(idx)) continue;
    visited.add(idx);

    // 盤面の境界マスに達し、かつそこが壁でない場合は外部へ漏れているとみなす
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      leaked = true;
    }

    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 },
    ];
    for (const { nx, ny } of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        leaked = true;
        continue;
      }
      const nIdx = ny * width + nx;
      if (!visited.has(nIdx) && !walls.has(nIdx)) {
        stack.push(nIdx);
      }
    }
  }

  return !leaked;
}
