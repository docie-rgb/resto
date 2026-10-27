/*
 * 화면 렌더링과 입력 처리
 * 게임 규칙은 game.js(Battleship.Game), CPU 판단은 ai.js(BattleshipAI)에 맡기고
 * 여기서는 상태를 그리고, 연출 타이밍과 CPU 턴 예약만 담당한다.
 */
(function () {
  'use strict';

  const B = window.Battleship;
  const AI = window.BattleshipAI;
  const S = B.STATE;

  const RESOLVE_MS = 450;   // 포격 결과를 보여주는 동안 입력 차단
  const CPU_GAP_MS = 350;   // CPU 포격 사이 추가 대기 (총 0.8초 간격)
  const TURN_CHANGE_MS = 600;

  const $ = (id) => document.getElementById(id);
  const els = {
    turn: $('turn'), message: $('message'),
    playerPanel: $('player-panel'), cpuPanel: $('cpu-panel'),
    playerBoard: $('player-board'), cpuBoard: $('cpu-board'),
    playerFleet: $('player-fleet'), cpuFleet: $('cpu-fleet'),
    playerNuke: $('player-nuke'), cpuNuke: $('cpu-nuke'),
    reroll: $('btn-reroll'), start: $('btn-start'), nuke: $('btn-nuke'),
    cancel: $('btn-cancel'), restart: $('btn-restart'),
  };

  let game = null;
  let gen = 0;          // 새 게임마다 증가. 이전 게임에서 예약된 콜백을 무효화한다.
  let timers = [];
  let hoverIdx = null;  // 핵폭탄 조준 중 마우스 위치
  let lastCpuShots = []; // CPU가 마지막으로 공격한 칸
  let lastTurnKey = '';

  /** 현재 게임에서만 유효한 지연 실행 */
  function later(fn, ms) {
    const g = gen;
    const t = setTimeout(() => {
      timers = timers.filter((x) => x !== t);
      if (g === gen) fn();
    }, ms);
    timers.push(t);
  }

  // ---------- 격자 생성 ----------

  /** 좌표 라벨(A~J, 1~10)과 100개 칸을 만들고, 칸 요소 배열을 돌려준다. */
  function buildBoard(container) {
    const cells = [];
    container.appendChild(label(''));
    for (let c = 0; c < B.SIZE; c++) container.appendChild(label(String.fromCharCode(65 + c)));
    for (let r = 0; r < B.SIZE; r++) {
      container.appendChild(label(String(r + 1)));
      for (let c = 0; c < B.SIZE; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.i = B.toIndex(r, c);
        const fx = document.createElement('span');
        fx.className = 'fx';
        el.appendChild(fx);
        container.appendChild(el);
        cells.push(el);
      }
    }
    return cells;
  }

  function label(text) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = text;
    return el;
  }

  const playerCells = buildBoard(els.playerBoard);
  const cpuCells = buildBoard(els.cpuBoard);

  // ---------- 렌더링 ----------

  function cellClass(board, i, showShips, openable) {
    const c = board.cells[i];
    const cls = ['cell'];
    const ship = c.shipId >= 0 ? board.ships[c.shipId] : null;
    if (ship && (showShips || ship.sunk)) cls.push('ship');
    if (c.attacked) cls.push(c.result);
    if (ship && ship.sunk) cls.push('sunk');
    if (c.revealed) cls.push('safe');
    if (openable && B.isOpen(board, i)) cls.push('open');
    return cls;
  }

  function render() {
    const st = game.state;
    const over = st === S.GAME_OVER;
    const playerCanFire = st === S.PLAYER_TURN;
    const targeting = st === S.PLAYER_NUKE_TARGETING;

    // 내 격자: 함선 항상 표시
    playerCells.forEach((el, i) => {
      const cls = cellClass(game.player.board, i, true, false);
      if (lastCpuShots.includes(i)) cls.push('last');
      el.className = cls.join(' ');
    });

    // CPU 격자: 격침된 함선만 공개 (게임 종료 시 전체 공개)
    let preview = [], previewValid = false;
    if (targeting && hoverIdx != null) {
      preview = B.area3x3(hoverIdx);
      previewValid = game.nukeTargets('player', hoverIdx).length > 0;
    }
    cpuCells.forEach((el, i) => {
      const cls = cellClass(game.cpu.board, i, over, playerCanFire);
      if (preview.includes(i)) {
        cls.push('nuke-preview');
        if (!previewValid) cls.push('nuke-invalid');
      }
      el.className = cls.join(' ');
    });
    els.cpuBoard.classList.toggle('can-fire', playerCanFire);
    els.cpuBoard.classList.toggle('targeting', targeting);

    // 공격 대상 격자 강조
    const attacker = st === S.RESOLVING_ATTACK ? null : (st === S.CPU_TURN ? 'cpu' : (playerCanFire || targeting ? 'player' : null));
    els.cpuPanel.classList.toggle('active-target', attacker === 'player');
    els.playerPanel.classList.toggle('under-fire', attacker === 'cpu');

    renderTurn();
    renderFleet(els.playerFleet, game.player.board);
    renderFleet(els.cpuFleet, game.cpu.board);
    renderNuke(els.playerNuke, game.player);
    renderNuke(els.cpuNuke, game.cpu);

    els.reroll.hidden = els.start.hidden = st !== S.READY;
    els.nuke.hidden = st === S.READY || over || targeting;
    els.nuke.disabled = !(playerCanFire && game.player.nukes > 0);
    els.cancel.hidden = !targeting;
    els.restart.hidden = !over;
  }

  function renderTurn() {
    let key, text;
    switch (game.state) {
      case S.READY: key = 'ready'; text = '배치를 확인하고 게임을 시작하세요'; break;
      case S.PLAYER_NUKE_TARGETING: key = 'targeting'; text = '☢ 핵폭탄 조준 중'; break;
      case S.GAME_OVER: key = game.winner === 'player' ? 'victory' : 'defeat'; text = game.winner === 'player' ? 'VICTORY' : 'DEFEAT'; break;
      default: key = game.turn; text = game.turn === 'player' ? '플레이어 차례' : 'CPU 차례';
    }
    els.turn.textContent = text;
    els.turn.className = 'turn ' + key;
    if (key !== lastTurnKey) {
      void els.turn.offsetWidth; // 애니메이션 재시작
      els.turn.classList.add('flash');
      lastTurnKey = key;
    }
  }

  function renderFleet(ul, board) {
    ul.innerHTML = '';
    board.ships.slice().sort((a, b) => b.length - a.length).forEach((s) => {
      const li = document.createElement('li');
      if (s.sunk) li.className = 'sunk';
      li.title = `${s.length}칸${s.sunk ? ' (격침)' : ''}`;
      for (let k = 0; k < s.length; k++) li.appendChild(document.createElement('span'));
      ul.appendChild(li);
    });
  }

  function renderNuke(el, side) {
    const pips = Array.from({ length: B.NUKE_EVERY }, (_, k) => `<i class="${k < side.nukeCounter ? 'on' : ''}"></i>`).join('');
    el.innerHTML =
      `<span class="nuke-icon ${side.nukes ? 'on' : ''}">☢</span>` +
      `<span class="nuke-text">${side.nukes}/${B.NUKE_MAX}</span>` +
      `<span class="pips" title="다음 핵폭탄까지 일반 포격 ${side.nukeCounter}/${B.NUKE_EVERY}">${pips}</span>`;
  }

  function setMessage(text, sunk = false) {
    els.message.textContent = text;
    els.message.classList.toggle('sunk-msg', sunk);
  }

  /** 칸 위에 일회성 효과를 재생 */
  function playFx(cellEl, name) {
    const fx = cellEl.firstChild;
    fx.className = 'fx';
    void fx.offsetWidth;
    fx.className = 'fx ' + name;
  }

  function playEffects(out) {
    const cells = out.attacker === 'player' ? cpuCells : playerCells;
    if (out.kind === 'nuke') out.area.forEach((i) => playFx(cells[i], 'fx-nuke'));
    out.results.forEach((r) => playFx(cells[r.index], r.result === 'hit' ? 'fx-hit' : 'fx-miss'));
    // 격침 강조는 폭발이 끝난 뒤에
    out.sunk.forEach((ship) => later(() => ship.cells.forEach((i) => playFx(cells[i], 'fx-sunk')), 350));
  }

  function describe(out) {
    const who = out.attacker === 'player' ? '나' : 'CPU';
    const parts = [];
    if (out.kind === 'nuke') {
      const hits = out.results.filter((r) => r.result === 'hit').length;
      parts.push(`${who}: ☢ 핵폭탄 ${B.coordName(out.index)} 투하 — 명중 ${hits}칸`);
    } else {
      parts.push(`${who}: ${B.coordName(out.index)} ${out.hit ? '명중!' : '빗나감'}`);
    }
    if (out.sunk.length) {
      parts.push(`함선 격침! (${out.sunk.map((s) => s.length + '칸').join(', ')})`);
    }
    if (out.nukeGained) parts.push('핵폭탄 획득!');
    if (!out.gameOver && out.hit) parts.push(out.attacker === 'player' ? '한 번 더 공격하세요.' : 'CPU가 계속 공격합니다.');
    return parts.join(' ');
  }

  // ---------- 진행 ----------

  /** 공격 결과를 보여준 뒤 다음 차례로 넘긴다. */
  function resolve(out) {
    hoverIdx = null;
    if (out.attacker === 'cpu') lastCpuShots = out.results.map((r) => r.index);
    render();
    playEffects(out);
    setMessage(describe(out), out.sunk.length > 0);

    if (out.gameOver) {
      later(() => setMessage(game.winner === 'player'
        ? 'VICTORY — CPU 함대를 모두 격침했습니다!'
        : 'DEFEAT — 내 함대가 모두 격침되었습니다.'), 900);
      return;
    }

    later(() => {
      game.finishResolve();
      render();
      if (game.state === S.CPU_TURN) {
        later(cpuStep, out.attacker === 'cpu' ? CPU_GAP_MS : TURN_CHANGE_MS);
      }
    }, RESOLVE_MS);
  }

  /** CPU 한 번의 행동. 공개 정보만 AI에 넘긴다. */
  function cpuStep() {
    if (game.state !== S.CPU_TURN) return;
    const view = B.publicView(game.player.board);
    const action = AI.decide(view, game.cpu.nukes > 0);
    let out = action.type === 'nuke'
      ? game.nuke('cpu', action.index)
      : game.fire('cpu', action.index);
    if (!out) {
      // 안전장치: AI가 잘못된 좌표를 고르면 공격 가능한 칸 중 무작위
      const open = view.cells.map((s, i) => (s === 'unknown' ? i : -1)).filter((i) => i >= 0);
      out = game.fire('cpu', open[Math.floor(Math.random() * open.length)]);
    }
    if (out) resolve(out);
  }

  function newGame() {
    gen++;
    timers.forEach(clearTimeout);
    timers = [];
    game = new B.Game();
    hoverIdx = null;
    lastCpuShots = [];
    lastTurnKey = '';
    [...playerCells, ...cpuCells].forEach((el) => (el.firstChild.className = 'fx'));
    setMessage('함선 배치를 확인하고 [게임 시작]을 누르세요.');
    render();
  }

  // ---------- 입력 ----------

  const cellIndex = (e) => {
    const el = e.target.closest('.cell');
    return el ? Number(el.dataset.i) : null;
  };

  els.cpuBoard.addEventListener('click', (e) => {
    const i = cellIndex(e);
    if (i == null) return;
    let out = null;
    if (game.state === S.PLAYER_NUKE_TARGETING) out = game.nuke('player', i);
    else if (game.state === S.PLAYER_TURN) out = game.fire('player', i);
    if (out) resolve(out);
  });

  els.cpuBoard.addEventListener('mouseover', (e) => {
    if (game.state !== S.PLAYER_NUKE_TARGETING) return;
    const i = cellIndex(e);
    if (i !== hoverIdx) { hoverIdx = i; render(); }
  });
  els.cpuBoard.addEventListener('mouseleave', () => {
    if (hoverIdx != null) { hoverIdx = null; render(); }
  });

  els.reroll.addEventListener('click', () => { if (game.rerollPlayerFleet()) render(); });
  els.start.addEventListener('click', () => {
    if (game.start()) { setMessage('CPU 격자에서 공격할 칸을 클릭하세요.'); render(); }
  });
  els.nuke.addEventListener('click', () => {
    if (game.enterNukeTargeting()) { setMessage('CPU 격자에서 3×3 중심을 클릭하세요. (Esc: 취소)'); render(); }
  });
  els.cancel.addEventListener('click', cancelNuke);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelNuke(); });
  els.restart.addEventListener('click', newGame);

  function cancelNuke() {
    if (game.cancelNuke()) { hoverIdx = null; setMessage('핵폭탄 사용을 취소했습니다.'); render(); }
  }

  newGame();
})();
