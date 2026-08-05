// 程序化音效：用 Web Audio API 实时合成短音效。地图氛围音默认也为程序化合成；
// 个别地图（如盘丝洞）改用真实音频文件循环播放（见 MAP_BGM）——Web 端 fetch+decodeAudioData，
// 微信端暂无本地文件 fetch，回退到程序化氛围。
// 设计：引擎(battle)只发语义事件名，本模块把事件映射为合成声音；浏览器要求用户手势后才能出声。
// 静音状态持久化（跨平台存储）。
import { storeGet, storeSet } from './storage';
import { createAudioContext, isWeChat } from './platform';
import { ASSET_URLS } from '@asset-manifest';

const MUTE_KEY = 'dasheng.mute';
const MUSIC_KEY = 'dasheng.music';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false; // 总静音（音效+音乐），默认关（即有声）
let musicOn = false; // 背景音乐默认关闭；攻击等音效不受此开关影响
muted = storeGet(MUTE_KEY) === '1';
musicOn = storeGet(MUSIC_KEY) === '1';

// 首个用户手势后调用：创建/恢复 AudioContext（浏览器自动播放策略要求）
export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = createAudioContext(); // 平台适配：Web=AudioContext，微信=wx.createWebAudioContext()
    if (!ctx) return;
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
  try { storeSet(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
}

// 背景音乐（地图氛围音）开关，独立于音效；默认关闭
export function isMusicOn(): boolean {
  return musicOn;
}
export function toggleMusic(): boolean {
  musicOn = !musicOn;
  try { storeSet(MUSIC_KEY, musicOn ? '1' : '0'); } catch { /* ignore */ }
  if (!musicOn) stopAmbient(); // 关闭立即停；开启由对战循环里的 startAmbient 幂等拉起
  return musicOn;
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

// —— 背景氛围音（每张地图不同风格：五声音阶旋律 + 低频和弦垫底 + 连续纹理）——
// 全部用 Web Audio 实时合成，无任何音频文件。旋律用「预约调度器」提前排好每个音符的起始时刻，
// 保证节奏精准；音色分 古筝(拨弦)/箫(长音)/钟(空灵) 三种。

// 中国五声音阶：以主音为 0 的半音偏移（宫商角徵羽 = do re mi sol la 的不同调式）
const PENTA = {
  gong: [0, 2, 4, 7, 9], // 宫调式：明亮、大调感
  zhi: [0, 2, 5, 7, 9], // 徵调式：流畅、清亮
  yu: [0, 3, 5, 7, 10], // 羽调式：偏小调、苍凉
  jue: [0, 4, 5, 7, 11], // 角调式：空灵、悬疑
  shang: [0, 2, 5, 7, 10], // 商调式：古朴、神秘
} as const;

type Voice = 'zheng' | 'flute' | 'bell';

interface AmbientCfg {
  // —— 低频和弦垫底（pad）——
  chord: number[]; // 和弦频率（低八度）
  chordWave: Wave;
  chordGain: number; // 每个和弦音的增益
  // —— 五声旋律 ——
  root: number; // 主音频率（Hz）
  scale: readonly number[]; // 音阶（PENTA.*）
  octaves: number; // 旋律跨越的八度数
  bpm: number; // 速度（每分钟拍数）
  voice: Voice; // 旋律音色
  density: number; // 每拍出音概率（0..1，越低越空灵）
  melGain: number; // 旋律音量
  // —— 连续纹理（风/流水/空洞）——
  texture?: 'stream' | 'hollow';
  texFreq?: number;
  texGain?: number;
  // —— 偶发点缀（火焰噼啪/丝语）——
  crackle?: boolean;
  crackleMs?: number;
  crackleHp?: number;
  crackleLp?: number;
}

const AMBIENT: Record<string, AmbientCfg> = {
  // 火焰山：苍凉厚重，羽调式慢古筝，低沉和弦
  huoyanshan: {
    chord: [110, 164.8], chordWave: 'sine', chordGain: 0.08,
    root: 220, scale: PENTA.yu, octaves: 2, bpm: 60, voice: 'zheng', density: 0.5, melGain: 0.2,
    crackle: true, crackleMs: 900, crackleHp: 1400, crackleLp: 5000,
  },
  // 流沙河：流畅温和，徵调式箫声 + 流水纹理
  liushahe: {
    chord: [130.8, 196], chordWave: 'sine', chordGain: 0.07,
    root: 261.6, scale: PENTA.zhi, octaves: 2, bpm: 76, voice: 'flute', density: 0.62, melGain: 0.16,
    texture: 'stream', texFreq: 900, texGain: 0.05,
  },
  // 白骨岭：空灵幽冷，角调式钟音，稀疏 + 空洞纹理
  baiguling: {
    chord: [98, 130.8], chordWave: 'triangle', chordGain: 0.07,
    root: 293.7, scale: PENTA.jue, octaves: 2, bpm: 52, voice: 'bell', density: 0.32, melGain: 0.16,
    texture: 'hollow', texFreq: 300, texGain: 0.045,
  },
  // 盘丝洞：诡异神秘，商调式快古筝 + 丝语点缀
  pansidong: {
    chord: [146.8, 220, 293.7], chordWave: 'sine', chordGain: 0.06,
    root: 329.6, scale: PENTA.shang, octaves: 2, bpm: 88, voice: 'zheng', density: 0.55, melGain: 0.17,
    crackle: true, crackleMs: 1300, crackleHp: 4000, crackleLp: 9000,
  },
};

// 从主音+音阶展开成多八度的频率表
function buildScale(root: number, semis: readonly number[], octaves: number): number[] {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const s of semis) out.push(root * Math.pow(2, o + s / 12));
  }
  return out;
}

