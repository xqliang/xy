// 水墨风昵称编辑层：Web 用 HTML 浮层；无 DOM 环境回退 prompt。
import { isWeChat } from './platform';
import { clampNickname, NICKNAME_MAX_WEIGHT, nicknameWeight } from './nickname';

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROOT_ID = 'xy-nick-editor';

let open = false;

function removeDom(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(ROOT_ID)?.remove();
}

export function closeNicknameEditor(): void {
  removeDom();
  open = false;
}

function styleRoot(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(28, 22, 16, 0.48)',
    fontFamily: '"PingFang SC", "STKaiti", "Songti SC", serif',
  });
}

function inkButton(label: string, tone: 'primary' | 'secondary'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const primary = tone === 'primary';
  Object.assign(btn.style, {
    flex: '1',
    height: '44px',
    border: '1.5px solid rgba(255, 220, 160, 0.55)',
    borderRadius: '12px',
    cursor: 'pointer',
    font: 'bold 16px "PingFang SC", "STKaiti", serif',
    color: primary ? '#fff8ee' : '#fff4e0',
    background: primary
      ? 'linear-gradient(180deg, #b5381f 0%, #8a2810 100%)'
      : 'linear-gradient(180deg, rgba(55,32,14,0.72) 0%, rgba(45,28,12,0.82) 100%)',
    boxShadow: '0 2px 0 rgba(40, 24, 12, 0.25)',
  });
  return btn;
}

/**
 * 打开昵称编辑。onDone(null) = 取消；onDone(string) = 确认（可为空串表示清空）。
 */
export function openNicknameEditor(current: string, onDone: (next: string | null) => void): void {
  if (open) return;

  // 微信小游戏：无 DOM 浮层，用 wx.showModal 的可编辑输入框（editable:true 显示文本框，content 预填当前昵称）。
  if (isWeChat) {
    open = true;
    if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
      wx.showModal({
        title: '修改昵称',
        editable: true,
        placeholderText: `可留空，最多约 ${NICKNAME_MAX_WEIGHT / 2} 个汉字`,
        content: current,
        success: (res: { confirm?: boolean; content?: string }) => {
          open = false;
          onDone(res && res.confirm ? clampNickname((res.content ?? '').trim()) : null);
        },
        fail: () => { open = false; onDone(null); },
      });
    } else {
      open = false;
      onDone(null);
    }
    return;
  }

  // 非浏览器环境（测试/SSR，无 wx 无 document）：回退 prompt
  if (typeof document === 'undefined') {
    const raw =
      typeof window !== 'undefined' && typeof window.prompt === 'function'
        ? window.prompt(`设置昵称（可留空，最多约 ${NICKNAME_MAX_WEIGHT / 2} 个汉字）`, current)
        : current;
    onDone(raw === null ? null : clampNickname(raw.trim()));
    return;
  }

  open = true;
  removeDom();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  styleRoot(root);

  const card = document.createElement('div');
  Object.assign(card.style, {
    width: 'min(360px, calc(100vw - 40px))',
    padding: '0 0 20px',
    borderRadius: '14px',
    background: 'linear-gradient(180deg, #f0e6d0 0%, #dcc9a4 100%)',
    border: '2px solid rgba(90, 60, 30, 0.55)',
    boxShadow: '0 12px 36px rgba(20, 12, 6, 0.35)',
    overflow: 'hidden',
  });

  const head = document.createElement('div');
  Object.assign(head.style, {
    height: '46px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(180deg, #8a4020 0%, #5a2810 100%)',
    color: '#fff4e0',
    font: 'bold 18px "PingFang SC", "STKaiti", serif',
    letterSpacing: '0.08em',
  });
  head.textContent = '修改昵称';

  const body = document.createElement('div');
  Object.assign(body.style, {
    padding: '18px 20px 0',
  });

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    color: '#7a5830',
    fontSize: '13px',
    marginBottom: '10px',
    lineHeight: '1.45',
  });
  hint.textContent = '可选。中文计 2、英文计 1，合计不超过 20。';

  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, {
    borderRadius: '10px',
    border: '1.5px solid #a07840',
    background: '#fff8e8',
    padding: '2px 12px',
    boxShadow: 'inset 0 1px 2px rgba(90, 60, 30, 0.12)',
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.placeholder = '输入昵称';
  input.autocomplete = 'off';
  input.spellcheck = false;
  Object.assign(input.style, {
    width: '100%',
    height: '44px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#3a2810',
    font: '17px "PingFang SC", "STKaiti", serif',
  });

  const counter = document.createElement('div');
  Object.assign(counter.style, {
    marginTop: '8px',
    textAlign: 'right',
    color: '#8a6a40',
    fontSize: '12px',
  });

  const syncCounter = () => {
    const w = nicknameWeight(input.value);
    counter.textContent = `${w} / ${NICKNAME_MAX_WEIGHT}`;
    counter.style.color = w >= NICKNAME_MAX_WEIGHT ? '#8a3010' : '#8a6a40';
  };
  syncCounter();

  input.addEventListener('input', () => {
    const clamped = clampNickname(input.value);
    if (clamped !== input.value) {
      input.value = clamped;
      const end = clamped.length;
      input.setSelectionRange(end, end);
    }
    syncCounter();
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '12px',
    marginTop: '18px',
  });

  const finish = (next: string | null) => {
    closeNicknameEditor();
    onDone(next);
  };

  const cancel = inkButton('取消', 'secondary');
  const ok = inkButton('确定', 'primary');
  cancel.addEventListener('click', () => finish(null));
  ok.addEventListener('click', () => finish(clampNickname(input.value.trim())));
  root.addEventListener('click', (e) => {
    if (e.target === root) finish(null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(clampNickname(input.value.trim()));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    }
  });

  inputWrap.appendChild(input);
  body.appendChild(hint);
  body.appendChild(inputWrap);
  body.appendChild(counter);
  actions.appendChild(cancel);
  actions.appendChild(ok);
  body.appendChild(actions);
  card.appendChild(head);
  card.appendChild(body);
  root.appendChild(card);
  document.body.appendChild(root);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
