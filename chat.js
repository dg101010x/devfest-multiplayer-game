/* DRIFT — chat.js
 * window.DriftChat — self-contained live chat panel (UI + CSS injected).
 * Classic script. No dependencies.
 */
(function () {
  'use strict';

  var CSS = [
    '@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap");',
    '.dchat{--bg:#12121a;--txt:#e8e8f0;--indigo:#6366f1;--pink:#ec4899;',
    '--green:#22c55e;--amber:#f59e0b;--panel:#1a1a24;--line:rgba(232,232,240,.09);',
    'position:relative;display:flex;flex-direction:column;min-height:0;height:100%;',
    'box-sizing:border-box;background:var(--bg);color:var(--txt);overflow:hidden;',
    "font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
    'font-size:14px;line-height:1.4;-webkit-text-size-adjust:100%;}',
    '.dchat *,.dchat *::before,.dchat *::after{box-sizing:border-box;}',

    /* list */
    '.dchat-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;',
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;',
    'padding:12px 12px 4px;display:flex;flex-direction:column;gap:7px;scrollbar-width:thin;',
    'scrollbar-color:rgba(232,232,240,.18) transparent;}',
    '.dchat-list::-webkit-scrollbar{width:6px;}',
    '.dchat-list::-webkit-scrollbar-thumb{background:rgba(232,232,240,.16);border-radius:99px;}',
    '.dchat-list::-webkit-scrollbar-track{background:transparent;}',

    /* row + bubble */
    '.dchat-row{display:flex;gap:8px;align-items:flex-start;animation:dchat-spring .34s cubic-bezier(.2,1.5,.4,1) both;}',
    '@keyframes dchat-spring{0%{opacity:0;transform:translateY(10px) scale(.86);}',
    '60%{opacity:1;transform:translateY(0) scale(1.04);}100%{opacity:1;transform:none;}}',
    '.dchat-dot{flex:0 0 auto;width:22px;height:22px;border-radius:50%;margin-top:1px;',
    'display:grid;place-items:center;font-size:10px;font-weight:700;color:#0c0c12;',
    'box-shadow:0 0 0 1px rgba(255,255,255,.07) inset;}',
    '.dchat-bub{flex:1 1 auto;min-width:0;background:var(--panel);border:1px solid var(--line);',
    'border-radius:14px;border-top-left-radius:5px;padding:7px 10px 8px;}',
    '.dchat-name{font-size:10.5px;font-weight:700;letter-spacing:.055em;text-transform:uppercase;',
    'opacity:.62;margin-bottom:2px;display:flex;align-items:center;gap:5px;}',
    '.dchat-body{font-size:14px;word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap;}',

    /* system */
    '.dchat-row.k-system{justify-content:center;}',
    '.dchat-row.k-system .dchat-bub{flex:0 1 auto;background:transparent;border:0;padding:3px 8px;',
    'text-align:center;font-size:11.5px;letter-spacing:.03em;color:rgba(232,232,240,.42);',
    'text-transform:lowercase;}',

    /* ai / GEM */
    '.dchat-row.k-ai .dchat-dot{background:linear-gradient(135deg,var(--indigo),var(--pink));color:#fff;}',
    '.dchat-row.k-ai .dchat-bub{position:relative;overflow:hidden;border-color:rgba(99,102,241,.45);',
    'background:linear-gradient(135deg,rgba(99,102,241,.20),rgba(236,72,153,.14));}',
    '.dchat-row.k-ai .dchat-bub::after{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.17) 50%,transparent 65%);',
    'background-size:260% 100%;animation:dchat-shimmer 2.8s linear infinite;}',
    '@keyframes dchat-shimmer{0%{background-position:160% 0;}100%{background-position:-60% 0;}}',
    '.dchat-badge{font-size:10px;line-height:1;padding:2px 5px;border-radius:5px;color:#fff;',
    'background:linear-gradient(135deg,var(--indigo),var(--pink));}',

    /* correct */
    '.dchat-row.k-correct .dchat-dot{background:var(--green);color:#06230f;}',
    '.dchat-row.k-correct .dchat-bub{border-color:rgba(34,197,94,.55);',
    'background:linear-gradient(135deg,rgba(34,197,94,.22),rgba(34,197,94,.08));',
    'box-shadow:0 0 0 1px rgba(34,197,94,.18),0 6px 22px -8px rgba(34,197,94,.55);}',
    '.dchat-row.k-correct .dchat-body{font-weight:700;color:#8af0ad;}',
    '.dchat-row.k-correct .dchat-name{color:var(--green);opacity:.9;}',
    '.dchat-row.k-correct.pop{animation:dchat-pop .42s cubic-bezier(.2,1.7,.35,1) both;}',
    '@keyframes dchat-pop{0%{transform:scale(.7);opacity:0;}55%{transform:scale(1.14);opacity:1;}',
    '100%{transform:scale(1);opacity:1;}}',
    '.dchat-row.k-correct.rocket{animation:dchat-rocket .5s cubic-bezier(.45,0,.2,1) both;}',
    '@keyframes dchat-rocket{0%{transform:translateY(0) scale(1);}',
    '45%{transform:translateY(-16px) scale(.96);opacity:.55;}',
    '46%{opacity:0;}100%{transform:translateY(0) scale(1);opacity:0;}}',
    '.dchat-row.k-correct.pinned{animation:dchat-land .46s cubic-bezier(.2,1.5,.4,1) both;}',
    '@keyframes dchat-land{0%{transform:translateY(-20px) scale(.94);opacity:0;}',
    '100%{transform:none;opacity:1;}}',
    '.dchat-row.k-correct.pinned .dchat-bub{animation:dchat-glow 1.5s ease-out 2;}',
    '@keyframes dchat-glow{0%,100%{box-shadow:0 0 0 1px rgba(34,197,94,.2);}',
    '50%{box-shadow:0 0 0 2px rgba(34,197,94,.7),0 0 26px -2px rgba(34,197,94,.6);}}',
    '.dchat-check{color:var(--green);font-weight:700;margin-right:4px;}',

    /* close */
    '.dchat-row.k-close .dchat-dot{background:var(--amber);color:#2a1a02;}',
    '.dchat-row.k-close .dchat-bub{border-color:rgba(245,158,11,.5);',
    'background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(245,158,11,.06));}',
    '.dchat-tag{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.11em;',
    'padding:2px 6px;border-radius:5px;background:var(--amber);color:#2a1a02;margin-right:6px;',
    'vertical-align:1px;animation:dchat-wobble 1.1s ease-in-out 2;}',
    '@keyframes dchat-wobble{0%,100%{transform:rotate(-2deg);}50%{transform:rotate(2deg) scale(1.05);}}',

    /* typing */
    '.dchat-typing{flex:0 0 auto;height:0;opacity:0;overflow:hidden;padding:0 14px;',
    'font-size:11.5px;color:rgba(232,232,240,.5);display:flex;align-items:center;gap:6px;',
    'transition:height .18s ease,opacity .18s ease;}',
    '.dchat-typing.on{height:22px;opacity:1;}',
    '.dchat-dots{display:inline-flex;gap:3px;}',
    '.dchat-dots i{width:4px;height:4px;border-radius:50%;background:var(--indigo);',
    'animation:dchat-bounce 1s infinite ease-in-out;}',
    '.dchat-dots i:nth-child(2){animation-delay:.14s;}',
    '.dchat-dots i:nth-child(3){animation-delay:.28s;}',
    '@keyframes dchat-bounce{0%,60%,100%{transform:translateY(0);opacity:.45;}',
    '30%{transform:translateY(-4px);opacity:1;}}',

    /* composer */
    '.dchat-form{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:10px 12px;',
    'padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));',
    'border-top:1px solid var(--line);background:rgba(18,18,26,.96);}',
    '.dchat-input{flex:1 1 auto;min-width:0;width:100%;background:#1e1e2b;color:var(--txt);',
    "border:1px solid var(--line);border-radius:12px;padding:11px 13px;font:inherit;font-size:16px;",
    'outline:none;transition:border-color .15s ease,box-shadow .15s ease;}',
    '.dchat-input::placeholder{color:rgba(232,232,240,.34);}',
    '.dchat-input:focus{border-color:var(--indigo);box-shadow:0 0 0 3px rgba(99,102,241,.22);}',
    '.dchat-input:disabled{opacity:.6;cursor:not-allowed;}',
    '.dchat-send{flex:0 0 auto;border:0;cursor:pointer;color:#fff;font:inherit;font-weight:700;',
    'font-size:13px;letter-spacing:.03em;padding:11px 16px;border-radius:12px;',
    'background:linear-gradient(135deg,var(--indigo),var(--pink));',
    'transition:transform .12s ease,opacity .15s ease;-webkit-tap-highlight-color:transparent;}',
    '.dchat-send:active{transform:scale(.94);}',
    '.dchat-send:disabled{opacity:.4;cursor:not-allowed;transform:none;}',

    /* floating reactions */
    '.dchat-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;}',
    '.dchat-float{position:absolute;bottom:62px;font-size:26px;line-height:1;will-change:transform,opacity;',
    'animation:dchat-rise 2.3s cubic-bezier(.3,.1,.5,1) forwards;text-shadow:0 2px 10px rgba(0,0,0,.45);}',
    '.dchat-float span{display:block;font-size:9.5px;font-family:inherit;font-weight:700;',
    'text-align:center;color:rgba(232,232,240,.6);margin-top:2px;letter-spacing:.04em;}',
    '@keyframes dchat-rise{0%{transform:translateY(0) scale(.5) rotate(0deg);opacity:0;}',
    '14%{transform:translateY(-14px) scale(1.18) rotate(-6deg);opacity:1;}',
    '55%{opacity:1;}',
    '100%{transform:translateY(-230px) scale(.85) rotate(9deg);opacity:0;}}',

    '@media (max-width:420px){.dchat-list{padding:10px 9px 4px;}',
    '.dchat-form{padding:8px 9px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));}',
    '.dchat-send{padding:11px 13px;}}',
    '@media (prefers-reduced-motion:reduce){.dchat *{animation-duration:.01ms!important;',
    'animation-iteration-count:1!important;}}',
    '#reaction-bar [data-emoji]{cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '#reaction-bar [data-emoji]:active{transform:scale(.88);}'
  ].join('');

  var AVATAR_COLORS = [
    '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#a855f7',
    '#ef4444', '#14b8a6', '#eab308', '#3b82f6', '#f472b6', '#84cc16'
  ];

  var S = {
    root: null,
    list: null,
    typing: null,
    typingText: null,
    form: null,
    input: null,
    send: null,
    fx: null,
    ids: Object.create(null),
    enabled: true,
    onSend: null,
    onReaction: null,
    onTyping: null,
    lastTyping: 0,
    reactionBound: false,
    styled: false
  };

  /* ------------------------------------------------------------- utilities */

  function hashCode(str) {
    var s = String(str == null ? '' : str);
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function colorFor(playerId) {
    return AVATAR_COLORS[hashCode(playerId) % AVATAR_COLORS.length];
  }

  function initialOf(name) {
    var n = String(name == null ? '' : name).trim();
    return n ? n.charAt(0).toUpperCase() : '?';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function injectStyle() {
    if (S.styled) return;
    if (document.getElementById('dchat-style')) {
      S.styled = true;
      return;
    }
    var st = document.createElement('style');
    st.id = 'dchat-style';
    st.type = 'text/css';
    st.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(st);
    S.styled = true;
  }

  function nearBottom() {
    if (!S.list) return true;
    var slack = S.list.clientHeight * 0.35 + 60;
    return S.list.scrollHeight - S.list.scrollTop - S.list.clientHeight <= slack;
  }

  function scrollToBottom(smooth) {
    if (!S.list) return;
    try {
      if (smooth && typeof S.list.scrollTo === 'function') {
        S.list.scrollTo({ top: S.list.scrollHeight, behavior: 'smooth' });
        return;
      }
    } catch (e) {}
    S.list.scrollTop = S.list.scrollHeight;
  }

  /* ------------------------------------------------------------------ init */

  function init(opts) {
    opts = opts || {};
    injectStyle();

    var host = document.querySelector('#chat-container');
    if (!host) {
      try {
        console.warn('[DriftChat] #chat-container not found');
      } catch (e) {}
      return null;
    }

    S.onSend = typeof opts.onSend === 'function' ? opts.onSend : null;
    S.onReaction = typeof opts.onReaction === 'function' ? opts.onReaction : null;
    S.onTyping = typeof opts.onTyping === 'function' ? opts.onTyping : null;

    // Rebuild cleanly if init is called twice.
    host.innerHTML = '';
    if (host.className.indexOf('dchat') === -1) {
      host.className = (host.className ? host.className + ' ' : '') + 'dchat';
    }
    S.root = host;
    S.ids = Object.create(null);

    S.fx = el('div', 'dchat-fx');
    S.fx.setAttribute('aria-hidden', 'true');

    S.list = el('div', 'dchat-list');
    S.list.setAttribute('role', 'log');
    S.list.setAttribute('aria-live', 'polite');
    S.list.setAttribute('aria-label', 'Chat messages');

    S.typing = el('div', 'dchat-typing');
    var dots = el('span', 'dchat-dots');
    dots.appendChild(el('i'));
    dots.appendChild(el('i'));
    dots.appendChild(el('i'));
    S.typingText = el('span', 'dchat-typing-text', '');
    S.typing.appendChild(dots);
    S.typing.appendChild(S.typingText);

    S.form = document.createElement('form');
    S.form.className = 'dchat-form';
    S.form.setAttribute('autocomplete', 'off');

    S.input = el('input', 'dchat-input');
    S.input.type = 'text';
    S.input.placeholder = 'type your guess…';
    S.input.maxLength = 120;
    S.input.setAttribute('autocomplete', 'off');
    S.input.setAttribute('autocapitalize', 'none');
    S.input.setAttribute('autocorrect', 'off');
    S.input.setAttribute('spellcheck', 'false');
    S.input.setAttribute('enterkeyhint', 'send');
    S.input.setAttribute('aria-label', 'Your guess');

    S.send = el('button', 'dchat-send', 'SEND');
    S.send.type = 'submit';

    S.form.appendChild(S.input);
    S.form.appendChild(S.send);

    host.appendChild(S.fx);
    host.appendChild(S.list);
    host.appendChild(S.typing);
    host.appendChild(S.form);

    S.form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submit();
    });

    S.input.addEventListener('input', function () {
      if (!S.onTyping || !S.enabled) return;
      if (!S.input.value) return;
      var now = Date.now();
      if (now - S.lastTyping < 1000) return;
      S.lastTyping = now;
      try {
        S.onTyping();
      } catch (e) {}
    });

    // Keep the composer visible when the mobile keyboard opens.
    S.input.addEventListener('focus', function () {
      setTimeout(function () {
        scrollToBottom(false);
        try {
          if (S.form.scrollIntoView) S.form.scrollIntoView({ block: 'nearest' });
        } catch (e) {}
      }, 250);
    });

    bindReactions();
    setEnabled(S.enabled);
    return host;
  }

  function submit() {
    if (!S.input || !S.enabled) return;
    var text = String(S.input.value || '').trim();
    if (!text) return;
    S.input.value = '';
    if (S.onSend) {
      try {
        S.onSend(text);
      } catch (e) {}
    }
    scrollToBottom(true);
  }

  function bindReactions() {
    if (S.reactionBound) return;
    var bar = document.querySelector('#reaction-bar');
    if (!bar) return;
    S.reactionBound = true;
    bar.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== bar && !(t.getAttribute && t.getAttribute('data-emoji'))) {
        t = t.parentNode;
      }
      if (!t || t === bar) return;
      var emoji = t.getAttribute('data-emoji');
      if (!emoji) return;
      ev.preventDefault();
      addReaction(emoji, 'you');
      if (S.onReaction) {
        try {
          S.onReaction(emoji);
        } catch (e) {}
      }
    });
  }

  /* ------------------------------------------------------------ addMessage */

  function addMessage(msg) {
    if (!S.list || !msg) return;
    var id = msg.id != null ? String(msg.id) : null;
    if (id) {
      if (S.ids[id]) return;
      S.ids[id] = 1;
    }

    var kind = msg.kind || 'guess';
    if (
      kind !== 'guess' && kind !== 'correct' && kind !== 'close' &&
      kind !== 'system' && kind !== 'ai'
    ) {
      kind = 'guess';
    }

    var stick = nearBottom();

    var row = el('div', 'dchat-row k-' + kind);
    if (id) row.setAttribute('data-mid', id);

    if (kind !== 'system') {
      var dot = el('div', 'dchat-dot');
      if (kind === 'ai') {
        dot.textContent = '✦';
      } else {
        dot.textContent = initialOf(msg.name);
        if (kind === 'guess') {
          dot.style.background = colorFor(msg.playerId != null ? msg.playerId : msg.name);
        }
      }
      row.appendChild(dot);
    }

    var bub = el('div', 'dchat-bub');

    if (kind !== 'system') {
      var nameRow = el('div', 'dchat-name');
      nameRow.appendChild(document.createTextNode(String(msg.name || 'player')));
      if (kind === 'ai') nameRow.appendChild(el('span', 'dchat-badge', '✦'));
      bub.appendChild(nameRow);
    }

    var body = el('div', 'dchat-body');
    if (kind === 'correct') body.appendChild(el('span', 'dchat-check', '✓'));
    if (kind === 'close') body.appendChild(el('span', 'dchat-tag', 'SO CLOSE'));
    var text = msg.body != null ? String(msg.body) : '';
    if (msg.emoji) text = String(msg.emoji) + (text ? ' ' + text : '');
    body.appendChild(document.createTextNode(text));
    bub.appendChild(body);

    row.appendChild(bub);
    S.list.appendChild(row);

    if (kind === 'correct') {
      row.classList.add('pop');
      // scale-pop, then rocket to the top of the list and land highlighted
      setTimeout(function () {
        if (!row.parentNode || !S.list) return;
        row.classList.remove('pop');
        row.classList.add('rocket');
        setTimeout(function () {
          if (!row.parentNode || !S.list) return;
          row.classList.remove('rocket');
          try {
            S.list.insertBefore(row, S.list.firstChild);
          } catch (e) {}
          row.classList.add('pinned');
          try {
            S.list.scrollTop = 0;
          } catch (e2) {}
        }, 480);
      }, 440);
      return;
    }

    if (stick) scrollToBottom(true);
  }

  /* ------------------------------------------------------------- setTyping */

  function setTyping(names) {
    if (!S.typing) return;
    var list = [];
    if (Array.isArray(names)) {
      for (var i = 0; i < names.length; i++) {
        var n = names[i] == null ? '' : String(names[i]).trim();
        if (n) list.push(n);
      }
    }
    if (!list.length) {
      S.typing.classList.remove('on');
      S.typingText.textContent = '';
      return;
    }
    var label;
    if (list.length === 1) label = list[0] + ' is typing…';
    else if (list.length === 2) label = list[0] + ' and ' + list[1] + ' are typing…';
    else label = list.length + ' people typing…';
    S.typingText.textContent = label;
    S.typing.classList.add('on');
  }

  /* ----------------------------------------------------------- addReaction */

  function addReaction(emoji, fromName) {
    if (!S.fx || !emoji) return;
    var node = el('div', 'dchat-float');
    node.appendChild(document.createTextNode(String(emoji)));
    if (fromName) node.appendChild(el('span', null, String(fromName)));

    var pct = 8 + Math.random() * 74;
    node.style.left = pct.toFixed(2) + '%';
    node.style.animationDelay = (Math.random() * 0.18).toFixed(3) + 's';
    node.style.animationDuration = (2.0 + Math.random() * 0.9).toFixed(2) + 's';
    node.style.fontSize = (22 + Math.random() * 12).toFixed(0) + 'px';

    S.fx.appendChild(node);
    var killed = false;
    function kill() {
      if (killed) return;
      killed = true;
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    node.addEventListener('animationend', kill);
    setTimeout(kill, 3600);
  }

  /* ------------------------------------------------------------ setEnabled */

  function setEnabled(on) {
    S.enabled = !!on;
    if (!S.input || !S.send) return;
    S.input.disabled = !S.enabled;
    S.send.disabled = !S.enabled;
    if (S.enabled) {
      S.input.placeholder = 'type your guess…';
    } else {
      S.input.value = '';
      S.input.placeholder = "you're drawing — no guessing 🤫";
      try {
        S.input.blur();
      } catch (e) {}
    }
  }

  /* ----------------------------------------------------------------- clear */

  function clear() {
    S.ids = Object.create(null);
    if (S.list) S.list.innerHTML = '';
    setTyping([]);
  }

  /* ---------------------------------------------------------------- export */

  window.DriftChat = {
    init: init,
    addMessage: addMessage,
    setTyping: setTyping,
    addReaction: addReaction,
    setEnabled: setEnabled,
    clear: clear,
    colorFor: colorFor
  };
})();
