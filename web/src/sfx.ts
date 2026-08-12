// 程序化音效：用 Web Audio API 实时合成短音效。地图氛围音默认也为程序化合成；
// 个别地图（如盘丝洞）改用真实音频文件循环播放（见 MAP_BGM）——Web 端 fetch+decodeAudioData，
// 微信端暂无本地文件 fetch，回退到程序化氛围。
// 设计：引擎(battle)只发语义事件名，本模块把事件映射为合成声音；浏览器要求用户手势后才能出声。
// 静音状态持久化（跨平台存储）。
import { storeGet, storeSet } from './storage';
import { createAudioContext, isWeChat } from './platform';
import { ASSET_URLS } from '@asset-manifest';

const MUTE_KEY = 'dasheng.mute';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false; // 总静音（音效+音乐），默认关（即有声）
let musicEnabled = true;
let sfxEnabled = true;
let musicVolume = 0.7;
let sfxVolume = 0.8;
muted = storeGet(MUTE_KEY) === '1';

// 首个用户手势后调用：创建/恢复 AudioContext（浏览器自动播放策略要求）
export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = createAudioContext(); // 平台适配：Web=AudioContext，微信=wx.createWebAudioContext()
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0;
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
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0, ctx.currentTime, 0.05);
  return muted;
}

