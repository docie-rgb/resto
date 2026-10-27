/*
 * CPU 공격 전략
 * Battleship.publicView() 가 만든 "공개 정보"만 입력으로 받는다.
 * 숨겨진 함선 위치(board.ships, cells[].shipId)는 절대 참조하지 않는다.
 *
 * view.cells[i]: 'unknown' | 'miss' | 'hit' | 'sunk' | 'safe'
 * view.remaining: 아직 격침되지 않은 함선 길이 목록
 */
(function (global) {
  'use strict';

  const B = global.Battleship;
  const { SIZE, toIndex, rowOf, colOf, inBounds } = B;

  function orthNeighbors(i) {
    const r = rowOf(i), c = colOf(i);
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([y, x]) => inBounds(y, x))
      .map(([y, x]) => toIndex(y, x));
  }

  function diagNeighbors(i) {
    const r = rowOf(i), c = colOf(i);
    return [[r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]]
      .filter(([y, x]) => inBounds(y, x))
      .map(([y, x]) => toIndex(y, x));
  }

  /**
   * 함선끼리는 대각선으로도 붙을 수 없으므로,
   * 명중 칸의 대각선 칸에는 함선이 없다고 추론해 'safe'로 취급한다.
   */
  function deduce(cells) {
    const out = cells.slice();
    cells.forEach((s, i) => {
      if (s !== 'hit') return;
      diagNeighbors(i).forEach((n) => { if (out[n] === 'unknown') out[n] = 'safe'; });
    });
    return out;
  }

  /** 상하좌우로 이어진 미격침 명중 칸 묶음. 함선끼리 붙지 않으므로 한 묶음 = 한 함선. */
  function hitClusters(cells) {
    const seen = new Set(), out = [];
    cells.forEach((s, i) => {
      if (s !== 'hit' || seen.has(i)) return;
      const group = [], stack = [i];
      seen.add(i);
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        orthNeighbors(cur).forEach((n) => {
          if (cells[n] === 'hit' && !seen.has(n)) { seen.add(n); stack.push(n); }
        });
      }
      out.push(group.sort((a, b) => a - b));
    });
    return out;
  }

  /** 길이 len 함선이 격자 안에 놓일 수 있는 모든 직선 위치를 순회 */
  function forEachPlacement(len, fn) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (c + len <= SIZE) fn(Array.from({ length: len }, (_, k) => toIndex(r, c + k)));
        if (len > 1 && r + len <= SIZE) fn(Array.from({ length: len }, (_, k) => toIndex(r + k, c)));
      }
    }
  }

  /**
   * 탐색용 확률 지도: 남은 함선들이 미확인 칸에만 놓일 수 있는 경우의 수를 칸마다 센다.
   * 값이 클수록 함선이 있을 가능성이 높다. (체커보드보다 효율적인 탐색)
   */
  function searchDensity(cells, remaining) {
    const d = new Array(SIZE * SIZE).fill(0);
    remaining.forEach((len) => {
      forEachPlacement(len, (pc) => {
        if (pc.every((i) => cells[i] === 'unknown')) pc.forEach((i) => d[i]++);
      });
    });
    return d;
  }

  /**
   * 추적 후보: 명중 1칸이면 상하좌우, 2칸 이상이면 방향을 추정해 양 끝의 연장선.
   */
  function targetCandidates(cells, cluster) {
    if (cluster.length === 1) {
      return orthNeighbors(cluster[0]).filter((n) => cells[n] === 'unknown');
    }
    const horizontal = rowOf(cluster[0]) === rowOf(cluster[1]);
    const first = cluster[0], last = cluster[cluster.length - 1];
    const ends = horizontal
      ? [[rowOf(first), colOf(first) - 1], [rowOf(last), colOf(last) + 1]]
      : [[rowOf(first) - 1, colOf(first)], [rowOf(last) + 1, colOf(last)]];
    return ends
      .filter(([r, c]) => inBounds(r, c))
      .map(([r, c]) => toIndex(r, c))
      .filter((n) => cells[n] === 'unknown');
  }

  /** 명중 묶음을 포함하는 함선 배치가 각 후보 칸을 지나는 경우의 수 */
  function targetScores(cells, cluster, remaining) {
    const inCluster = new Set(cluster);
    const scores = new Map();
    remaining.filter((len) => len > cluster.length).forEach((len) => {
      forEachPlacement(len, (pc) => {
        if (!cluster.every((i) => pc.includes(i))) return;
        if (!pc.every((i) => inCluster.has(i) || cells[i] === 'unknown')) return;
        pc.forEach((i) => { if (!inCluster.has(i)) scores.set(i, (scores.get(i) || 0) + 1); });
      });
    });
    return scores;
  }

  /** 점수가 가장 높은 항목 중 하나를 무작위로 고른다. */
  function pickBest(items, score, rng) {
    let best = -Infinity, pool = [];
    items.forEach((it) => {
      const s = score(it);
      if (s > best) { best = s; pool = [it]; } else if (s === best) pool.push(it);
    });
    return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }

  /** 일반 포격 좌표 선택: 추적 모드 → 탐색 모드 순 */
  function chooseShot(view, rng = Math.random) {
    const cells = deduce(view.cells);

    // 추적 모드: 미격침 명중 칸이 있으면 그 함선을 먼저 끝낸다.
    for (const cluster of hitClusters(cells)) {
      const cand = targetCandidates(cells, cluster);
      if (cand.length) {
        const scores = targetScores(cells, cluster, view.remaining);
        return pickBest(cand, (i) => scores.get(i) || 0, rng);
      }
    }

    // 탐색 모드
    const open = [];
    cells.forEach((s, i) => { if (s === 'unknown') open.push(i); });
    if (open.length) {
      const d = searchDensity(cells, view.remaining);
      return pickBest(open, (i) => d[i], rng);
    }
    // 추론상 남은 칸이 없을 때의 안전장치: 공개 정보상 미확인 칸 아무거나
    const fallback = [];
    view.cells.forEach((s, i) => { if (s === 'unknown') fallback.push(i); });
    return fallback.length ? fallback[Math.floor(rng() * fallback.length)] : null;
  }

  /**
   * 핵폭탄 중심 선택.
   * 미확인 칸의 확률 지도 + 추적 중인 함선의 후보 칸(큰 가중치)을 합산하고,
   * 3×3 범위 안 미확인 칸의 점수 합이 가장 큰 중심을 고른다.
   * 이미 공격한 칸, 확인된 바다, 격침 함선 주변은 점수 0이다.
   */
  function chooseNukeCenter(view, rng = Math.random) {
    const cells = deduce(view.cells);
    const heat = searchDensity(cells, view.remaining);
    hitClusters(cells).forEach((cluster) => {
      const scores = targetScores(cells, cluster, view.remaining);
      targetCandidates(cells, cluster).forEach((i) => { heat[i] += 100 + (scores.get(i) || 0); });
    });

    const centers = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const s = B.area3x3(i).reduce((sum, n) => sum + (cells[n] === 'unknown' ? heat[n] : 0), 0);
      if (s > 0) centers.push({ i, s });
    }
    const best = pickBest(centers, (c) => c.s, rng);
    return best ? best.i : null;
  }

  /** CPU의 다음 행동. 핵폭탄이 있으면 바로 사용한다. (보유 한도 1개라 아껴 두면 손해) */
  function decide(view, hasNuke, rng = Math.random) {
    if (hasNuke) {
      const center = chooseNukeCenter(view, rng);
      if (center != null) return { type: 'nuke', index: center };
    }
    return { type: 'shot', index: chooseShot(view, rng) };
  }

  global.BattleshipAI = {
    deduce, hitClusters, searchDensity, targetCandidates, targetScores,
    chooseShot, chooseNukeCenter, decide,
  };
})(typeof window !== 'undefined' ? window : globalThis);
