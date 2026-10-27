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

  /**
   * 함대를 무작위로 배치한다.
   * 큰 함선부터 "가능한 모든 위치"를 구해 섞은 뒤 하나씩 시도하고,
   * 뒤의 함선을 놓을 수 없으면 되돌아가(백트래킹) 다른 위치를 시도한다.
   * 후보가 유한하므로 무한 반복 없이 반드시 끝나며, 해가 있으면 반드시 찾는다.
   */
  function placeFleet(rng) {
    const owner = new Array(SIZE * SIZE).fill(-1);
    const ships = [];

    // 비어 있고, 8방향 이웃에도 다른 함선이 없어야 놓을 수 있다.
    const free = (i) => owner[i] === -1 && neighbors8(i).every((n) => owner[n] === -1);

    function options(len) {
      const out = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (c + len <= SIZE) {
            const cells = Array.from({ length: len }, (_, k) => toIndex(r, c + k));
            if (cells.every(free)) out.push({ dir: 'H', cells });
          }
          if (len > 1 && r + len <= SIZE) {
            const cells = Array.from({ length: len }, (_, k) => toIndex(r + k, c));
            if (cells.every(free)) out.push({ dir: 'V', cells });
          }
        }
      }
      return out;
    }

    function place(k) {
      if (k === FLEET.length) return true;
      for (const opt of shuffle(options(FLEET[k]), rng)) {
        opt.cells.forEach((i) => (owner[i] = k));
        ships.push({ id: k, length: FLEET[k], dir: opt.dir, cells: opt.cells });
        if (place(k + 1)) return true;
        ships.pop();
        opt.cells.forEach((i) => (owner[i] = -1));
      }
      return false;
    }

    if (!place(0)) throw new Error('함대를 배치할 수 없습니다.');
    return ships;
  }

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
   * remaining: 아직 격침되지 않은 함선 길이 목록 (함대 구성은 공개 정보)
   */
  function publicView(board) {
    const cells = board.cells.map((c) => {
      if (c.revealed) return 'safe';
      if (!c.attacked) return 'unknown';
      if (c.result === 'miss') return 'miss';
      return board.ships[c.shipId].sunk ? 'sunk' : 'hit';
    });
    const remaining = FLEET.slice();
    board.ships.filter((s) => s.sunk).forEach((s) => remaining.splice(remaining.indexOf(s.length), 1));
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
     * @param {Array} [opts.playerShips] 테스트용 고정 배치
     * @param {Array} [opts.cpuShips] 테스트용 고정 배치
     */
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.player = createSide(opts.playerShips || placeFleet(this.rng));
      this.cpu = createSide(opts.cpuShips || placeFleet(this.rng));
      this.state = STATE.READY;
      this.turn = 'player';
      this.winner = null;
      this.pendingState = null;
    }

    other(key) { return key === 'player' ? 'cpu' : 'player'; }
    targetBoard(attacker) { return this[this.other(attacker)].board; }

    /** 시작 전에만 플레이어 함대를 다시 무작위 배치할 수 있다. */
    rerollPlayerFleet() {
      if (this.state !== STATE.READY) return false;
      this.player = createSide(placeFleet(this.rng));
      return true;
    }

    /** 플레이어 선공으로 시작 */
    start() {
      if (this.state !== STATE.READY) return false;
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
    mulberry32, shuffle, placeFleet, createBoard, isOpen, attackCell, allSunk, publicView,
    Game,
  };
})(typeof window !== 'undefined' ? window : globalThis);
