// 程序化音效：用 Web Audio API 实时合成短音效（无任何外部/版权音频文件）。
// 设计：引擎(battle)只发语义事件名，本模块把事件映射为合成声音；浏览器要求用户手势后才能出声。
// 静音状态持久化到 localStorage。

const MUTE_KEY = 'dasheng.mute';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }

// 首个用户手势后调用：创建/恢复 AudioContext（浏览器自动播放策略要求）
export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function isMuted(): boolean {
  return muted;
}
export function toggleMute(): boolean {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

// 单个音符：振荡器 + 增益包络（可选频率滑动）
function tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; to?: number; delay?: number } = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
  const peak = opts.gain ?? 0.25;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// 噪声爆发（命中/爆炸/挖掘）
function noise(dur: number, opts: { gain?: number; hp?: number; lp?: number; delay?: number } = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 0.2;
  let node: AudioNode = src;
  if (opts.hp != null) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; node.connect(f); node = f; }
  if (opts.lp != null) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

let lastAttack = 0; // 攻击音节流，避免密集刷屏

// 事件 → 声音映射
export function playSfx(name: string): void {
  if (muted || !ctx) return;
  switch (name) {
    case 'click': tone(660, 0.06, { type: 'square', gain: 0.14 }); break;
    case 'summon': tone(320, 0.18, { type: 'sine', to: 760, gain: 0.22 }); tone(480, 0.14, { type: 'triangle', gain: 0.12, delay: 0.04 }); break;
    case 'place': tone(520, 0.05, { type: 'square', gain: 0.14 }); break;
    case 'merge': tone(660, 0.07, { type: 'triangle', gain: 0.18 }); tone(990, 0.1, { type: 'triangle', gain: 0.16, delay: 0.06 }); break;
    case 'shovel': noise(0.12, { gain: 0.16, hp: 300, lp: 2200 }); break;
    case 'attack': {
      const now = performance.now();
      if (now - lastAttack < 80) return; // 节流
      lastAttack = now;
      tone(820, 0.03, { type: 'triangle', gain: 0.06 });
      break;
    }
    case 'kill': noise(0.14, { gain: 0.18, hp: 200, lp: 3000 }); break;
    case 'bosskill': noise(0.3, { gain: 0.26, lp: 1400 }); tone(120, 0.32, { type: 'sine', to: 60, gain: 0.24 }); break;
    case 'general': tone(523, 0.1, { type: 'triangle', gain: 0.2 }); tone(784, 0.14, { type: 'triangle', gain: 0.18, delay: 0.07 }); tone(1046, 0.16, { type: 'sine', gain: 0.14, delay: 0.14 }); break;
    case 'ult': tone(900, 0.5, { type: 'sawtooth', to: 120, gain: 0.24 }); noise(0.5, { gain: 0.2, lp: 2000 }); break;
    case 'palm': noise(0.4, { gain: 0.22, hp: 400, lp: 6000 }); break;
    case 'wave': tone(196, 0.22, { type: 'sawtooth', gain: 0.2 }); tone(294, 0.2, { type: 'sawtooth', gain: 0.14, delay: 0.05 }); break;
    case 'hurt': tone(180, 0.16, { type: 'square', to: 90, gain: 0.22 }); break;
    case 'item': tone(700, 0.09, { type: 'triangle', gain: 0.18 }); tone(1050, 0.12, { type: 'sine', gain: 0.14, delay: 0.07 }); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.2, delay: i * 0.12 })); break;
    case 'lose': [392, 311, 233].forEach((f, i) => tone(f, 0.26, { type: 'sawtooth', gain: 0.2, delay: i * 0.14 })); break;
    case 'danger': tone(880, 0.1, { type: 'square', gain: 0.14 }); tone(880, 0.1, { type: 'square', gain: 0.14, delay: 0.16 }); break;
  }
}

// —— 背景氛围音（每张地图不同风格；纯合成 drone/纹理，音量很低）——
interface AmbientCfg {
  chord: number[]; // 低频和弦
  wave: Wave;
  drone: number; // drone 增益
  texture?: 'wind' | 'stream' | 'hollow'; // 连续纹理
  texFreq?: number;
  texGain?: number;
  crackle?: boolean; // 偶发点缀（火焰噼啪/丝语）
  crackleMs?: number;
  crackleHp?: number;
  crackleLp?: number;
}
const AMBIENT: Record<string, AmbientCfg> = {
  huoyanshan: { chord: [55, 82.4], wave: 'sine', drone: 0.5, crackle: true, crackleMs: 650, crackleHp: 1400, crackleLp: 5000 },
  liushahe: { chord: [65.4, 98], wave: 'sine', drone: 0.45, texture: 'stream', texFreq: 900, texGain: 0.5 },
  baiguling: { chord: [49, 58.3], wave: 'triangle', drone: 0.5, texture: 'hollow', texFreq: 320, texGain: 0.4 },
  pansidong: { chord: [73.4, 110, 146.8], wave: 'sine', drone: 0.4, crackle: true, crackleMs: 1300, crackleHp: 4000, crackleLp: 9000 },
};

let ambientNodes: { stop?: () => void; node: AudioNode }[] = [];
let ambientTimer: number | null = null;
let ambientMap = '';

export function stopAmbient(): void {
  if (ambientTimer != null) { clearInterval(ambientTimer); ambientTimer = null; }
  for (const a of ambientNodes) { try { a.stop?.(); a.node.disconnect(); } catch { /* ignore */ } }
  ambientNodes = [];
  ambientMap = '';
}

// 启动某地图的氛围音（幂等：同图不重启）
export function startAmbient(mapId: string): void {
  if (!ctx || !master) return;
  if (ambientMap === mapId && ambientNodes.length) return;
  stopAmbient();
  ambientMap = mapId;
  const cfg = AMBIENT[mapId] ?? AMBIENT.huoyanshan!;
  const bus = ctx.createGain();
  bus.gain.value = 0.1; // 氛围整体很轻
  bus.connect(master);
  ambientNodes.push({ node: bus });
  // 低频和弦 drone + 慢速颤音
  for (const f of cfg.chord) {
    const o = ctx.createOscillator(); o.type = cfg.wave; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = cfg.drone;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.1 + Math.random() * 0.12;
    const lg = ctx.createGain(); lg.gain.value = cfg.drone * 0.5;
    lfo.connect(lg); lg.connect(og.gain);
    o.connect(og); og.connect(bus);
    o.start(); lfo.start();
    ambientNodes.push({ node: o, stop: () => o.stop() }, { node: og }, { node: lfo, stop: () => lfo.stop() }, { node: lg });
  }
  // 连续纹理（风/流水/空洞）：循环噪声 + 带通
  if (cfg.texture) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cfg.texFreq ?? 800; bp.Q.value = 0.6;
    const tg = ctx.createGain(); tg.gain.value = cfg.texGain ?? 0.4;
    src.connect(bp); bp.connect(tg); tg.connect(bus);
    src.start();
    ambientNodes.push({ node: src, stop: () => src.stop() }, { node: bp }, { node: tg });
  }
  // 偶发点缀（火焰噼啪 / 盘丝洞丝语）
  if (cfg.crackle) {
    ambientTimer = window.setInterval(() => {
      if (!muted && ctx) noise(0.07, { gain: 0.05, hp: cfg.crackleHp ?? 1500, lp: cfg.crackleLp ?? 5000 });
    }, cfg.crackleMs ?? 800);
  }
}
