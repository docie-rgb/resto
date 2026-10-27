/*
 * 게임 시작 전 함대 구성과 배치 (DOM 없음)
 * - 배 종류별 수량 설정: 전체 1척 이상, 규칙상 배치할 수 없는 수량으로는 늘릴 수 없음
 * - 배치: 끌어서 이동, 클릭으로 가로/세로 전환, 무작위 배치
 * - 겹치거나 닿는 배는 가장 가까운 빈자리로 밀어내고, 자리가 없으면 항구로 보낸다.
 * - 항구: 아직 격자에 놓이지 않은 배를 임시로 두는 곳
 * 전역 객체 window.BattleshipSetup 으로 공개한다.
 */
(function (global) {
  'use strict';

  const B = global.Battleship;
  const { SIZE, toIndex, rowOf, colOf } = B;

  const TYPES = [5, 4, 3, 2];

  /** (r, c)에서 시작하는 길이 len 함선. 격자 밖으로 나가면 안쪽으로 밀어 넣는다. */
  function cellsAt(len, r, c, dir) {
    const maxR = dir === 'V' ? SIZE - len : SIZE - 1;
    const maxC = dir === 'H' ? SIZE - len : SIZE - 1;
    r = Math.max(0, Math.min(maxR, r));
    c = Math.max(0, Math.min(maxC, c));
    return Array.from({ length: len }, (_, k) => (dir === 'H' ? toIndex(r, c + k) : toIndex(r + k, c)));
  }

  class FleetSetup {
    /**
     * @param {number[]} fleet 처음 함대 구성 (길이 목록)
     * @param {function} rng 난수 함수
     */
    constructor(fleet, rng = Math.random) {
      this.rng = rng;
      this.ships = []; // { id, length, dir, cells(null이면 항구) }
      this.nextId = 0;
      fleet.slice().sort((a, b) => b - a).forEach((len) => this._add(len));
    }

    _add(length) {
      const ship = { id: this.nextId++, length, dir: 'H', cells: null };
      this.ships.push(ship);
      return ship;
    }

    ship(id) { return this.ships.find((s) => s.id === id) || null; }
    fleet() { return this.ships.map((s) => s.length); }
    count(length) { return this.ships.filter((s) => s.length === length).length; }
    harborCount(length) { return this.ships.filter((s) => s.length === length && !s.cells).length; }
    harborShip(length) { return this.ships.find((s) => s.length === length && !s.cells) || null; }
    allPlaced() { return this.ships.length > 0 && this.ships.every((s) => s.cells); }

    /** 게임에 넘길 배치 (항구에 있는 배 제외). tag 로 배치 화면의 id 를 함께 넘긴다. */
    placedShips() {
      return this.ships.filter((s) => s.cells).map((s) => ({ length: s.length, dir: s.dir, cells: s.cells.slice(), tag: s.id }));
    }

    /** 칸 i 에 있는 배 id (없으면 null) */
    shipAt(i) {
      const s = this.ships.find((x) => x.cells && x.cells.includes(i));
      return s ? s.id : null;
    }

    // ---------- 수량 ----------

    /** 수량을 delta 만큼 바꿀 수 있는지: 전체 1척 이상, 늘릴 때는 규칙상 배치 가능해야 함 */
    canChange(length, delta) {
      const n = this.count(length) + delta;
      if (n < 0) return false;
      if (delta < 0) return this.ships.length + delta >= 1;
      const fleet = this.fleet();
      for (let k = 0; k < delta; k++) fleet.push(length);
      return B.canPlaceFleet(fleet);
    }

    /** 1척 늘리면 항구에 추가, 줄이면 항구에 있는 배부터 뺀다. */
    change(length, delta) {
      if (!this.canChange(length, delta)) return false;
      if (delta > 0) {
        for (let k = 0; k < delta; k++) this._add(length);
      } else {
        for (let k = 0; k < -delta; k++) {
          const same = this.ships.filter((s) => s.length === length);
          const victim = same.find((s) => !s.cells) || same[same.length - 1];
          this.ships.splice(this.ships.indexOf(victim), 1);
        }
      }
      return true;
    }

    // ---------- 배치 ----------

    /** 모든 배를 무작위로 배치 */
    randomize() {
      const placed = B.placeFleet(this.rng, this.fleet());
      const pool = this.ships.slice();
      placed.forEach((p) => {
        const s = pool.splice(pool.findIndex((x) => x.length === p.length), 1)[0];
        s.dir = p.dir;
        s.cells = p.cells.slice();
      });
    }

    /** 모든 배를 항구로 */
    clear() { this.ships.forEach((s) => (s.cells = null)); }

    toHarbor(id) {
      const s = this.ship(id);
      if (s) s.cells = null;
    }

    /** cells 와 겹치거나 상하좌우·대각선으로 닿는 (exceptId 를 뺀) 배 id 목록 */
    conflicts(cells, exceptId) {
      const zone = new Set();
      cells.forEach((i) => { zone.add(i); B.neighbors8(i).forEach((n) => zone.add(n)); });
      return this.ships
        .filter((s) => s.id !== exceptId && s.cells && s.cells.some((i) => zone.has(i)))
        .map((s) => s.id);
    }

    /** 끌어다 놓기 미리보기: 놓일 칸과 밀려날 배 */
    preview(id, r, c, dir) {
      const s = this.ship(id);
      const cells = cellsAt(s.length, r, c, dir);
      return { cells, conflicts: this.conflicts(cells, id) };
    }

    /**
     * 배를 (r, c)에서 시작하도록 놓는다. (격자 밖이면 안쪽으로 맞춤)
     * 겹치거나 닿는 배는 원래 자리에서 가장 가까운 빈자리로 밀어내고, 빈자리가 없으면 항구로 보낸다.
     * @returns {{moved:number[], harbored:number[]}}
     */
    place(id, r, c, dir) {
      const s = this.ship(id);
      const cells = cellsAt(s.length, r, c, dir);
      const pushed = this.conflicts(cells, id)
        .map((x) => this.ship(x))
        .sort((a, b) => b.length - a.length);
      s.dir = dir;
      s.cells = cells;

      const moved = [], harbored = [];
      pushed.forEach((p) => {
        const from = p.cells[0];
        p.cells = null;
        const spot = this.nearestFree(p.length, from, p.dir);
        if (spot) { p.cells = spot.cells; p.dir = spot.dir; moved.push(p.id); } else harbored.push(p.id);
      });
      return { moved, harbored };
    }

    /** 클릭: 첫 칸을 기준으로 가로 ↔ 세로 전환 */
    rotate(id) {
      const s = this.ship(id);
      if (!s || !s.cells) return null;
      return this.place(id, rowOf(s.cells[0]), colOf(s.cells[0]), s.dir === 'H' ? 'V' : 'H');
    }

    /** 다른 배와 겹치거나 닿지 않는 위치 중 from 에서 가장 가까운 곳 (방향이 바뀌면 약간 불리하게) */
    nearestFree(length, from, dir) {
      let best = null, bestScore = Infinity;
      B.positions(length).forEach((p) => {
        if (this.conflicts(p.cells, -1).length) return;
        const score = Math.abs(rowOf(p.cells[0]) - rowOf(from)) + Math.abs(colOf(p.cells[0]) - colOf(from)) +
          (p.dir === dir || length === 1 ? 0 : 0.5);
        if (score < bestScore) { bestScore = score; best = p; }
      });
      return best && { dir: best.dir, cells: best.cells.slice() };
    }
  }

  global.BattleshipSetup = { FleetSetup, TYPES, cellsAt };
})(window);
