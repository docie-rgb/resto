/*
 * 효과음 (Web Audio API로 직접 합성, 음원 파일 없음)
 * 브라우저 자동재생 정책 때문에 첫 클릭 때 unlock()으로 AudioContext를 연다.
 * 전역 객체 window.BattleshipSound 로 공개한다.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let out = null;   // 여러 소리가 겹쳐도 찢어지지 않도록 컴프레서를 거쳐 출력
  let noise = null; // 재사용하는 백색 소음 버퍼 (3초)

  function unlock() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      out = ctx.createDynamicsCompressor();
      out.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 시작 음량 peak 에서 dur 초 동안 지수적으로 줄어드는 게인 */
  function envelope(t, peak, dur, attack = 0.005) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
  }

  /** 필터를 거친 소음. 주파수가 from → to 로 미끄러진다. */
  function noiseBurst(t, { type, from, to, q = 1, peak, dur, attack }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(f).connect(envelope(t, peak, dur, attack));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** 음높이가 from → to 로 떨어지는 단음 */
  function tone(t, { type = 'sine', from, to, peak, dur, attack }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(envelope(t, peak, dur, attack));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 빗나감: 물에 떨어지는 첨벙 + 물방울 */
  function splash() {
    if (!unlock()) return;
    const t = ctx.currentTime;
    noiseBurst(t, { type: 'bandpass', from: 2400, to: 400, q: 0.7, peak: 0.6, dur: 0.7, attack: 0.02 });
    noiseBurst(t, { type: 'highpass', from: 5000, to: 2500, peak: 0.15, dur: 0.35 });
    tone(t + 0.05, { from: 900, to: 220, peak: 0.12, dur: 0.12 });
    tone(t + 0.16, { from: 700, to: 260, peak: 0.08, dur: 0.1 });
  }

  /** 명중: 둔탁한 타격음 + 금속성 파열 */
  function hit() {
    if (!unlock()) return;
    const t = ctx.currentTime;
    tone(t, { type: 'triangle', from: 180, to: 40, peak: 0.9, dur: 0.35 });
    noiseBurst(t, { type: 'lowpass', from: 4000, to: 300, peak: 0.7, dur: 0.4 });
    tone(t, { type: 'square', from: 420, to: 260, peak: 0.08, dur: 0.15 });
  }

  /** 핵폭탄: 날카로운 섬광음 뒤 길게 울리는 폭발 */
  function nuke() {
    if (!unlock()) return;
    const t = ctx.currentTime;
    noiseBurst(t, { type: 'highpass', from: 3000, to: 800, peak: 0.5, dur: 0.15 });
    noiseBurst(t, { type: 'lowpass', from: 1600, to: 60, peak: 1.0, dur: 2.6, attack: 0.03 });
    tone(t, { from: 90, to: 25, peak: 1.0, dur: 1.8, attack: 0.02 });
    tone(t + 0.05, { type: 'triangle', from: 55, to: 30, peak: 0.6, dur: 2.2, attack: 0.1 });
  }

  global.BattleshipSound = { unlock, splash, hit, nuke };
})(window);