// 单个旋律音符：按音色合成，连到指定输出节点（dest），在绝对时刻 t0 起音
function noteVoice(freq: number, dur: number, kind: Voice, gain: number, t0: number, dest: AudioNode): void {
  if (!ctx) return;
  if (kind === 'flute') {
    // 箫/笛：正弦 + 慢起音 + 颤音，气声柔和
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5;
    const vg = ctx.createGain(); vg.gain.value = freq * 0.006; // 颤音深度
    vib.connect(vg); vg.connect(osc.frequency); vib.start(t0); vib.stop(t0 + dur + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.09);
    g.gain.setValueAtTime(gain, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(dest);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  } else if (kind === 'bell') {
    // 钟/磬：多个非整数泛音，快起音长衰减，金属空灵
    [1, 2.01, 3.02].forEach((mul, i) => {
      const osc = ctx!.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * mul;
      const g = ctx!.createGain(); const peak = gain * (i === 0 ? 1 : 0.28 / i);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (i === 0 ? 1 : 0.6));
      osc.connect(g); g.connect(dest);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    });
  } else {
    // 古筝/琵琶：锯齿基频 + 八度泛音，经低通「拨弦即亮、随即变暗」
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    const oct = ctx.createOscillator(); oct.type = 'triangle'; oct.frequency.value = freq * 2;
    const octG = ctx.createGain(); octG.gain.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(6000, freq * 6), t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 1.5), t0 + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008); // 极快起音=拨弦
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); oct.connect(octG); octG.connect(g); g.connect(lp); lp.connect(dest);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    oct.start(t0); oct.stop(t0 + dur + 0.05);
  }
}

let ambientNodes: { stop?: () => void; node: AudioNode }[] = [];
let ambientTimers: number[] = [];
let ambientMap = '';

// —— 文件 BGM（真实音频循环）——
// 指定地图 → 资源清单里的音频 key。这些地图用真实音频循环，替代程序化氛围旋律。
// 循环平滑：各 bgm 文件已在离线裁剪时烘焙淡入/淡出（结尾数秒渐弱），循环接缝不突兀。
const MAP_BGM: Record<string, string> = { pansidong: 'bgm-pansidong', huoyanshan: 'bgm-huoyanshan' };
const MENU_BGM_KEY = 'bgm-menu'; // 首页背景音乐
const MENU_ID = '__menu'; // ambientMap 的首页占位 id（区别于地图 id）
const bgmBuffers: Record<string, AudioBuffer> = {}; // 已解码缓存，键为 URL
const bgmDecoding: Record<string, Promise<AudioBuffer | null>> = {}; // 解码中的去重

// 拉取并解码音频文件（web）。用回调式 decodeAudioData 以兼容旧 Safari；结果按 URL 缓存。
function decodeBgm(url: string): Promise<AudioBuffer | null> {
  if (bgmBuffers[url]) return Promise.resolve(bgmBuffers[url]!);
  if (url in bgmDecoding) return bgmDecoding[url]!;
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then(
      (ab) =>
        new Promise<AudioBuffer | null>((res) => {
          if (!ctx) { res(null); return; }
          ctx.decodeAudioData(ab, (b) => { bgmBuffers[url] = b; res(b); }, () => res(null));
        }),
    )
    .catch(() => null);
  bgmDecoding[url] = p;
  return p;
}

// 用已解码的 buffer 起一个循环源，接到给定增益节点（该节点已入 ambientNodes，随 stopAmbient 清理）。
function startBgmLoop(buffer: AudioBuffer, out: GainNode): void {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(out);
  src.start();
  ambientNodes.push({ node: src, stop: () => { try { src.stop(); } catch { /* ignore */ } } });
}

// 文件 BGM 启动：先放占位增益节点（使 startAmbient 幂等守卫在异步解码期间命中，避免每帧重复触发），
// 解码完成后若仍停留在该地图且音乐未关，再挂上循环源。
function startFileBgm(mapId: string, url: string): void {
  if (!ctx || !master) return;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  g.connect(master);
  ambientNodes.push({ node: g });
  const cached = bgmBuffers[url];
  if (cached) { startBgmLoop(cached, g); return; }
  void decodeBgm(url).then((buf) => {
    if (buf && ctx && musicOn && ambientMap === mapId) startBgmLoop(buf, g);
  });
}

