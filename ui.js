/* ==========================================================================
   DRIFT — ui.js
   Owns the visual shell. Exposes exactly window.DriftUI.
   No dependencies, no libraries.
   ========================================================================== */
(function (window, document) {
  'use strict';

  /* ------------------------------ helpers ------------------------------ */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* noop */ }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  var COLORS = ['#0f0f12', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'];
  var SIZES = [3, 8, 18];
  var EMOJI = ['👏', '😂', '🔥', '😭', '🤔', '💀'];
  var RING_C = 2 * Math.PI * 26; /* r=26 in the SVG viewBox */

  /* ------------------------------ confetti ------------------------------ */
  var Confetti = (function () {
    var canvas, ctx, parts = [], raf = null, dpr = 1, ready = false;
    var PALETTE = ['#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#38bdf8', '#a855f7', '#ffffff'];

    function resize() {
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function setup() {
      canvas = document.getElementById('confetti-canvas');
      if (!canvas) return false;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      ready = true;
      return true;
    }

    function tick() {
      var w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += p.g;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.0055;
        if (p.life <= 0 || p.y > h + 60) { parts.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (parts.length) { raf = requestAnimationFrame(tick); }
      else { raf = null; ctx.clearRect(0, 0, w, h); }
    }

    function burst(count, ox, oy) {
      if (!ready && !setup()) return;
      var n = count || 140;
      if (reduced) n = Math.min(n, 30);
      var cx = ox != null ? ox : window.innerWidth / 2;
      var cy = oy != null ? oy : window.innerHeight * 0.42;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = 3 + Math.random() * 13;
        parts.push({
          x: cx + (Math.random() - 0.5) * 40,
          y: cy + (Math.random() - 0.5) * 30,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 7,
          g: 0.2 + Math.random() * 0.2,
          w: 4 + Math.random() * 8,
          h: 7 + Math.random() * 12,
          rot: Math.random() * 6.283,
          vr: (Math.random() - 0.5) * 0.45,
          col: PALETTE[(Math.random() * PALETTE.length) | 0],
          life: 0.85 + Math.random() * 0.4
        });
      }
      if (parts.length > 900) parts.splice(0, parts.length - 900);
      if (!raf) raf = requestAnimationFrame(tick);
    }

    return { burst: burst, setup: setup };
  })();

  /* ------------------------------ state ------------------------------ */
  var refs = {};
  var cb = { join: null, start: null, end: null };
  var seenPlayers = Object.create(null);
  var currentPhase = 'join';
  var roomCode = '';
  var flashTimer = null, flashHideTimer = null, toastTimer = null;
  var inited = false;

  /* ------------------------------ toolbar ------------------------------ */
  function buildToolBar() {
    var bar = refs.toolBar;
    if (!bar) return;
    bar.textContent = '';

    var colorGroup = el('div', 'tool-group');
    COLORS.forEach(function (c, i) {
      var b = el('button', 'swatch' + (i === 0 ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('data-color', c);
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', 'color ' + c);
      if (c.toLowerCase() === '#ffffff') b.style.borderColor = 'rgba(0,0,0,.35)';
      colorGroup.appendChild(b);
    });
    bar.appendChild(colorGroup);

    bar.appendChild(el('div', 'tool-sep'));

    var sizeGroup = el('div', 'tool-group');
    SIZES.forEach(function (s, i) {
      var b = el('button', 'size-btn' + (i === 1 ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('data-size', String(s));
      b.setAttribute('aria-label', 'brush size ' + s);
      var dot = el('span', 'size-dot');
      var px = Math.max(5, Math.round(s * 0.9 + 3));
      dot.style.width = px + 'px';
      dot.style.height = px + 'px';
      b.appendChild(dot);
      sizeGroup.appendChild(b);
    });
    bar.appendChild(sizeGroup);

    bar.appendChild(el('div', 'tool-sep'));

    var actions = el('div', 'tool-group');
    var undo = el('button', 'tool-btn', 'Undo');
    undo.type = 'button';
    undo.id = 'undo-btn';
    undo.setAttribute('data-action', 'undo');
    var clear = el('button', 'tool-btn danger', 'Clear');
    clear.type = 'button';
    clear.id = 'clear-btn';
    clear.setAttribute('data-action', 'clear');
    actions.appendChild(undo);
    actions.appendChild(clear);
    bar.appendChild(actions);

    /* local affordance: keep the active highlight in sync regardless of canvas.js */
    bar.addEventListener('click', function (ev) {
      var sw = ev.target.closest ? ev.target.closest('.swatch') : null;
      if (sw) {
        Array.prototype.forEach.call(bar.querySelectorAll('.swatch'), function (n) { n.classList.remove('active'); });
        sw.classList.add('active');
        return;
      }
      var sz = ev.target.closest ? ev.target.closest('.size-btn') : null;
      if (sz) {
        Array.prototype.forEach.call(bar.querySelectorAll('.size-btn'), function (n) { n.classList.remove('active'); });
        sz.classList.add('active');
      }
    });
  }

  function buildReactionBar() {
    var bar = refs.reactionBar;
    if (!bar) return;
    bar.textContent = '';
    EMOJI.forEach(function (e) {
      var b = el('button', 'reaction-btn', e);
      b.type = 'button';
      b.setAttribute('data-emoji', e);
      b.setAttribute('aria-label', 'react ' + e);
      bar.appendChild(b);
    });
  }

  /* ------------------------------ init ------------------------------ */
  function init() {
    if (inited) return;
    inited = true;

    refs.phases = {
      join: $('#phase-join'),
      lobby: $('#phase-lobby'),
      play: $('#phase-play'),
      reveal: $('#phase-reveal')
    };

    refs.joinForm = $('#join-form');
    refs.joinName = $('#join-name');
    refs.joinCode = $('#join-code');
    refs.joinBtn = $('#join-btn');
    refs.joinBtnLabel = $('#join-btn-label');
    refs.joinHint = $('#join-hint');

    refs.roomCode = $('#room-code');
    refs.shareLink = $('#share-link');
    refs.copyBtn = $('#copy-link-btn');
    refs.lobbyRoster = $('#lobby-roster');
    refs.lobbyCount = $('#lobby-count');
    refs.lobbyEmpty = $('#lobby-empty');
    refs.startBtn = $('#start-btn');

    refs.playRoster = $('#play-roster');
    refs.roundInfo = $('#round-info');
    refs.timer = $('#timer');
    refs.timerArc = $('#timer-arc');
    refs.timerNum = $('#timer-num');
    refs.bannerLabel = $('#banner-label');
    refs.promptWord = $('#prompt-word');
    refs.promptMystery = $('#prompt-mystery');
    refs.statusLine = $('#status-line');
    refs.endBtn = $('#end-btn');
    refs.toolBar = $('#tool-bar');
    refs.reactionBar = $('#reaction-bar');

    refs.revealWrap = $('#reveal-wrap');

    refs.flash = $('#flash-overlay');
    refs.flashKicker = $('#flash-kicker');
    refs.flashMain = $('#flash-main');
    refs.flashSub = $('#flash-sub');
    refs.screenFlash = $('#screen-flash');
    refs.toast = $('#toast');

    if (refs.timerArc) {
      refs.timerArc.style.strokeDasharray = RING_C.toFixed(2);
      refs.timerArc.style.strokeDashoffset = '0';
    }

    buildToolBar();
    buildReactionBar();
    Confetti.setup();

    /* ---- join form ---- */
    if (refs.joinCode) {
      refs.joinCode.addEventListener('input', function () {
        var v = refs.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        refs.joinCode.value = v;
        if (refs.joinBtnLabel) refs.joinBtnLabel.textContent = v.length ? 'JOIN ROOM' : 'CREATE ROOM';
      });
    }
    if (refs.joinForm) {
      refs.joinForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var name = (refs.joinName && refs.joinName.value || '').trim().slice(0, 14);
        var code = (refs.joinCode && refs.joinCode.value || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
        if (!name) {
          api.toast('enter a name first');
          if (refs.joinName) refs.joinName.focus();
          return;
        }
        if (refs.joinBtn) refs.joinBtn.disabled = true;
        window.setTimeout(function () { if (refs.joinBtn) refs.joinBtn.disabled = false; }, 2500);
        if (cb.join) {
          try { cb.join({ name: name, code: code }); }
          catch (e) { /* surface nothing to the player */ }
        }
      });
    }

    /* ---- prefill from ?r=CODE ---- */
    try {
      var m = /[?&]r=([A-Za-z]{1,4})/.exec(window.location.search || '');
      if (m && refs.joinCode) {
        refs.joinCode.value = m[1].toUpperCase();
        if (refs.joinBtnLabel) refs.joinBtnLabel.textContent = 'JOIN ROOM';
        if (refs.joinHint) refs.joinHint.textContent = 'Room ' + m[1].toUpperCase() + ' is waiting for you.';
      }
    } catch (e) { /* noop */ }

    /* ---- lobby ---- */
    if (refs.startBtn) {
      refs.startBtn.addEventListener('click', function () {
        if (cb.start) { try { cb.start(); } catch (e) {} }
      });
    }
    if (refs.copyBtn) {
      refs.copyBtn.addEventListener('click', function () { copyShareLink(); });
    }
    if (refs.roomCode) {
      refs.roomCode.addEventListener('click', function () { copyShareLink(); });
      refs.roomCode.style.cursor = 'pointer';
    }

    /* ---- play ---- */
    if (refs.endBtn) {
      refs.endBtn.addEventListener('click', function () {
        if (cb.end) { try { cb.end(); } catch (e) {} }
      });
    }

    if (refs.flash) {
      refs.flash.addEventListener('click', hideFlash);
    }
  }

  function shareUrl() {
    return window.location.origin + window.location.pathname + '?r=' + (roomCode || '');
  }

  function copyShareLink() {
    var url = shareUrl();
    var done = function () { api.toast('copied!'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { legacyCopy(url, done); });
        return;
      }
    } catch (e) { /* fall through */ }
    legacyCopy(url, done);
  }

  function legacyCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      api.toast('copy failed — link: ' + text);
    }
  }

  /* ------------------------------ phases ------------------------------ */
  function showPhase(name) {
    if (!refs.phases) init();
    var target = refs.phases[name];
    if (!target) return;
    currentPhase = name;
    Object.keys(refs.phases).forEach(function (k) {
      var node = refs.phases[k];
      if (!node) return;
      if (k === name) {
        node.hidden = false;
        node.classList.remove('leaving');
        node.classList.add('active');
      } else {
        node.classList.remove('active', 'leaving');
        node.hidden = true;
      }
    });
    try { window.scrollTo(0, 0); } catch (e) {}
    document.body.setAttribute('data-phase', name);
  }

  /* ------------------------------ room code ------------------------------ */
  function setRoomCode(code) {
    if (!inited) init();
    roomCode = String(code || '').toUpperCase();
    if (refs.roomCode) {
      refs.roomCode.textContent = '';
      roomCode.split('').forEach(function (ch, i) {
        var s = el('span', 'code-letter', ch);
        s.style.setProperty('--i', String(i));
        refs.roomCode.appendChild(s);
      });
      refs.roomCode.setAttribute('aria-label', 'room code ' + roomCode.split('').join(' '));
    }
    if (refs.shareLink) refs.shareLink.textContent = shareUrl();
  }

  /* ------------------------------ roster ------------------------------ */
  function chipFor(p, drawerId) {
    var chip = el('div', 'chip');
    chip.setAttribute('data-id', p.id);
    if (drawerId && p.id === drawerId) chip.classList.add('is-drawer');
    if (!seenPlayers[p.id]) {
      chip.classList.add('chip-new');
      seenPlayers[p.id] = true;
    }
    var em = el('span', 'chip-emoji', p.emoji || '🙂');
    var nm = el('span', 'chip-name', p.name || '???');
    chip.appendChild(em);
    chip.appendChild(nm);
    if (drawerId && p.id === drawerId) {
      chip.appendChild(el('span', 'chip-badge', '✏️'));
    }
    return chip;
  }

  function setRoster(players, drawerId) {
    if (!inited) init();
    var list = Array.isArray(players) ? players.slice() : [];
    list.sort(function (a, b) { return (a.joinOrder || 0) - (b.joinOrder || 0); });

    [refs.lobbyRoster, refs.playRoster].forEach(function (host) {
      if (!host) return;
      host.textContent = '';
      list.forEach(function (p) { host.appendChild(chipFor(p, drawerId)); });
    });

    if (refs.lobbyCount) refs.lobbyCount.textContent = String(list.length);
    if (refs.lobbyEmpty) refs.lobbyEmpty.hidden = list.length > 0;
  }

  /* ------------------------------ role / prompt ------------------------------ */
  function setRole(isDrawer) {
    if (!inited) init();
    document.body.classList.toggle('is-drawer', !!isDrawer);
    document.body.classList.toggle('is-guesser', !isDrawer);
  }

  function setPrompt(text) {
    if (!inited) init();
    if (text) {
      if (refs.bannerLabel) refs.bannerLabel.textContent = "YOU'RE DRAWING";
      if (refs.promptMystery) refs.promptMystery.hidden = true;
      if (refs.promptWord) {
        refs.promptWord.hidden = false;
        refs.promptWord.textContent = String(text);
        /* retrigger the pop animation */
        refs.promptWord.style.animation = 'none';
        void refs.promptWord.offsetWidth;
        refs.promptWord.style.animation = '';
      }
    } else {
      if (refs.bannerLabel) refs.bannerLabel.textContent = 'GUESS IT';
      if (refs.promptWord) { refs.promptWord.hidden = true; refs.promptWord.textContent = ''; }
      if (refs.promptMystery) refs.promptMystery.hidden = false;
    }
  }

  function setRoundInfo(roundNumber, totalRounds) {
    if (!inited) init();
    if (!refs.roundInfo) return;
    var r = roundNumber != null ? roundNumber : 1;
    var t = totalRounds != null ? totalRounds : '?';
    refs.roundInfo.textContent = 'ROUND ' + r + ' / ' + t;
  }

  /* ------------------------------ timer ------------------------------ */
  function setTimer(secondsLeft, totalSeconds) {
    if (!inited) init();
    var left = Math.max(0, Number(secondsLeft) || 0);
    var total = Math.max(1, Number(totalSeconds) || 1);
    var frac = Math.max(0, Math.min(1, left / total));
    if (refs.timerArc) {
      refs.timerArc.style.strokeDasharray = RING_C.toFixed(2);
      refs.timerArc.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(2);
    }
    if (refs.timerNum) refs.timerNum.textContent = String(Math.ceil(left));
    if (refs.timer) refs.timer.classList.toggle('danger', left <= 10 && left > 0);
  }

  /* ------------------------------ flashes ------------------------------ */
  function hideFlash() {
    if (!refs.flash) return;
    if (!refs.flash.classList.contains('show')) return;
    refs.flash.classList.add('hiding');
    window.clearTimeout(flashHideTimer);
    flashHideTimer = window.setTimeout(function () {
      refs.flash.classList.remove('show', 'hiding', 'mode-correct', 'mode-drift');
      refs.flash.setAttribute('aria-hidden', 'true');
    }, 340);
  }

  function showFlash(mode, kicker, main, sub, duration) {
    if (!inited) init();
    if (!refs.flash) return;
    window.clearTimeout(flashTimer);
    window.clearTimeout(flashHideTimer);
    refs.flash.classList.remove('hiding', 'mode-correct', 'mode-drift');
    refs.flash.classList.add('show', mode);
    refs.flash.setAttribute('aria-hidden', 'false');
    if (refs.flashKicker) refs.flashKicker.textContent = kicker || '';
    if (refs.flashMain) refs.flashMain.textContent = main || '';
    if (refs.flashSub) refs.flashSub.textContent = sub || '';
    /* restart the card pop */
    var card = $('#flash-card');
    if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
    flashTimer = window.setTimeout(hideFlash, duration || 2200);
  }

  function fireScreenFlash(dark) {
    if (!refs.screenFlash || reduced) return;
    refs.screenFlash.classList.remove('fire', 'fire-dark');
    void refs.screenFlash.offsetWidth;
    refs.screenFlash.classList.add(dark ? 'fire-dark' : 'fire');
  }

  function flashCorrect(name, word) {
    var who = String(name || 'SOMEONE').toUpperCase();
    var w = String(word || '???').toUpperCase();
    showFlash('mode-correct', 'correct!', who + ' GOT IT — ' + w, 'that word becomes the next prompt', 2200);
    fireScreenFlash(false);
    Confetti.burst(170, window.innerWidth / 2, window.innerHeight * 0.44);
    window.setTimeout(function () { Confetti.burst(70, window.innerWidth * 0.2, window.innerHeight * 0.55); }, 180);
    window.setTimeout(function () { Confetti.burst(70, window.innerWidth * 0.8, window.innerHeight * 0.55); }, 300);
  }

  function flashDrift(word) {
    var w = String(word || '???').toUpperCase();
    showFlash('mode-drift', 'nobody got it', 'NOBODY GOT IT — the chain drifts to ' + w, 'the last wrong guess carries on anyway', 2200);
    fireScreenFlash(true);
  }

  /* ------------------------------ reveal ------------------------------ */
  function renderReveal(chain, roast) {
    if (!inited) init();
    var host = refs.revealWrap;
    if (!host) return;
    host.textContent = '';

    var links = Array.isArray(chain) ? chain.slice() : [];
    links.sort(function (a, b) { return (a.roundNumber || 0) - (b.roundNumber || 0); });

    var seed = links.length ? (links[0].prompt || '???') : '???';
    var last = links.length ? links[links.length - 1] : null;
    var finalWord = last ? (last.winningGuess || last.prompt || '???') : '???';
    var drifts = links.filter(function (l) { return !l.gotIt; }).length;

    /* --- header --- */
    host.appendChild(el('div', 'reveal-kicker', 'the chain, end to end'));
    var title = el('h2', 'reveal-title', 'HOW FAR IT DRIFTED');
    host.appendChild(title);

    /* --- seed → final comparison --- */
    var cmp = el('div', 'drift-compare');
    var left = el('div', 'compare-cell');
    left.appendChild(el('div', 'compare-label', 'seed word'));
    left.appendChild(el('div', 'compare-word seed', seed));
    var arrow = el('div', 'compare-arrow', '🌀');
    var right = el('div', 'compare-cell');
    right.appendChild(el('div', 'compare-label', 'final word'));
    right.appendChild(el('div', 'compare-word final', finalWord));
    cmp.appendChild(left);
    cmp.appendChild(arrow);
    cmp.appendChild(right);
    host.appendChild(cmp);

    var scoreText = links.length
      ? (drifts === 0
        ? links.length + ' links · 0 drifts · you people are terrifyingly good'
        : links.length + ' links · ' + drifts + ' drift' + (drifts === 1 ? '' : 's') + ' · ' + Math.round((drifts / links.length) * 100) + '% chaos')
      : 'no links yet';
    host.appendChild(el('div', 'drift-score', scoreText));

    /* --- filmstrip --- */
    var strip = el('div', 'filmstrip');
    links.forEach(function (link, idx) {
      var card = el('div', 'reveal-link ' + (link.gotIt ? 'gotit' : 'drifted'));
      card.style.setProperty('--i', String(idx));

      var top = el('div', 'link-top');
      top.appendChild(el('span', 'link-round', 'R' + (link.roundNumber != null ? link.roundNumber : idx + 1)));
      top.appendChild(el('span', 'link-src', link.source === 'seed' ? 'seed word' : 'from last guess'));
      top.appendChild(el('span', 'verdict-tag', link.gotIt ? 'GOT IT' : 'DRIFTED'));
      card.appendChild(top);

      card.appendChild(el('div', 'link-prompt', link.prompt || '???'));

      var cv = document.createElement('canvas');
      cv.className = 'reveal-canvas';
      cv.width = 320;
      cv.height = 240;
      cv.setAttribute('data-round', String(link.roundNumber != null ? link.roundNumber : idx + 1));
      card.appendChild(cv);

      var drawer = el('div', 'link-drawer');
      drawer.appendChild(document.createTextNode('drawn by '));
      drawer.appendChild(el('b', null, link.drawerName || 'someone'));
      card.appendChild(drawer);

      var out = el('div', 'link-out');
      out.appendChild(el('div', 'out-label', link.gotIt ? 'guessed correctly' : 'what came out instead'));
      out.appendChild(el('div', 'out-word', link.winningGuess || '— nothing —'));
      out.appendChild(el('div', 'out-who', link.winnerName ? 'by ' + link.winnerName : 'nobody got it'));
      card.appendChild(out);

      strip.appendChild(card);
    });
    host.appendChild(strip);

    /* --- GEM's verdict --- */
    var roastCard = el('div', 'roast-card');
    var rh = el('div', 'roast-head');
    rh.appendChild(el('span', 'roast-avatar', '🤖'));
    rh.appendChild(el('span', null, "GEM'S VERDICT"));
    roastCard.appendChild(rh);
    roastCard.appendChild(el('div', 'roast-body', roast || 'GEM is speechless. That has never happened before.'));
    host.appendChild(roastCard);

    /* --- play again --- */
    var foot = el('div', 'reveal-foot');
    var again = el('button', 'btn btn-primary btn-xl', 'PLAY AGAIN');
    again.type = 'button';
    again.id = 'play-again';
    again.addEventListener('click', function () { window.location.reload(); });
    foot.appendChild(again);
    host.appendChild(foot);

    if (!reduced) {
      window.setTimeout(function () {
        Confetti.burst(110, window.innerWidth / 2, window.innerHeight * 0.3);
      }, 320);
    }
  }

  /* ------------------------------ misc ------------------------------ */
  function toast(text) {
    if (!inited) init();
    if (!refs.toast) return;
    refs.toast.textContent = String(text == null ? '' : text);
    refs.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      refs.toast.classList.remove('show');
    }, 2200);
  }

  function setStatus(text) {
    if (!inited) init();
    if (refs.statusLine) refs.statusLine.textContent = String(text == null ? '' : text);
  }

  /* ------------------------------ public api ------------------------------ */
  var api = {
    init: init,
    showPhase: showPhase,
    onJoin: function (fn) { if (typeof fn === 'function') cb.join = fn; },
    onStart: function (fn) { if (typeof fn === 'function') cb.start = fn; },
    onEndGame: function (fn) { if (typeof fn === 'function') cb.end = fn; },
    setRoomCode: setRoomCode,
    setRoster: setRoster,
    setRole: setRole,
    setPrompt: setPrompt,
    setRoundInfo: setRoundInfo,
    setTimer: setTimer,
    flashCorrect: flashCorrect,
    flashDrift: flashDrift,
    renderReveal: renderReveal,
    toast: toast,
    setStatus: setStatus,
    /* small extras other files may find handy — not part of the contract */
    confetti: function (n, x, y) { Confetti.burst(n, x, y); }
  };

  window.DriftUI = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window, document);