// 背景音乐开关（由设置页持久化）
export function isMusicOn(): boolean {
  return musicEnabled;
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

// 单个音符：振荡器 + 增益包络（可选频率滑动）
function tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; to?: number; delay?: number } = {}): void {
  if (!ctx || !master || sfxVolume <= 0) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
  const peak = Math.max(0.0001, (opts.gain ?? 0.25) * sfxVolume);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// 噪声爆发（命中/爆炸/挖掘）
function noise(dur: number, opts: { gain?: number; hp?: number; lp?: number; delay?: number } = {}): void {
  if (!ctx || !master || sfxVolume <= 0) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = (opts.gain ?? 0.2) * sfxVolume;
  let node: AudioNode = src;
  if (opts.hp != null) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; node.connect(f); node = f; }
  if (opts.lp != null) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

let lastAttack = 0; // 攻击音节流，避免密集刷屏

// 事件 → 声音映射
export function playSfx(name: string): void {
  if (muted || !sfxEnabled || sfxVolume <= 0 || !ctx) return;
  try {
  switch (name) {
    case 'click': tone(660, 0.06, { type: 'square', gain: 0.14 }); break;
    case 'summon': tone(320, 0.18, { type: 'sine', to: 760, gain: 0.22 }); tone(480, 0.14, { type: 'triangle', gain: 0.12, delay: 0.04 }); break;
    case 'place': tone(520, 0.05, { type: 'square', gain: 0.14 }); tone(196, 0.07, { type: 'sine', gain: 0.1, delay: 0.02 }); break;
    case 'merge': tone(660, 0.07, { type: 'triangle', gain: 0.18 }); tone(990, 0.1, { type: 'triangle', gain: 0.16, delay: 0.06 }); break;
    // 一铲落地：沙土噪声 + 短促闷击（挖坑动画每铲各播一次）
    case 'shovel':
      noise(0.1, { gain: 0.18, hp: 280, lp: 2400 });
      tone(160, 0.05, { type: 'triangle', to: 70, gain: 0.1 });
      break;
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
  } catch { /* 音频图异常不应阻断 UI */ }
}

// —— 背景音乐（每张地图各一首真实音频循环）——
// 程序化合成的氛围旋律已移除；各地图 BGM 一律走文件（见 MAP_BGM）。音效仍为实时合成（见上）。

let ambientNodes: { stop?: () => void; node: AudioNode }[] = [];
let ambientTimers: number[] = [];
let ambientMap = '';

// —— 文件 BGM（真实音频循环）——
// 指定地图 → 资源清单里的音频 key。这些地图用真实音频循环，替代程序化氛围旋律。
// 循环平滑：各 bgm 文件已在离线裁剪时烘焙淡入/淡出（结尾数秒渐弱），循环接缝不突兀。
const MAP_BGM: Record<string, string> = {
  huoyanshan: 'bgm-huoyanshan',
  liushahe: 'bgm-liushahe',
  baiguling: 'bgm-baiguling',
  pansidong: 'bgm-pansidong',
};
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
export function applyAudioVolumes(
  music: number,
  sfx: number,
  opts?: { musicEnabled?: boolean; sfxEnabled?: boolean },
): void {
  musicVolume = Math.max(0, Math.min(1, music));
  sfxVolume = Math.max(0, Math.min(1, sfx));
  if (opts?.musicEnabled !== undefined) musicEnabled = opts.musicEnabled;
  if (opts?.sfxEnabled !== undefined) sfxEnabled = opts.sfxEnabled;
  if (master && ctx) {
    master.gain.setTargetAtTime(muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0, ctx.currentTime, 0.05);
  }
  if (!ctx) return;
  const mg = musicEnabled && !muted && musicVolume > 0 ? 0.5 * musicVolume : 0;
  for (const a of ambientNodes) {
    if (a.node instanceof GainNode) {
      a.node.gain.setTargetAtTime(mg, ctx.currentTime, 0.05);
    }
  }
  if (!musicEnabled || musicVolume <= 0) stopAmbient();
  else if (musicEnabled && ambientMap === MENU_ID) startMenuMusic();
}

export function getMusicVolume(): number { return musicVolume; }
export function getSfxVolume(): number { return sfxVolume; }

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
  g.gain.value = 0.5 * musicVolume;
  g.connect(master);
  ambientNodes.push({ node: g });
  const cached = bgmBuffers[url];
  if (cached) { startBgmLoop(cached, g); return; }
  void decodeBgm(url).then((buf) => {
    if (buf && ctx && musicEnabled && ambientMap === mapId) startBgmLoop(buf, g);
  });
}

export function stopAmbient(): void {
  for (const id of ambientTimers) clearInterval(id);
  ambientTimers = [];
  for (const a of ambientNodes) { try { a.stop?.(); a.node.disconnect(); } catch { /* ignore */ } }
  ambientNodes = [];
  ambientMap = '';
}

// 启动某地图的背景音乐（幂等：同图不重启）。各地图一首真实音频循环；Web 端 fetch 播放，
// 微信端无本地 fetch 则静音（合成氛围音已移除）。
export function startAmbient(mapId: string): void {
  if (!ctx || !master || !musicEnabled || musicVolume <= 0) return; // 背景音乐关闭时不播放（音效仍正常）
  if (ambientMap === mapId && ambientNodes.length) return;
  stopAmbient();
  ambientMap = mapId;
  const bgmKey = MAP_BGM[mapId];
  if (bgmKey && !isWeChat && ASSET_URLS[bgmKey]) startFileBgm(mapId, ASSET_URLS[bgmKey]!);
}

// 首页背景音乐（真实音频循环）。幂等：同一 id 且已有节点时不重启。Web 端可 fetch；微信端无本地
// fetch，首页保持静音（原本也无首页音乐）。循环音量渐变由文件烘焙的淡入/淡出保证。
export function startMenuMusic(): void {
  if (!ctx || !master || !musicEnabled || musicVolume <= 0) return;
  if (isWeChat || !ASSET_URLS[MENU_BGM_KEY]) return;
  if (ambientMap === MENU_ID && ambientNodes.length) return;
  stopAmbient();
  ambientMap = MENU_ID;
  startFileBgm(MENU_ID, ASSET_URLS[MENU_BGM_KEY]!);
}

/** 预载首页 BGM；需在 initAudio 之后调用 */
export function prefetchMenuBgm(): Promise<void> {
  if (isWeChat || !ASSET_URLS[MENU_BGM_KEY]) return Promise.resolve();
  initAudio();
  if (!ctx) return Promise.resolve();
  return decodeBgm(ASSET_URLS[MENU_BGM_KEY]!).then(() => undefined);
}

/** 启动时/回前台：恢复 AudioContext 并尝试播首页音乐（可能被浏览器策略拦截，首击仍会 resume） */
export async function bootstrapMenuMusic(): Promise<void> {
  if (!musicEnabled) return;
  initAudio();
  if (!ctx || !master) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* 无用户手势时保持 suspended，等首次点击 */ }
  }
  if (ctx.state === 'running') startMenuMusic();
}

/** 用户手势后：恢复音频并续播当前界面 BGM */
export function resumeAudioAfterGesture(screen: 'menu' | 'battle' | 'other', mapId?: string): void {
  initAudio();
  if (!ctx || ctx.state === 'suspended') {
    void ctx?.resume().then(() => {
      if (!musicEnabled || !ctx || ctx.state !== 'running') return;
      if (screen === 'menu') startMenuMusic();
      else if (screen === 'battle' && mapId) startAmbient(mapId);
    });
    return;
  }
  if (!musicEnabled) return;
  if (screen === 'menu') startMenuMusic();
  else if (screen === 'battle' && mapId) startAmbient(mapId);
}
