// wechat/polyfill.js
// 独立轻量适配层：把小游戏缺失的浏览器全局挂到 GameGlobal（≈ window），让 game.bundle.js 直接跑。
// 必须在 game.js 里【最先】加载。本游戏画布/图片/音频已走 platform.ts 的 wx.* 分支，故这里只补
// 「非渲染」全局 + 一个够用的 document/element 桩；document.createElement('canvas') 交给 wx.createCanvas()。
// 说明：不用 npm 的 weapp-adapter —— 那种是 `module.exports=webpack(...)` 的「被 import 进包」形态，
// 作为独立 require 加载时不会往全局挂 window/document，故对本工程无效（见 README）。
/* eslint-disable */
(function () {
  var g = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof globalThis !== 'undefined' ? globalThis : this);
  var sys = {};
  try { if (typeof wx !== 'undefined' && wx.getSystemInfoSync) sys = wx.getSystemInfoSync(); } catch (e) {}
  var hasWx = typeof wx !== 'undefined';

  // —— navigator（clipboard 留空以便 `?.` 短路；小游戏复制走 wx.setClipboardData）——
  if (typeof g.navigator === 'undefined') {
    g.navigator = {
      userAgent: 'minigame/' + (sys.platform || 'wechat'),
      appVersion: String(sys.version || ''), language: sys.language || 'zh_CN',
      platform: sys.platform || 'wechat', onLine: true, clipboard: undefined,
    };
  }

  // —— performance.now（动画/循环计时大量使用）——
  if (!g.performance || typeof g.performance.now !== 'function') {
    var t0 = Date.now();
    g.performance = g.performance || {};
    g.performance.now = function () { return Date.now() - t0; };
  }

  // —— location（无地址栏，空串桩；深链应改走 wx 启动参数/分享）——
  if (typeof g.location === 'undefined') {
    g.location = { href: '', origin: '', protocol: 'https:', host: '', hostname: '', port: '', pathname: '/', search: '', hash: '' };
  }

  // —— URLSearchParams（main.ts 启动读 `new URLSearchParams(location.search)`）——
  if (typeof g.URLSearchParams === 'undefined') {
    g.URLSearchParams = function (init) {
      var map = {};
      var s = init == null ? '' : (typeof init === 'string' ? init : String(init));
      s.replace(/^[?#]/, '').split('&').forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf('='), k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? '' : pair.slice(i + 1);
        try { map[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { map[k] = v; }
      });
      this.get = function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; };
      this.has = function (k) { return Object.prototype.hasOwnProperty.call(map, k); };
      this.getAll = function (k) { return this.has(k) ? [map[k]] : []; };
      this.set = function (k, v) { map[k] = String(v); };
      this.delete = function (k) { delete map[k]; };
      this.forEach = function (cb) { Object.keys(map).forEach(function (k) { cb(map[k], k); }); };
      this.toString = function () { return Object.keys(map).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(map[k]); }).join('&'); };
    };
  }

  // —— 假 DOM 元素：供 document.createElement 的非 canvas 分支（div/input/… 多来自 devtools UI，
  //     小游戏里不渲染但不能崩）。提供常用属性/方法的空实现，链式安全。——
  function fakeEl(tag) {
    var el = {
      tagName: String(tag || 'div').toUpperCase(), nodeType: 1,
      style: {}, dataset: {}, children: [], childNodes: [],
      className: '', id: '', title: '', textContent: '', innerHTML: '', innerText: '', value: '',
      width: 0, height: 0, checked: false, disabled: false,
      setAttribute: function () {}, getAttribute: function () { return null; }, removeAttribute: function () {},
      appendChild: function (c) { el.children.push(c); return c; },
      removeChild: function (c) { var i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
      insertBefore: function (c) { el.children.push(c); return c; },
      append: function () {}, prepend: function () {}, replaceChildren: function () {},
      addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; },
      remove: function () {}, contains: function () { return false; }, cloneNode: function () { return fakeEl(tag); },
      click: function () {}, focus: function () {}, blur: function () {}, closest: function () { return null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; },
      getContext: function () { return null; },
      classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    };
    return el;
  }

  // —— document（createElement('canvas') → wx.createCanvas()；其余给假元素）——
  if (typeof g.document === 'undefined') {
    var body = fakeEl('body'), head = fakeEl('head'), docEl = fakeEl('html');
    docEl.requestFullscreen = function () { return Promise.resolve(); };
    g.document = {
      body: body, head: head, documentElement: docEl,
      hidden: false, visibilityState: 'visible', readyState: 'complete', fullscreenElement: null,
      createElement: function (tag) { return (hasWx && String(tag).toLowerCase() === 'canvas') ? wx.createCanvas() : fakeEl(tag); },
      createElementNS: function (_ns, tag) { return fakeEl(tag); },
      createTextNode: function (t) { return { nodeType: 3, textContent: String(t == null ? '' : t) }; },
      getElementById: function () { return null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      getElementsByTagName: function () { return []; }, getElementsByClassName: function () { return []; },
      addEventListener: function () {}, removeEventListener: function () {},
      exitFullscreen: function () { return Promise.resolve(); }, execCommand: function () { return false; },
    };
  }

  // —— window = 全局本身（window.navigator/location/performance/setTimeout… 随之可用），补缺的方法/度量 ——
  if (typeof g.window === 'undefined') g.window = g;
  if (typeof g.addEventListener !== 'function') g.addEventListener = function () {};
  if (typeof g.removeEventListener !== 'function') g.removeEventListener = function () {};
  if (typeof g.matchMedia !== 'function') g.matchMedia = function () { return { matches: true, media: '', onchange: null, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} }; };
  if (typeof g.getComputedStyle !== 'function') g.getComputedStyle = function () { return { getPropertyValue: function () { return ''; } }; };
  if (typeof g.prompt !== 'function') g.prompt = function () { return null; };
  if (typeof g.alert !== 'function') g.alert = function () {};
  if (typeof g.devicePixelRatio !== 'number') g.devicePixelRatio = sys.pixelRatio || 1;
  if (typeof g.innerWidth !== 'number') g.innerWidth = sys.windowWidth || sys.screenWidth || 375;
  if (typeof g.innerHeight !== 'number') g.innerHeight = sys.windowHeight || sys.screenHeight || 667;
  // 小游戏已全局提供 setTimeout/setInterval/requestAnimationFrame；缺失时兜底
  if (typeof g.requestAnimationFrame !== 'function') g.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(g.performance.now()); }, 16); };
  if (typeof g.cancelAnimationFrame !== 'function') g.cancelAnimationFrame = function (id) { clearTimeout(id); };

  // —— Fetch 桥（→ wx.request）——
  // 本游戏网络层：api/client.ts 用 `new Headers()` + `fetch().text()`（REST：排行榜/云存/遥测/PvP 撮合），
  // sfx.ts 用 `fetch().arrayBuffer()`（BGM 解码）。小游戏无 fetch/Headers，这里用 wx.request 兜底实现。
  // 注意：真机需在小程序后台把 API 域名 + CDN 域名加入「request 合法域名」（devtools urlCheck:false 时本地免配）。
  if (typeof g.Headers === 'undefined') {
    function H(init) {
      this._m = {};
      var self = this;
      if (init && init._m) { Object.keys(init._m).forEach(function (k) { self._m[k] = init._m[k]; }); }
      else if (Array.isArray(init)) { init.forEach(function (p) { self._m[String(p[0]).toLowerCase()] = String(p[1]); }); }
      else if (init) { Object.keys(init).forEach(function (k) { self._m[k.toLowerCase()] = String(init[k]); }); }
    }
    H.prototype.set = function (k, v) { this._m[String(k).toLowerCase()] = String(v); };
    H.prototype.get = function (k) { var v = this._m[String(k).toLowerCase()]; return v == null ? null : v; };
    H.prototype.has = function (k) { return Object.prototype.hasOwnProperty.call(this._m, String(k).toLowerCase()); };
    H.prototype.append = function (k, v) { this.set(k, v); };
    H.prototype['delete'] = function (k) { delete this._m[String(k).toLowerCase()]; };
    H.prototype.forEach = function (cb) { var m = this._m; Object.keys(m).forEach(function (k) { cb(m[k], k); }); };
    g.Headers = H;
  }
  if (typeof g.fetch !== 'function') {
    g.fetch = function (url, init) {
      init = init || {};
      return new Promise(function (resolve, reject) {
        if (!hasWx || typeof wx.request !== 'function') { reject(new Error('minigame: wx.request 不可用')); return; }
        var header = {};
        var h = init.headers;
        if (h && h._m) { Object.keys(h._m).forEach(function (k) { header[k] = h._m[k]; }); }
        else if (h && typeof h.forEach === 'function') { h.forEach(function (v, k) { header[k] = v; }); }
        else if (h) { Object.keys(h).forEach(function (k) { header[k] = h[k]; }); }
        // 音频等二进制按后缀走 arraybuffer；其余走文本（apiFetch 自己 JSON.parse，故 dataType 不用 'json'）
        var wantAB = init.responseType === 'arraybuffer' || /\.(mp3|wav|ogg|m4a|aac|bin)(\?|$)/i.test(String(url));
        wx.request({
          url: String(url), method: (init.method || 'GET').toUpperCase(), header: header, data: init.body,
          responseType: wantAB ? 'arraybuffer' : 'text', dataType: 'text',
          success: function (r) {
            var status = r.statusCode || 0, body = r.data;
            resolve({
              ok: status >= 200 && status < 300, status: status, statusText: '', headers: new g.Headers(r.header || {}),
              text: function () { return Promise.resolve(wantAB ? '' : (typeof body === 'string' ? body : (body == null ? '' : String(body)))); },
              json: function () { return Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body); },
              arrayBuffer: function () { return Promise.resolve(body); },
            });
          },
          fail: function (err) { reject(new Error(err && err.errMsg ? err.errMsg : 'request failed')); },
        });
      });
    };
  }
})();
