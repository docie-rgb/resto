/*
 * 함선 이미지 (인라인 SVG)
 * 길이마다 다른 함종으로 그린다: 5 항공모함, 4 전함, 3 순양함, 2 구축함.
 * 가로 기준(뱃머리가 오른쪽)으로 그리고, 세로 배치는 90° 회전한다. 세로일 때 뱃머리는 아래쪽.
 * 전역 객체 window.BattleshipShips 로 공개한다.
 */
(function (global) {
  'use strict';

  const NAMES = { 5: '항공모함', 4: '전함', 3: '순양함', 2: '구축함' };
  const HALF = { 5: 42, 4: 37, 3: 34, 2: 31 }; // 선체 폭의 절반 (칸 높이 100 기준)

  /** 포탑: 원형 받침 + 포신. dir 1이면 뱃머리 쪽, -1이면 선미 쪽을 향한다. */
  function turret(x, r, dir) {
    const len = r * 1.9;
    const bx = dir > 0 ? x : x - len;
    return `<rect class="gun" x="${bx}" y="${50 - r * 0.35}" width="${len}" height="${r * 0.3}" rx="1"/>` +
           `<rect class="gun" x="${bx}" y="${50 + r * 0.05}" width="${len}" height="${r * 0.3}" rx="1"/>` +
           `<circle class="part" cx="${x}" cy="50" r="${r}"/>`;
  }

  /** 가로 기준 선체와 함종별 세부 묘사 (너비 W = 길이 × 100, 높이 100) */
  function drawing(length) {
    const W = length * 100;
    const h = HALF[length];
    const y0 = 50 - h, y1 = 50 + h;
    const bow = h * 2.6; // 뱃머리가 좁아지는 구간 길이

    const hull = `<path class="hull" d="M8 ${y0} H${W - bow} Q${W - 10} ${y0 + 4} ${W - 4} 50 ` +
                 `Q${W - 10} ${y1 - 4} ${W - bow} ${y1} H8 Q2 50 8 ${y0} Z"/>`;
    const deck = `<rect class="deck" x="16" y="${y0 + 6}" width="${W - bow - 16}" height="${h * 2 - 12}" rx="4"/>`;
    let parts = '';

    if (length === 5) {
      // 항공모함: 활주로 중앙선, 측면 함교(아일랜드), 사선 착함 갑판
      parts += `<line class="line" x1="30" y1="50" x2="${W - bow + 10}" y2="50" stroke-dasharray="18 12"/>`;
      parts += `<line class="line" x1="40" y1="${y1 - 12}" x2="${W * 0.45}" y2="${y0 + 14}"/>`;
      parts += `<rect class="part" x="${W * 0.58}" y="${y0 + 2}" width="80" height="20" rx="3"/>`;
      parts += `<rect class="mast" x="${W * 0.58 + 30}" y="${y0 + 6}" width="16" height="12" rx="2"/>`;
    } else if (length === 4) {
      // 전함: 중앙 상부 구조물과 포탑 3기
      parts += `<rect class="part" x="${W * 0.36}" y="${50 - h * 0.6}" width="${W * 0.2}" height="${h * 1.2}" rx="4"/>`;
      parts += `<circle class="mast" cx="${W * 0.46}" cy="50" r="${h * 0.32}"/>`;
      parts += turret(W * 0.2, h * 0.5, -1) + turret(W * 0.66, h * 0.5, 1) + turret(W * 0.8, h * 0.5, 1);
    } else if (length === 3) {
      // 순양함: 상부 구조물과 포탑 2기
      parts += `<rect class="part" x="${W * 0.35}" y="${50 - h * 0.6}" width="${W * 0.22}" height="${h * 1.2}" rx="4"/>`;
      parts += `<circle class="mast" cx="${W * 0.46}" cy="50" r="${h * 0.3}"/>`;
      parts += turret(W * 0.2, h * 0.5, -1) + turret(W * 0.72, h * 0.5, 1);
    } else {
      // 구축함: 작은 함교와 포탑 1기
      parts += `<rect class="part" x="${W * 0.3}" y="${50 - h * 0.55}" width="${W * 0.22}" height="${h * 1.1}" rx="3"/>`;
      parts += turret(W * 0.7, h * 0.5, 1);
    }
    return hull + deck + parts;
  }

  /** 함선 SVG 문자열. dir: 'H' 가로 | 'V' 세로 */
  function svg(length, dir) {
    const W = length * 100;
    const body = drawing(length);
    const title = `<title>${NAMES[length]} (${length}칸)</title>`;
    if (dir === 'V') {
      // (x, y) → (100 - y, x): 가로 그림을 시계 방향으로 90° 돌린다.
      return `<svg viewBox="0 0 100 ${W}" preserveAspectRatio="none">${title}` +
             `<g transform="translate(100 0) rotate(90)">${body}</g></svg>`;
    }
    return `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none">${title}${body}</svg>`;
  }

  global.BattleshipShips = { svg, NAMES };
})(window);
