/*
 * 배틀쉽 게임 로직
 * DOM을 사용하지 않는 순수 로직만 담는다. (UI는 ui.js, CPU 전략은 ai.js)
 * 전역 객체 window.Battleship 으로 공개한다.
 */
(function (global) {
  'use strict';

  const SIZE = 10;
  const FLEET = [5, 4, 4, 3, 3, 3, 2, 2, 2, 2]; // 10척, 30칸
  const NUKE_EVERY = 5; // 자기 턴이 5번 시작될 때마다 핵폭탄 1개 (명중으로 이어지는 연속 공격은 같은 턴)
  const NUKE_MAX = 1;   // 진영별 최대 보유량

  const STATE = Object.freeze({
    READY: 'READY',
    PLAYER_TURN: 'PLAYER_TURN',
    PLAYER_NUKE_TARGETING: 'PLAYER_NUKE_TARGETING',
    CPU_TURN: 'CPU_TURN',
    RESOLVING_ATTACK: 'RESOLVING_ATTACK',
    GAME_OVER: 'GAME_OVER',
  });

  // ---------- 좌표 유틸 ----------

  const toIndex = (r, c) => r * SIZE + c;
  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  /** "A1" 형태의 좌표 이름 (열 A~J, 행 1~10) */
  function coordName(i) {
    return String.fromCharCode(65 + colOf(i)) + (rowOf(i) + 1);
  }

  /** i 를 둘러싼 최대 8칸 (격자 밖은 제외) */
  function neighbors8(i) {
    const r = rowOf(i), c = colOf(i), out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((dr || dc) && inBounds(r + dr, c + dc)) out.push(toIndex(r + dr, c + dc));
      }
    }
    return out;
  }

  /** i 를 중심으로 한 3×3 범위 (격자 밖은 무시) */
  function area3x3(i) {
    return [i].concat(neighbors8(i)).sort((a, b) => a - b);
  }

  // ---------- 난수 ----------

  /** 시드 고정 난수 (테스트 재현용) */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- 함선 배치 ----------

  /** 길이 len 함선이 격자 안에 놓일 수 있는 모든 위치 (행 우선, 가로 먼저) */
  const positionCache = new Map();
  function positions(len) {
    if (!positionCache.has(len)) {
      const out = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (c + len <= SIZE) out.push({ dir: 'H', cells: Array.from({ length: len }, (_, k) => toIndex(r, c + k)) });
          if (len > 1 && r + len <= SIZE) out.push({ dir: 'V', cells: Array.from({ length: len }, (_, k) => toIndex(r + k, c)) });
        }
      }
      positionCache.set(len, out);
    }
    return positionCache.get(len);
  }

  /** 8방향 이웃 표 (배치 탐색에서 반복 호출되므로 미리 계산) */
  const NEIGHBORS = Array.from({ length: SIZE * SIZE }, (_, i) => neighbors8(i));

  /**
   * 함대 배치를 탐색한다. (백트래킹)
   * 큰 함선부터, 다른 함선과 겹치거나 상하좌우·대각선으로 닿지 않는 위치를 골라 놓고,
   * 뒤의 함선을 놓을 수 없으면 되돌아가 다른 위치를 시도한다.
   * 같은 길이의 함선은 위치 번호가 증가하는 순서로만 놓아 같은 배치를 중복 탐색하지 않는다.
   * 탐색 노드 수가 budget 을 넘으면 포기(null)하므로 시간이 무한히 걸리지 않는다.
   *
   * @param {number[]} fleet 함선 길이 목록
   * @param {'scan'|'transpose'|'random'} order 위치 시도 순서
   */
  function searchPlacement(fleet, order, rng, budget) {
    const lens = fleet.slice().sort((a, b) => b - a);
    const block = new Int16Array(SIZE * SIZE); // 0보다 크면 함선을 놓을 수 없는 칸 (점유 또는 인접)
    const lists = new Map();
    lens.forEach((len) => {
      if (lists.has(len)) return;
      let list = positions(len).slice();
      if (order === 'transpose') list.sort((a, b) => colOf(a.cells[0]) - colOf(b.cells[0]) || rowOf(a.cells[0]) - rowOf(b.cells[0]) || (a.dir === 'V' ? -1 : 1));
      if (order === 'random') shuffle(list, rng);
      lists.set(len, list);
    });

    const mark = (cells, d) => cells.forEach((i) => {
      block[i] += d;
      NEIGHBORS[i].forEach((n) => (block[n] += d));
    });
    const chosen = [];
    let nodes = 0;

    function rec(k, from) {
      if (k === lens.length) return true;
      if (++nodes > budget) return false;
      const list = lists.get(lens[k]);
      for (let p = from; p < list.length; p++) {
        const cells = list[p].cells;
        if (!cells.every((i) => block[i] === 0)) continue;
        mark(cells, 1);
        chosen.push(list[p]);
        const nextFrom = k + 1 < lens.length && lens[k + 1] === lens[k] ? p + 1 : 0;
        if (rec(k + 1, nextFrom)) return true;
        chosen.pop();
        mark(cells, -1);
        if (nodes > budget) return false;
      }
      return false;
    }

    if (!rec(0, 0)) return null;
    return chosen.map((p, id) => ({ id, length: p.cells.length, dir: p.dir, cells: p.cells.slice() }));
  }

  /**
   * 규칙(겹침·인접 금지)을 지키며 함대를 배치할 수 있는지 판정한다. 결과는 캐시한다.
   * 촘촘한 배치를 잘 찾는 두 가지 순차 탐색 후 무작위 탐색을 몇 번 더 시도하며,
   * 정해진 탐색량 안에 배치를 찾지 못하면 "불가"로 본다. (수량 상한이 실제보다 약간 보수적일 수 있음)
   * 가능하면 찾아낸 배치 하나를 돌려준다.
   */
  const feasibleCache = new Map();
  function findAnyPlacement(fleet) {
    const key = fleet.slice().sort((a, b) => b - a).join(',');
    if (feasibleCache.has(key)) return feasibleCache.get(key);
    let found = null;
    if (fleet.every((len) => len >= 1 && len <= SIZE)) {
      // 금지 구역까지 포함하면 함선은 11×11 판에 (길이+1)×2 넓이를 차지한다.
      const padded = fleet.reduce((sum, len) => sum + (len + 1) * 2, 0);
      if (padded <= (SIZE + 1) * (SIZE + 1)) {
        found = searchPlacement(fleet, 'scan', null, 20000) || searchPlacement(fleet, 'transpose', null, 20000);
        const rng = mulberry32(fleet.length * 7919 + padded);
        for (let t = 0; !found && t < 6; t++) found = searchPlacement(fleet, 'random', rng, 5000);
      }
    }
    feasibleCache.set(key, found);
    return found;
  }

  function canPlaceFleet(fleet) {
    return findAnyPlacement(fleet) !== null;
  }

  /** 배치 전체를 뒤집거나 돌려 새 배치를 만든다. (8가지 대칭) */
  function transformShips(ships, t) {
    const map = (i) => {
      let r = rowOf(i), c = colOf(i);
      if (t & 1) c = SIZE - 1 - c;
      if (t & 2) r = SIZE - 1 - r;
      if (t & 4) [r, c] = [c, r];
      return toIndex(r, c);
    };
    return ships.map((s) => {
      const cells = s.cells.map(map).sort((a, b) => a - b);
      const dir = s.length > 1 && rowOf(cells[0]) === rowOf(cells[1]) ? 'H' : (s.length > 1 ? 'V' : s.dir);
      return { id: s.id, length: s.length, dir, cells };
    });
  }

  /**
   * 함대를 무작위로 배치한다.
   * 무작위 탐색을 여러 번 시도하고, 아주 촘촘한 함대라 실패하면
   * 미리 찾아 둔 배치를 무작위로 뒤집고 돌려서 사용한다. 배치 불가능한 함대면 예외.
   */
  function placeFleet(rng, fleet = FLEET) {
    for (let t = 0; t < 30; t++) {
      const ships = searchPlacement(fleet, 'random', rng, 3000);
      if (ships) return ships;
    }
    const known = findAnyPlacement(fleet);
    if (!known) throw new Error('함대를 배치할 수 없습니다.');
    return transformShips(known, Math.floor(rng() * 8));
  }

  /** 함선 목록이 규칙(직선, 격자 내부, 겹침·인접 없음)을 지키는지 검사 */
  function validateShips(ships) {
    const owner = new Array(SIZE * SIZE).fill(-1);
    for (let k = 0; k < ships.length; k++) {
      const s = ships[k];
      if (!s.cells || s.cells.length !== s.length || !s.length) return false;
      for (let j = 0; j < s.cells.length; j++) {
        const i = s.cells[j];
        if (!(i >= 0 && i < SIZE * SIZE) || owner[i] !== -1) return false;
        const expected = s.dir === 'V' ? s.cells[0] + j * SIZE : s.cells[0] + j;
        if (i !== expected || (s.dir !== 'V' && rowOf(i) !== rowOf(s.cells[0]))) return false;
        owner[i] = k;
      }
    }
    return ships.every((s, k) => s.cells.every((i) => NEIGHBORS[i].every((n) => owner[n] === -1 || owner[n] === k)));
  }

  /** 함선 길이 목록이 같은 구성인지 (순서 무관) */
  const sameFleet = (a, b) => a.slice().sort().join() === b.slice().sort().join();

  // ---------- 격자 ----------

  function createBoard(ships) {
    const cells = Array.from({ length: SIZE * SIZE }, (_, i) => ({
      index: i,
      shipId: -1,
      attacked: false,
      result: null,    // 'hit' | 'miss'
      revealed: false, // 격침 주변 자동 확인된 바다 (포격으로 계산하지 않음)
    }));
    const copy = ships.map((s, id) => ({
      id, length: s.length, dir: s.dir, cells: s.cells.slice(), hits: [], sunk: false,
      tag: s.tag, // 배치 화면에서 쓰는 식별자 (게임 규칙에는 사용하지 않음)
    }));
    copy.forEach((s) => s.cells.forEach((i) => (cells[i].shipId = s.id)));
    return { cells, ships: copy };
  }

  /** 아직 공격하지 않았고 자동 확인된 바다도 아닌 칸만 포격할 수 있다. */
  function isOpen(board, i) {
    const c = board.cells[i];
    return !!c && !c.attacked && !c.revealed;
  }

  /** 한 칸을 포격한다. 호출 전에 isOpen 을 확인해야 한다. */
  function attackCell(board, i) {
    const cell = board.cells[i];
    cell.attacked = true;
    if (cell.shipId < 0) {
      cell.result = 'miss';
      return { index: i, result: 'miss', sunk: null };
    }
    cell.result = 'hit';
    const ship = board.ships[cell.shipId];
    ship.hits.push(i);
    // 모든 칸이 명중했을 때 한 번만 격침 처리
    if (!ship.sunk && ship.hits.length === ship.length) {
      ship.sunk = true;
      revealAround(board, ship);
      return { index: i, result: 'hit', sunk: ship };
    }
    return { index: i, result: 'hit', sunk: null };
  }

  /** 격침된 함선 주변 1칸은 다른 함선이 있을 수 없으므로 확인된 바다로 표시한다. */
  function revealAround(board, ship) {
    ship.cells.forEach((i) => {
      neighbors8(i).forEach((n) => {
        const c = board.cells[n];
        if (!c.attacked && c.shipId < 0) c.revealed = true;
      });
    });
  }

  const allSunk = (board) => board.ships.every((s) => s.sunk);

  /**
   * 공격자 입장에서 알 수 있는 정보만 담은 격자 상태.
   * CPU 전략은 이 값만 사용한다. (숨겨진 함선 위치는 포함하지 않음)
   * cells[i]: 'unknown' | 'miss' | 'hit'(미격침 함선) | 'sunk' | 'safe'(확인된 바다)
   * remaining: 아직 격침되지 않은 함선 길이 목록 (함대 구성은 공개 정보, 위치는 포함하지 않음)
   */
  function publicView(board) {
    const cells = board.cells.map((c) => {
      if (c.revealed) return 'safe';
      if (!c.attacked) return 'unknown';
      if (c.result === 'miss') return 'miss';
      return board.ships[c.shipId].sunk ? 'sunk' : 'hit';
    });
    const remaining = board.ships.filter((s) => !s.sunk).map((s) => s.length);
    return { cells, remaining };
  }

  // ---------- 게임 진행 ----------

  function createSide(ships) {
    return {
      board: createBoard(ships), // 이 진영의 함대 (상대가 공격하는 격자)
      shots: 0,       // 총 일반 포격 횟수
      nukeCounter: 0, // 핵폭탄 획득 카운트 (시작한 턴 수, 0~4)
      nukes: 0,       // 핵폭탄 보유량 (0~1)
      nukesUsed: 0,
      hits: [],       // 이 진영이 명중시킨 좌표
      misses: [],     // 이 진영이 빗나간 좌표
    };
  }

  class Game {
    /**
     * @param {object} [opts]
     * @param {function} [opts.rng] 난수 함수 (기본 Math.random)
     * @param {number[]} [opts.fleet] 함대 구성 (함선 길이 목록, 기본 FLEET)
     * @param {Array} [opts.playerShips] 플레이어 배치 (없으면 무작위)
     * @param {Array} [opts.cpuShips] 테스트용 고정 배치
     */
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.fleet = (opts.fleet || FLEET).slice();
      this.player = createSide(opts.playerShips || placeFleet(this.rng, this.fleet));
      this.cpu = createSide(opts.cpuShips || placeFleet(this.rng, this.fleet));
      this.state = STATE.READY;
      this.turn = 'player';
      this.winner = null;
      this.pendingState = null;
    }

    other(key) { return key === 'player' ? 'cpu' : 'player'; }
    targetBoard(attacker) { return this[this.other(attacker)].board; }

    /** 시작 전에만 함대 구성을 바꿀 수 있다. CPU 함대는 같은 구성으로 새로 배치한다. */
    setFleet(fleet) {
      if (this.state !== STATE.READY || !fleet.length || !canPlaceFleet(fleet)) return false;
      this.fleet = fleet.slice();
      this.cpu = createSide(placeFleet(this.rng, this.fleet));
      return true;
    }

    /** 시작 전 플레이어 배치 반영. 배치 중에는 일부(항구에 남은 배 제외)만 있어도 된다. */
    setPlayerShips(ships) {
      if (this.state !== STATE.READY) return false;
      this.player = createSide(ships);
      return true;
    }

    /** 시작 전에만 플레이어 함대를 다시 무작위 배치할 수 있다. */
    rerollPlayerFleet() {
      if (this.state !== STATE.READY) return false;
      this.player = createSide(placeFleet(this.rng, this.fleet));
      return true;
    }

    /** 플레이어의 배치가 함대 구성과 같고 규칙에 맞아야 시작할 수 있다. */
    canStart() {
      const ships = this.player.board.ships;
      return this.state === STATE.READY &&
        sameFleet(ships.map((s) => s.length), this.fleet) && validateShips(ships);
    }

    /** 플레이어 선공으로 시작 */
    start() {
      if (!this.canStart()) return false;
      this.turn = 'player';
      this.state = STATE.PLAYER_TURN;
      this._beginTurn(this.player); // 첫 턴도 게이지에 포함
      return true;
    }

    canPlayerFire(i) {
      return this.state === STATE.PLAYER_TURN && isOpen(this.cpu.board, i);
    }

    /**
     * 일반 포격. 허용되지 않는 상태이거나 이미 공격한 칸이면 null.
     * 성공하면 RESOLVING_ATTACK(또는 GAME_OVER)으로 바뀌며, UI가 연출 후 finishResolve()를 호출한다.
     */
    fire(attacker, i) {
      const allowed = attacker === 'player' ? STATE.PLAYER_TURN : STATE.CPU_TURN;
      if (this.state !== allowed) return null;
      const board = this.targetBoard(attacker);
      if (!isOpen(board, i)) return null;

      const side = this[attacker];
      const r = attackCell(board, i);
      side.shots++;
      (r.result === 'hit' ? side.hits : side.misses).push(i);

      return this._afterAttack(attacker, {
        kind: 'shot', attacker, index: i, results: [r],
        hit: r.result === 'hit', sunk: r.sunk ? [r.sunk] : [],
      });
    }

    /**
     * 턴이 시작될 때 게이지를 1 올리고, 5번째면 핵폭탄 지급 (최대 1개).
     * 명중으로 이어지는 추가 공격은 같은 턴이므로 게이지가 오르지 않는다.
     */
    _beginTurn(side) {
      side.nukeCounter++;
      if (side.nukeCounter < NUKE_EVERY) return false;
      side.nukeCounter = 0;
      if (side.nukes >= NUKE_MAX) return false;
      side.nukes++;
      return true;
    }

    enterNukeTargeting() {
      if (this.state !== STATE.PLAYER_TURN || this.player.nukes < 1) return false;
      this.state = STATE.PLAYER_NUKE_TARGETING;
      return true;
    }

    cancelNuke() {
      if (this.state !== STATE.PLAYER_NUKE_TARGETING) return false;
      this.state = STATE.PLAYER_TURN;
      return true;
    }

    /** 3×3 범위 중 새로 공격할 수 있는 칸 */
    nukeTargets(attacker, center) {
      const board = this.targetBoard(attacker);
      return area3x3(center).filter((i) => isOpen(board, i));
    }

    /**
     * 핵폭탄 공격. 새로 공격할 칸이 없으면 사용할 수 없다(null, 보유량 유지).
     * 새 명중이 하나라도 있으면 추가 공격권은 한 번만 부여한다.
     */
    nuke(attacker, center) {
      const allowed = attacker === 'player' ? STATE.PLAYER_NUKE_TARGETING : STATE.CPU_TURN;
      const side = this[attacker];
      if (this.state !== allowed || side.nukes < 1) return null;
      if (center < 0 || center >= SIZE * SIZE) return null;
      const targets = this.nukeTargets(attacker, center);
      if (!targets.length) return null;

      side.nukes--;
      side.nukesUsed++;
      const board = this.targetBoard(attacker);
      const results = [];
      for (const i of targets) {
        // 같은 폭발 안에서 앞 칸의 격침으로 주변이 확인된 바다가 됐다면 건너뛴다.
        if (!isOpen(board, i)) continue;
        const r = attackCell(board, i);
        (r.result === 'hit' ? side.hits : side.misses).push(i);
        results.push(r);
      }
      return this._afterAttack(attacker, {
        kind: 'nuke', attacker, index: center, area: area3x3(center), results,
        hit: results.some((r) => r.result === 'hit'),
        sunk: results.filter((r) => r.sunk).map((r) => r.sunk),
      });
    }

    /** 공격 결과에 따라 승패 또는 다음 공격권을 정한다. */
    _afterAttack(attacker, outcome) {
      if (allSunk(this.targetBoard(attacker))) {
        this.state = STATE.GAME_OVER;
        this.winner = attacker;
        this.pendingState = null;
        outcome.gameOver = true;
        outcome.next = null;
        return outcome;
      }
      this.turn = outcome.hit ? attacker : this.other(attacker);
      this.state = STATE.RESOLVING_ATTACK;
      this.pendingState = this.turn === 'player' ? STATE.PLAYER_TURN : STATE.CPU_TURN;
      // 공격권이 상대에게 넘어갈 때만 상대의 새 턴이 시작된다.
      const switched = this.turn !== attacker;
      outcome.nukeGainedBy = switched && this._beginTurn(this[this.turn]) ? this.turn : null;
      outcome.gameOver = false;
      outcome.next = this.turn;
      return outcome;
    }

    /** 연출이 끝난 뒤 다음 진영의 차례로 넘긴다. */
    finishResolve() {
      if (this.state !== STATE.RESOLVING_ATTACK) return false;
      this.state = this.pendingState;
      this.pendingState = null;
      return true;
    }

    remainingShips(key) {
      return this[key].board.ships.filter((s) => !s.sunk).length;
    }
  }

  global.Battleship = {
    SIZE, FLEET, NUKE_EVERY, NUKE_MAX, STATE,
    toIndex, rowOf, colOf, inBounds, coordName, neighbors8, area3x3,
    mulberry32, shuffle, positions, placeFleet, canPlaceFleet, validateShips, sameFleet, createBoard, isOpen, attackCell, allSunk, publicView,
    Game,
  };
})(typeof window !== 'undefined' ? window : globalThis);
