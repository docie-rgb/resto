/*
 * 화면 렌더링과 입력 처리
 * 게임 규칙은 game.js(Battleship.Game), CPU 판단은 ai.js(BattleshipAI)에 맡기고
 * 여기서는 상태를 그리고, 연출 타이밍과 CPU 턴 예약만 담당한다.
 */
(function () {
  'use strict';

  const B = window.Battleship;
  const AI = window.BattleshipAI;
  const Sound = window.BattleshipSound;
  const Ships = window.BattleshipShips;
  const SetupMod = window.BattleshipSetup;
  const S = B.STATE;

  const ARRANGE_HINT = '배를 끌어서 옮기고, 클릭하면 가로/세로로 회전합니다. 준비되면 [게임 시작]을 누르세요.';

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
    harbor: $('harbor'), harborRows: $('harbor-rows'),
  };

  let game = null;
  let setup = null;     // 시작 전 함대 구성·배치 (BattleshipSetup.FleetSetup)
  let drag = null;      // 끌기 중인 배 정보
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

  /**
   * 좌표 라벨(A~J, 1~10)과 100개 칸을 만들고, 칸 요소 배열을 돌려준다.
   * 함선 이미지를 칸 위에 겹쳐 놓을 수 있도록 모든 요소의 격자 위치를 직접 지정한다.
   */
  function buildBoard(container) {
    const cells = [];
    container.appendChild(place(label(''), 0, 0));
    for (let c = 0; c < B.SIZE; c++) container.appendChild(place(label(String.fromCharCode(65 + c)), 0, c + 1));
    for (let r = 0; r < B.SIZE; r++) {
      container.appendChild(place(label(String(r + 1)), r + 1, 0));
      for (let c = 0; c < B.SIZE; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.i = B.toIndex(r, c);
        const fx = document.createElement('span');
        fx.className = 'fx';
        el.appendChild(fx);
        container.appendChild(place(el, r + 1, c + 1));
        cells.push(el);
      }
    }
    return cells;
  }

  function place(el, row, col) {
    el.style.gridRow = row + 1;
    el.style.gridColumn = col + 1;
    return el;
  }

  function label(text) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = text;
    return el;
  }

  // 격자별 함선 이미지 { board, els }. 배치가 바뀌면(새 게임, 배치 변경) 다시 만든다.
  const shipLayers = new Map();

  function renderShips(boardEl, board, showAll) {
    let layer = shipLayers.get(boardEl);
    if (!layer || layer.board !== board) {
      if (layer) layer.els.forEach((el) => el.remove());
      const els = board.ships.map((s) => {
        const el = document.createElement('div');
        el.className = 'ship-img';
        const r = B.rowOf(s.cells[0]) + 2, c = B.colOf(s.cells[0]) + 2;
        el.style.gridRow = s.dir === 'V' ? `${r} / span ${s.length}` : r;
        el.style.gridColumn = s.dir === 'H' ? `${c} / span ${s.length}` : c;
        el.innerHTML = Ships.svg(s.length, s.dir);
        boardEl.appendChild(el);
        return el;
      });
      layer = { board, els };
      shipLayers.set(boardEl, layer);
    }
    board.ships.forEach((s, k) => {
      layer.els[k].hidden = !(showAll || s.sunk);
      layer.els[k].classList.toggle('sunk', s.sunk);
      layer.els[k].classList.toggle('dragging', !!(drag && drag.moved && s.tag === drag.id));
    });
  }

  // ---------- 항구 (함대 구성 + 미배치 배) ----------

  function renderHarbor() {
    els.harborRows.innerHTML = SetupMod.TYPES.map((len) => {
      const count = setup.count(len);
      const waiting = setup.harborCount(len);
      const name = Ships.NAMES[len];
      return `<div class="dock${waiting ? ' waiting' : ''}">
        <div class="dock-ship${waiting ? ' available' : ''}" data-len="${len}"
             title="${waiting ? '끌어서 격자에 배치' : '항구에 대기 중인 배 없음'}">${Ships.svg(len, 'H')}</div>
        <div class="dock-name">${name} <small>${len}칸</small></div>
        <div class="stepper" aria-label="${name} 수량">
          <button type="button" data-len="${len}" data-d="-1" ${setup.canChange(len, -1) ? '' : 'disabled'} aria-label="${name} 줄이기">−</button>
          <span>${count}척</span>
          <button type="button" data-len="${len}" data-d="1" ${setup.canChange(len, 1) ? '' : 'disabled'} aria-label="${name} 늘리기">+</button>
        </div>
        <div class="dock-wait">미배치 <b>${waiting}</b>척</div>
      </div>`;
    }).join('');
    els.harbor.classList.toggle('drop-target', !!(drag && drag.moved && drag.overHarbor && drag.source === 'board'));
  }

  /** 항구에 남은 배 안내 */
  function harborMessage() {
    const left = setup.ships.filter((s) => !s.cells).length;
    return left ? `항구에 ${left}척이 남아 있습니다. 모두 격자에 배치해야 시작할 수 있습니다.`
                : '모든 배를 배치했습니다. [게임 시작]을 누르세요.';
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

    // 내 격자: 함선 항상 표시. 배치 중이면 끌어다 놓을 자리와 밀려날 배를 표시
    const pv = drag && drag.moved && drag.preview;
    const pushCells = pv ? pv.conflicts.flatMap((id) => setup.ship(id).cells) : [];
    playerCells.forEach((el, i) => {
      const cls = cellClass(game.player.board, i, true, false);
      if (lastCpuShots.includes(i)) cls.push('last');
      if (pv && pv.cells.includes(i)) cls.push('drop', pv.conflicts.length ? 'drop-push' : 'drop-ok');
      if (pushCells.includes(i)) cls.push('push-ship');
      el.className = cls.join(' ');
    });
    els.playerBoard.classList.toggle('arrange', st === S.READY);

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
    renderShips(els.playerBoard, game.player.board, true);
    renderShips(els.cpuBoard, game.cpu.board, over);
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
    els.start.disabled = !setup.allPlaced();
    els.harbor.hidden = st !== S.READY;
    if (st === S.READY) renderHarbor();
    els.nuke.hidden = st === S.READY || over || targeting;
    els.nuke.disabled = !(playerCanFire && game.player.nukes > 0);
    els.cancel.hidden = !targeting;
    els.restart.hidden = !over;
  }

  function renderTurn() {
    let key, text;
    switch (game.state) {
      case S.READY:
        key = 'ready';
        text = setup.allPlaced() ? '배치를 확인하고 게임을 시작하세요' : '항구에 남은 배를 배치하세요';
        break;
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
      li.style.width = `${s.length * 16}px`;
      li.innerHTML = Ships.svg(s.length, 'H');
      li.title = `${Ships.NAMES[s.length]} ${s.length}칸${s.sunk ? ' (격침)' : ''}`;
      ul.appendChild(li);
    });
  }

  function renderNuke(el, side) {
    const pips = Array.from({ length: B.NUKE_EVERY }, (_, k) => `<i class="${k < side.nukeCounter ? 'on' : ''}"></i>`).join('');
    el.innerHTML =
      `<span class="nuke-icon ${side.nukes ? 'on' : ''}">☢</span>` +
      `<span class="nuke-text">${side.nukes}/${B.NUKE_MAX}</span>` +
      `<span class="pips" title="다음 핵폭탄까지 턴 ${side.nukeCounter}/${B.NUKE_EVERY}">${pips}</span>`;
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
    // 핵폭탄은 결과와 상관없이 폭발음 하나, 일반 포격은 명중/빗나감에 따라
    if (out.kind === 'nuke') Sound.nuke();
    else if (out.hit) Sound.hit();
    else Sound.splash();

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
    if (out.nukeGainedBy) parts.push(out.nukeGainedBy === 'player' ? '내 턴 — 핵폭탄 획득!' : 'CPU가 핵폭탄을 획득했습니다.');
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

  /** 새 게임: 함대 구성은 이전 게임 것을 유지하고 배치만 새로 무작위로 */
  function newGame() {
    gen++;
    timers.forEach(clearTimeout);
    timers = [];
    cancelDrag();
    if (!setup) setup = new SetupMod.FleetSetup(B.FLEET);
    setup.randomize();
    game = new B.Game({ fleet: setup.fleet(), playerShips: setup.placedShips() });
    hoverIdx = null;
    lastCpuShots = [];
    lastTurnKey = '';
    [...playerCells, ...cpuCells].forEach((el) => (el.firstChild.className = 'fx'));
    setMessage(ARRANGE_HINT);
    render();
  }

  /** 배치 화면의 변경을 게임에 반영 (구성이 바뀌면 CPU 함대도 같은 구성으로 다시 배치) */
  function syncSetup(fleetChanged = false) {
    if (fleetChanged) game.setFleet(setup.fleet());
    game.setPlayerShips(setup.placedShips());
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

  els.reroll.addEventListener('click', () => {
    if (game.state !== S.READY) return;
    setup.randomize();
    setMessage(ARRANGE_HINT);
    syncSetup();
  });
  els.start.addEventListener('click', () => {
    if (game.state !== S.READY) return;
    if (!setup.allPlaced()) { setMessage(harborMessage()); return; }
    game.setPlayerShips(setup.placedShips());
    if (game.start()) { setMessage('CPU 격자에서 공격할 칸을 클릭하세요.'); render(); }
  });
  els.nuke.addEventListener('click', () => {
    if (game.enterNukeTargeting()) { setMessage('CPU 격자에서 3×3 중심을 클릭하세요. (Esc: 취소)'); render(); }
  });
  els.cancel.addEventListener('click', cancelNuke);
  // 자동재생 정책: 사용자의 첫 입력 때 오디오를 연다 (이후 CPU 공격 소리도 재생 가능)
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelNuke(); });
  els.restart.addEventListener('click', newGame);

  // ---------- 배치: 수량 변경 ----------

  els.harborRows.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-d]');
    if (!btn || game.state !== S.READY) return;
    const len = Number(btn.dataset.len), d = Number(btn.dataset.d);
    if (!setup.change(len, d)) return;
    setMessage(d > 0 ? `${Ships.NAMES[len]} 1척을 항구에 추가했습니다. 끌어서 배치하세요.` : harborMessage());
    syncSetup(true);
  });

  // ---------- 배치: 끌어서 이동 / 클릭해서 회전 ----------

  const DRAG_THRESHOLD = 5; // 이만큼(px) 움직여야 끌기로 본다. 그보다 적으면 클릭(회전)

  // 격자 위의 배를 누르면 끌기 시작 (잡은 칸이 배의 몇 번째 칸인지 기억)
  els.playerBoard.addEventListener('pointerdown', (e) => {
    if (game.state !== S.READY || e.button !== 0) return;
    const i = cellIndex(e);
    if (i == null) return;
    const id = setup.shipAt(i);
    if (id == null) return;
    const s = setup.ship(id);
    beginDrag(e, { id, k: s.cells.indexOf(i), dir: s.dir, length: s.length, source: 'board' });
  });

  // 항구에 대기 중인 배를 누르면 끌기 시작
  els.harborRows.addEventListener('pointerdown', (e) => {
    const dock = e.target.closest('.dock-ship.available');
    if (!dock || game.state !== S.READY || e.button !== 0) return;
    const s = setup.harborShip(Number(dock.dataset.len));
    if (s) beginDrag(e, { id: s.id, k: 0, dir: s.dir, length: s.length, source: 'harbor' });
  });

  function beginDrag(e, d) {
    e.preventDefault();
    drag = Object.assign(d, { x0: e.clientX, y0: e.clientY, moved: false, preview: null, overHarbor: false });
  }

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD) return;
      drag.moved = true;
      createGhost();
      document.body.classList.add('dragging-ship');
    }
    moveGhost(e);
    updateDropTarget(e);
    render();
  });

  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    if (d.moved) updateDropTarget(e);
    cancelDrag();

    if (!d.moved) {
      // 클릭: 격자 위의 배를 가로 ↔ 세로 회전
      if (d.source === 'board') reportPlacement(setup.rotate(d.id));
    } else if (d.preview) {
      reportPlacement(setup.place(d.id, d.target.r, d.target.c, d.dir));
    } else if (d.overHarbor && d.source === 'board') {
      setup.toHarbor(d.id);
      setMessage(`${Ships.NAMES[d.length]}을 항구로 보냈습니다. (모든 배를 배치해야 시작할 수 있습니다)`);
    }
    syncSetup();
  });

  document.addEventListener('pointercancel', () => { if (drag) { cancelDrag(); render(); } });

  function cancelDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
    document.body.classList.remove('dragging-ship');
  }

  /** 포인터 아래가 내 격자 칸이면 배가 놓일 위치를, 항구면 항구로 보내기를 준비 */
  function updateDropTarget(e) {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = under && under.closest('#player-board .cell');
    drag.preview = null;
    drag.target = null;
    drag.overHarbor = !cellEl && !!(under && under.closest('#harbor'));
    if (!cellEl) return;
    const t = Number(cellEl.dataset.i);
    const r = B.rowOf(t) - (drag.dir === 'V' ? drag.k : 0);
    const c = B.colOf(t) - (drag.dir === 'H' ? drag.k : 0);
    drag.target = { r, c };
    drag.preview = setup.preview(drag.id, r, c, drag.dir);
  }

  /** 포인터를 따라다니는 배 이미지 (격자 칸 크기에 맞춤) */
  function createGhost() {
    const a = playerCells[0].getBoundingClientRect();
    const b = playerCells[1].getBoundingClientRect();
    drag.cell = a.width;
    drag.step = b.left - a.left;
    const long = drag.step * (drag.length - 1) + drag.cell;
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.style.width = `${drag.dir === 'H' ? long : drag.cell}px`;
    g.style.height = `${drag.dir === 'V' ? long : drag.cell}px`;
    g.innerHTML = Ships.svg(drag.length, drag.dir);
    document.body.appendChild(g);
    drag.ghost = g;
  }

  function moveGhost(e) {
    // 잡은 칸이 포인터 아래에 오도록
    const along = drag.k * drag.step + drag.cell / 2;
    const x = e.clientX - (drag.dir === 'H' ? along : drag.cell / 2);
    const y = e.clientY - (drag.dir === 'V' ? along : drag.cell / 2);
    drag.ghost.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** 배치 결과 안내: 밀려난 배, 항구로 간 배, 남은 배 */
  function reportPlacement(res) {
    if (!res) return;
    const parts = [];
    if (res.moved.length) parts.push(`겹치는 배 ${res.moved.length}척을 가까운 빈자리로 옮겼습니다.`);
    if (res.harbored.length) parts.push(`빈자리가 없어 ${res.harbored.length}척을 항구로 보냈습니다.`);
    parts.push(harborMessage());
    setMessage(parts.join(' '));
  }

  function cancelNuke() {
    if (game.cancelNuke()) { hoverIdx = null; setMessage('핵폭탄 사용을 취소했습니다.'); render(); }
  }

  newGame();
})();
