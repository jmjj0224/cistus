// 소리는 전부 코드로 합성한 임시 소리예요. 실제 파일을 쓰는 것은 엔딩 곡(CFG.song.file) 하나예요.
// 나중에 녹음한 소리로 바꾸려면 이 파일의 해당 함수만 바꾸면 돼요.

export class GameAudio {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.ready = false;
    this.cicadas = [];
    this.song = null;
    this.songOk = false;
    this.monster = null;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.world = ctx.createGain(); // 숲 소리 (매미, 바람)
    this.world.connect(this.master);
    this.sfx = ctx.createGain(); // 손, 발, 숨, 괴물
    this.sfx.connect(this.master);

    this.noise = this._noiseBuffer(2);
    this.crackle = this._crackleBuffer(2);
    this.cicadaBuf = await this._renderCicada();
    this._startAmbience();
    this._startBreath();
    this._prepSong();
    this.ready = true;
  }

  get now() {
    return this.ctx.currentTime;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  // ---------- 재료 ----------
  _noiseBuffer(sec) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * sec, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _crackleBuffer(sec) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * sec, sr);
    const d = buf.getChannelData(0);
    let left = 0;
    let len = 1;
    let amp = 0;
    for (let i = 0; i < d.length; i++) {
      if (left <= 0 && Math.random() < 0.0012) {
        len = left = 60 + Math.floor(Math.random() * 380);
        amp = 0.3 + Math.random() * 0.7;
      }
      if (left > 0) {
        d[i] = (Math.random() * 2 - 1) * amp * Math.pow(left / len, 2);
        left--;
      }
    }
    return buf;
  }

  // 매미 울음 한 소절(6초)을 미리 만들어 두고 반복 재생해요.
  async _renderCicada() {
    const sr = this.ctx.sampleRate;
    const dur = 6;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, sr * dur, sr);
    const src = off.createBufferSource();
    const nb = off.createBuffer(1, sr * dur, sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    src.buffer = nb;

    const mix = off.createGain();
    for (const [f, q, g] of [
      [4300, 14, 1.0],
      [5200, 12, 0.8],
      [6400, 10, 0.5],
    ]) {
      const bp = off.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = off.createGain();
      gg.gain.value = g;
      src.connect(bp).connect(gg).connect(mix);
    }
    // 빠른 떨림
    const am = off.createGain();
    am.gain.value = 0.55;
    const lfo = off.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 64;
    const lfoG = off.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG).connect(am.gain);
    // "맴 맴 맴 매앰" 소절
    const env = off.createGain();
    const g = env.gain;
    g.setValueAtTime(0, 0);
    g.linearRampToValueAtTime(1, 0.5);
    let t = 0.5;
    while (t < 4.3) {
      g.linearRampToValueAtTime(1, t + 0.2);
      g.linearRampToValueAtTime(0.3, t + 0.36);
      t += 0.36;
    }
    g.linearRampToValueAtTime(1, 4.6);
    g.setValueAtTime(1, 5.2);
    g.linearRampToValueAtTime(0, 5.95);
    mix.connect(am).connect(env).connect(off.destination);
    src.start();
    lfo.start();
    return off.startRendering();
  }

  _loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  _startAmbience() {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const g = this.ctx.createGain();
    g.gain.value = 0.07;
    this._loopNoise().connect(lp).connect(g).connect(this.world);
  }

  // 한 번 나고 끝나는 소리
  _burst({ type = 'noise', dur = 0.1, f0 = 1000, f1 = null, q = 1, filter = 'bandpass', gain = 0.2, attack = 0.005, out = null, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(out || this.sfx);
    if (type === 'noise') {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.setValueAtTime(f0, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      f.Q.value = q;
      s.connect(f).connect(g);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
    } else {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // ---------- 듣는 위치 ----------
  setListener(px, py, pz, fx, fz) {
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  _panner(x, y, z, ref = 2.2, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 80;
    this._setPannerPos(p, x, y, z);
    return p;
  }

  _setPannerPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  // ---------- 매미 ----------
  addCicada(x, y, z) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.cicadaBuf;
    s.loop = true;
    s.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = this.ctx.createGain();
    g.gain.value = 0.75;
    const p = this._panner(x, y, z);
    s.connect(g).connect(p).connect(this.world);
    s.start(0, Math.random() * 5);
    this.cicadas.push({ s, g, base: s.playbackRate.value });
    return this.cicadas.length - 1;
  }

  // 타는 동안 울음이 높아져요.
  setCicadaBurning(i, on) {
    const c = this.cicadas[i];
    if (!c || c.dead) return;
    c.s.playbackRate.setTargetAtTime(on ? c.base * 1.55 : c.base, this.now, 0.25);
    c.g.gain.setTargetAtTime(on ? 1.1 : 0.75, this.now, 0.2);
  }

  stopCicada(i) {
    const c = this.cicadas[i];
    if (!c || c.dead) return;
    c.dead = true;
    c.g.gain.setTargetAtTime(0, this.now, 0.12);
    c.s.stop(this.now + 0.8);
  }

  fadeWorld(to, sec) {
    this.world.gain.setTargetAtTime(to, this.now, sec / 3);
  }

  // ---------- 라이터 ----------
  lidClick() {
    this._burst({ f0: 2400, q: 4, dur: 0.035, gain: 0.25 });
    this._burst({ f0: 5200, q: 6, dur: 0.02, gain: 0.12, when: 0.03 });
  }

  flint() {
    this._burst({ filter: 'highpass', f0: 3600, dur: 0.06, gain: 0.2 });
  }

  flameOn() {
    this._burst({ filter: 'lowpass', f0: 1300, dur: 0.28, gain: 0.07, attack: 0.05 });
  }

  setBurning(on) {
    if (on && !this._burn) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.crackle;
      s.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      s.connect(hp).connect(g).connect(this.sfx);
      s.start();
      this._burn = { s, g };
    } else if (!on && this._burn) {
      this._burn.g.gain.setTargetAtTime(0, this.now, 0.05);
      this._burn.s.stop(this.now + 0.3);
      this._burn = null;
    }
  }

  rustle() {
    this._burst({ filter: 'bandpass', f0: 900, f1: 500, q: 0.7, dur: 0.25, gain: 0.07, attack: 0.04 });
  }

  // ---------- 몸 ----------
  step(heavy = false) {
    this._burst({ filter: 'lowpass', f0: 650, dur: 0.1, gain: heavy ? 0.16 : 0.1 });
    this._burst({ filter: 'highpass', f0: 2600, dur: 0.05, gain: 0.035, when: 0.01 });
  }

  _startBreath() {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 850;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start();
    this._loopNoise().connect(bp).connect(g).connect(this.sfx);
    this._breath = { g, lfo, lfoG, bp };
  }

  // level 0~3: 0은 안 들림, 3은 헐떡임
  setBreath(level) {
    const b = this._breath;
    if (!b) return;
    const depth = [0, 0.035, 0.075, 0.15][level] ?? 0.15;
    const rate = [0.3, 0.3, 0.45, 0.85][level] ?? 0.85;
    b.g.gain.setTargetAtTime(depth, this.now, 0.8);
    b.lfoG.gain.setTargetAtTime(depth, this.now, 0.8);
    b.lfo.frequency.setTargetAtTime(rate, this.now, 1.5);
    b.bp.frequency.setTargetAtTime(700 + level * 180, this.now, 1);
  }

  thud() {
    this._burst({ type: 'sine', f0: 95, f1: 36, dur: 0.4, gain: 0.7 });
    this._burst({ filter: 'lowpass', f0: 320, dur: 0.22, gain: 0.3 });
  }

  // 쓰러진 뒤 귀에서 나는 삐 소리
  ring(sec) {
    const o = this.ctx.createOscillator();
    o.frequency.value = 6100;
    const g = this.ctx.createGain();
    const t = this.now;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + sec);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + sec + 0.1);
  }

  // ---------- 행인 ----------
  // 등 뒤에서 나는 헉 소리와 나뭇가지 밟는 소리
  gasp(x, y, z) {
    const out = this._panner(x, y, z, 3, 1);
    out.connect(this.sfx);
    this._burst({ filter: 'highpass', f0: 2200, dur: 0.07, gain: 0.5, out });
    this._burst({ filter: 'bandpass', f0: 1500, f1: 2900, q: 2, dur: 0.32, gain: 0.5, attack: 0.08, out, when: 0.18 });
  }

  // 달아나면서 지르는 짧은 비명과 빠른 발소리
  yelp(x, y, z) {
    const out = this._panner(x, y, z, 3, 1);
    out.connect(this.sfx);
    this._burst({ type: 'sawtooth', f0: 420, f1: 980, dur: 0.28, gain: 0.22, attack: 0.02, out });
    this._burst({ filter: 'bandpass', f0: 1800, f1: 3200, q: 3, dur: 0.3, gain: 0.3, out });
    for (let i = 0; i < 14; i++) this._burst({ filter: 'lowpass', f0: 700, dur: 0.07, gain: 0.3 * (1 - i / 16), out, when: 0.25 + i * 0.13 });
  }

  // ---------- 괴물 ----------
  startMonster(x, y, z) {
    if (this.monster) return;
    const ctx = this.ctx;
    const p = this._panner(x, y, z, 5, 1);
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    for (const f of [49, 52.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const dg = ctx.createGain();
    dg.gain.value = 0.5;
    lp.connect(dg).connect(g);
    // 매미 울음을 아주 느리게 돌리면 덜그럭거리는 소리가 돼요.
    const r = ctx.createBufferSource();
    r.buffer = this.cicadaBuf;
    r.loop = true;
    r.playbackRate.value = 0.16;
    const rg = ctx.createGain();
    rg.gain.value = 1.4;
    r.connect(rg).connect(g);
    r.start();
    g.connect(p).connect(this.sfx);
    this.monster = { p, g, r };
    g.gain.setTargetAtTime(0.5, this.now, 2);
  }

  setMonster(x, y, z, stage) {
    const m = this.monster;
    if (!m) return;
    this._setPannerPos(m.p, x, y, z);
    m.g.gain.setTargetAtTime(0.5 + stage * 0.35, this.now, 0.3);
    m.r.playbackRate.setTargetAtTime(0.16 + stage * 0.05, this.now, 0.3);
  }

  stopMonster(sec = 0.5) {
    if (!this.monster) return;
    this.monster.g.gain.setTargetAtTime(0, this.now, sec / 3);
  }

  stageHit() {
    this._burst({ type: 'sine', f0: 72, f1: 27, dur: 0.7, gain: 0.8 });
    this._burst({ filter: 'bandpass', f0: 1800, f1: 300, q: 1.5, dur: 0.5, gain: 0.3 });
    this._burst({ filter: 'highpass', f0: 4200, dur: 0.18, gain: 0.12, when: 0.05 });
  }

  // ---------- 장막, 막 ----------
  setWet(on) {
    if (on && !this._wet) {
      const ctx = this.ctx;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.7;
      const lg = ctx.createGain();
      lg.gain.value = 180;
      lfo.connect(lg).connect(lp.frequency);
      lfo.start();
      const g = ctx.createGain();
      g.gain.value = 0;
      this._loopNoise().connect(lp).connect(g).connect(this.sfx);
      g.gain.setTargetAtTime(0.35, this.now, 0.3);
      this._wet = { g };
    } else if (!on && this._wet) {
      this._wet.g.gain.setTargetAtTime(0, this.now, 0.4);
      this._wet = null;
    }
  }

  tear() {
    this._burst({ filter: 'bandpass', f0: 320, f1: 3600, q: 2.5, dur: 0.75, gain: 0.45, attack: 0.03 });
    this._burst({ filter: 'lowpass', f0: 500, dur: 0.5, gain: 0.3, when: 0.1 });
  }

  // ---------- 곡 ----------
  // 엔딩 곡은 파일을 통째로 받아 풀어 두었다가 틀어요.
  // <audio> 태그는 아이폰에서 음량 조절이 안 되고 마지막 터치에서 한참 지나면 재생이 막혀서 쓰지 않아요.
  async _prepSong() {
    try {
      const r = await fetch(this.cfg.song.file);
      if (!r.ok) return;
      const data = await r.arrayBuffer();
      this.songBuf = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
      this.songOk = true;
    } catch { this.songOk = false; }
  }

  // 곡에서 쓰는 구간의 길이(초). 곡이 없으면 0.
  get songLength() {
    return this.songOk ? Math.max(0, this.songBuf.duration - (this.cfg.song.from || 0)) : 0;
  }

  // 곡이 시작된 뒤 흐른 시간(초). 일시정지하면 같이 멈춰요.
  get songTime() {
    return this.songT0 == null ? -1 : this.now - this.songT0;
  }

  playSong() {
    this.fadeWorld(0, 2);
    this.sfx.gain.setTargetAtTime(0.2, this.now, 1.2);
    if (!this.songOk || this.songT0 != null) return this.songOk;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), t = this.now + 0.05;
    src.buffer = this.songBuf;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + (this.cfg.song.fadeIn ?? 1));
    src.connect(g); g.connect(this.ctx.destination);
    src.start(t, this.cfg.song.from || 0);
    this.songT0 = t;
    return true;
  }
}