export function stopAmbient(): void {
  for (const id of ambientTimers) clearInterval(id);
  ambientTimers = [];
  for (const a of ambientNodes) { try { a.stop?.(); a.node.disconnect(); } catch { /* ignore */ } }
  ambientNodes = [];
  ambientMap = '';
}

// 启动某地图的氛围音（幂等：同图不重启）
export function startAmbient(mapId: string): void {
  if (!ctx || !master || !musicOn) return; // 背景音乐关闭时不播放（音效仍正常）
  if (ambientMap === mapId && ambientNodes.length) return;
  stopAmbient();
  ambientMap = mapId;

  // 文件 BGM 优先（如盘丝洞用真实音频循环）：Web 端可 fetch 本地资源；微信端无 fetch，回退到下方程序化氛围。
  const bgmKey = MAP_BGM[mapId];
  if (bgmKey && !isWeChat && ASSET_URLS[bgmKey]) {
    startFileBgm(mapId, ASSET_URLS[bgmKey]!);
    return; // 用文件 BGM，不再叠加合成旋律
  }

  const cfg = AMBIENT[mapId] ?? AMBIENT.huoyanshan!;
  const bus = ctx.createGain();
  bus.gain.value = 0.5; // 氛围总线（旋律/和弦/纹理都汇入这里，再进 master）
  bus.connect(master);
  ambientNodes.push({ node: bus });

  // 低频和弦 drone + 慢速颤音（垫底）
  for (const f of cfg.chord) {
    const o = ctx.createOscillator(); o.type = cfg.chordWave; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = cfg.chordGain;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.08 + Math.random() * 0.1;
    const lg = ctx.createGain(); lg.gain.value = cfg.chordGain * 0.5;
    lfo.connect(lg); lg.connect(og.gain);
    o.connect(og); og.connect(bus);
    o.start(); lfo.start();
    ambientNodes.push({ node: o, stop: () => o.stop() }, { node: og }, { node: lfo, stop: () => lfo.stop() }, { node: lg });
  }

  // 五声旋律：预约调度器（每 60ms 检查一次，把 lookahead 秒内的音符提前排好）
  const melBus = ctx.createGain(); melBus.gain.value = 1;
  melBus.connect(bus);
  ambientNodes.push({ node: melBus });
  const scale = buildScale(cfg.root, cfg.scale, cfg.octaves);
  const beat = 60 / cfg.bpm;
  let idx = Math.floor(scale.length / 2); // 从音阶中部起步
  let nextTime = ctx.currentTime + 0.15;
  const lookahead = 0.25;
  const melTimer = window.setInterval(() => {
    if (muted || !ctx) return;
    while (nextTime < ctx.currentTime + lookahead) {
      if (Math.random() < cfg.density) {
        // 小步随机游走：多为 ±1/±2 级，偶尔停在原地，保证悦耳不跳脱
        const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]!;
        idx = Math.max(0, Math.min(scale.length - 1, idx + step));
        const dur = beat * ([1, 1, 2][Math.floor(Math.random() * 3)]!);
        const vel = cfg.melGain * (0.8 + Math.random() * 0.3); // 轻微力度变化
        noteVoice(scale[idx]!, dur * 0.95, cfg.voice, vel, nextTime, melBus);
      }
      nextTime += beat;
    }
  }, 60);
  ambientTimers.push(melTimer);

  // 连续纹理（流水/空洞）：循环噪声 + 带通
  if (cfg.texture) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cfg.texFreq ?? 800; bp.Q.value = 0.6;
    const tg = ctx.createGain(); tg.gain.value = cfg.texGain ?? 0.05;
    src.connect(bp); bp.connect(tg); tg.connect(bus);
    src.start();
    ambientNodes.push({ node: src, stop: () => src.stop() }, { node: bp }, { node: tg });
  }

  // 偶发点缀（火焰噼啪 / 盘丝洞丝语）
  if (cfg.crackle) {
    const crackleTimer = window.setInterval(() => {
      if (!muted && ctx) noise(0.07, { gain: 0.05, hp: cfg.crackleHp ?? 1500, lp: cfg.crackleLp ?? 5000 });
    }, cfg.crackleMs ?? 800);
    ambientTimers.push(crackleTimer);
  }
}

// 首页背景音乐（真实音频循环）。幂等：同一 id 且已有节点时不重启。Web 端可 fetch；微信端无本地
// fetch，首页保持静音（原本也无首页音乐）。循环音量渐变由文件烘焙的淡入/淡出保证。
export function startMenuMusic(): void {
  if (!ctx || !master || !musicOn) return;
  if (isWeChat || !ASSET_URLS[MENU_BGM_KEY]) return;
  if (ambientMap === MENU_ID && ambientNodes.length) return;
  stopAmbient();
  ambientMap = MENU_ID;
  startFileBgm(MENU_ID, ASSET_URLS[MENU_BGM_KEY]!);
}
