/* drift — canvas.js
 * Drawing engine for realtime multiplayer Pictionary.
 * Classic script. Defines exactly one global: window.DriftCanvas
 *
 * Coordinate system: all stroke points are NORMALIZED floats 0..1 relative to
 * the canvas's CSS box, so a stroke drawn on a phone renders identically on a
 * laptop (and on the tiny reveal filmstrip canvases).
 */
(function (window, document) {
  'use strict';

  // ---------------------------------------------------------------------------
  // tunables
  // ---------------------------------------------------------------------------
  var BATCH_MS = 60;          // how often we flush new points to the network
  var MIN_DIST_PX = 1.5;      // drop points closer than this (payload hygiene)
  var SPEED_SLOW = 0.15;      // px/ms at or below -> full width
  var SPEED_FAST = 2.2;       // px/ms at or above -> thinnest width
  var WIDTH_MIN_MUL = 0.72;   // clamp: fast strokes never thinner than this
  var WIDTH_MAX_MUL = 1.06;   // clamp: slow strokes never fatter than this
  var DEFAULT_COLOR = '#17171b';
  var DEFAULT_SIZE = 6;
  var DEFAULT_REPLAY_MS = 2000;

  // ---------------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------------
  function isFn(f) { return typeof f === 'function'; }

  function safe(f, a) {
    if (!isFn(f)) return;
    try { f(a); } catch (e) { /* never let a listener break drawing */ }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function clamp01(v) {
    if (typeof v !== 'number' || v !== v) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return (typeof n === 'number' && n === n && isFinite(n)) ? n : fallback;
  }

  // A point is [x, y] normalized, optionally [x, y, w] where w is a width
  // multiplier captured at draw time (so remote peers see the same taper).
  function ptX(p) { return clamp01(p && p[0]); }
  function ptY(p) { return clamp01(p && p[1]); }
  function ptW(p) {
    var w = p && p.length > 2 ? p[2] : 1;
    return clamp(num(w, 1), WIDTH_MIN_MUL, WIDTH_MAX_MUL);
  }

  function normalizePoints(points) {
    if (!points || !points.length) return [];
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) continue;
      if (typeof p === 'object' && !(p instanceof Array)) {
        // tolerate {x,y} shaped points from other clients
        out.push([clamp01(num(p.x, 0)), clamp01(num(p.y, 0)), clamp(num(p.w, 1), WIDTH_MIN_MUL, WIDTH_MAX_MUL)]);
      } else if (p.length >= 2) {
        out.push([clamp01(num(p[0], 0)), clamp01(num(p[1], 0)), ptW(p)]);
      }
    }
    return out;
  }

  function normalizeStroke(s) {
    if (!s || typeof s !== 'object') return null;
    return {
      seq: num(s.seq, 0),
      color: typeof s.color === 'string' && s.color ? s.color : DEFAULT_COLOR,
      size: clamp(num(s.size, DEFAULT_SIZE), 0.5, 200),
      points: normalizePoints(s.points),
      local: !!s.local
    };
  }

  function normalizeStrokeList(strokes) {
    var out = [];
    if (!strokes || !strokes.length) return out;
    for (var i = 0; i < strokes.length; i++) {
      var s = normalizeStroke(strokes[i]);
      if (s) out.push(s);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // low level rendering primitives (shared by live canvas + replay)
  // ---------------------------------------------------------------------------

  // Prepare a 2d context for ink: round caps/joins, alpha blending.
  function inkStyle(ctx, color, lineWidth) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.35, lineWidth);
  }

  function mid(a, b) { return (a + b) / 2; }

  /**
   * Draw the quadratic-smoothed segment that *ends* at index `i` of `pts`.
   * Smoothing scheme: each raw point is a control point, and the curve runs
   * midpoint -> midpoint. That means drawing segment i finalizes the curve
   * between mid(i-1,i) and mid(i,i+1 pending), which is exactly what makes
   * incremental drawing look identical to a full redraw.
   *
   * w/h are the device-independent pixel dims to scale normalized coords into.
   */
  function drawSegment(ctx, pts, i, color, size, w, h) {
    if (!pts || i <= 0 || i >= pts.length) return;
    var p0 = pts[i - 1], p1 = pts[i];
    var x0 = ptX(p0) * w, y0 = ptY(p0) * h;
    var x1 = ptX(p1) * w, y1 = ptY(p1) * h;

    // width tapers from the previous point's multiplier to this one's
    var lw = size * (ptW(p0) + ptW(p1)) / 2;
    inkStyle(ctx, color, lw);

    ctx.beginPath();
    if (i === 1) {
      // first segment: from the true start point to the midpoint of 0..1
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0, y0, mid(x0, x1), mid(y0, y1));
      ctx.lineTo(mid(x0, x1), mid(y0, y1));
    } else {
      var pm = pts[i - 2];
      var xm = ptX(pm) * w, ym = ptY(pm) * h;
      // start at midpoint of (i-2, i-1), curve through (i-1) to midpoint of (i-1, i)
      ctx.moveTo(mid(xm, x0), mid(ym, y0));
      ctx.quadraticCurveTo(x0, y0, mid(x0, x1), mid(y0, y1));
    }
    ctx.stroke();

    // If this is the final point of the stroke, close the tail out to it so the
    // line doesn't visually stop half a segment short.
    if (i === pts.length - 1) {
      ctx.beginPath();
      ctx.moveTo(mid(x0, x1), mid(y0, y1));
      ctx.quadraticCurveTo(x1, y1, x1, y1);
      ctx.stroke();
    }
  }

  // A single-point stroke is a dot.
  function drawDot(ctx, pts, color, size, w, h) {
    var p = pts[0];
    if (!p) return;
    var x = ptX(p) * w, y = ptY(p) * h;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, Math.max(0.4, (size * ptW(p)) / 2), 0, Math.PI * 2);
    ctx.fill();
  }

  /** Draw a complete stroke (or the first `upto` points of it). */
  function drawStroke(ctx, stroke, w, h, upto) {
    if (!stroke) return;
    var pts = stroke.points;
    if (!pts || !pts.length) return;
    var n = (typeof upto === 'number') ? Math.min(upto, pts.length) : pts.length;
    if (n <= 0) return;
    if (n === 1) { drawDot(ctx, pts, stroke.color, stroke.size, w, h); return; }
    for (var i = 1; i < n; i++) {
      drawSegment(ctx, pts, i, stroke.color, stroke.size, w, h);
    }
  }

  /**
   * Resize a canvas's backing store for devicePixelRatio and return
   * {ctx, w, h} where w/h are CSS pixel dims (the ctx is pre-scaled so you
   * draw in CSS pixels).
   */
  function fitCanvas(canvas) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = window.devicePixelRatio || 1;
    // clientWidth/Height are the UNTRANSFORMED layout box. getBoundingClientRect
    // is transform-aware, so measuring mid phase-in (which scales the panel)
    // once produced an 8800x8800 backing store (~310MB). Layout box first.
    var rect = (canvas.getBoundingClientRect && canvas.getBoundingClientRect()) || { width: 0, height: 0 };
    var cssW = Math.max(1, Math.round(canvas.clientWidth || rect.width || canvas.width || 1));
    var cssH = Math.max(1, Math.round(canvas.clientHeight || rect.height || canvas.height || 1));
    // Hard ceiling: phones fall over well before this, and nothing legitimate
    // needs a bigger surface than a 4K-ish backing store.
    var MAX_BACKING = 4096;
    var bw = Math.min(MAX_BACKING, Math.max(1, Math.round(cssW * dpr)));
    var bh = Math.min(MAX_BACKING, Math.max(1, Math.round(cssH * dpr)));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
  }

  // ---------------------------------------------------------------------------
  // the engine (one live canvas per page; replay is per-call & stateless)
  // ---------------------------------------------------------------------------
  var S = {
    canvas: null,
    ctx: null,
    w: 1,
    h: 1,
    dpr: 1,

    strokes: [],
    bySeq: Object.create(null),

    drawable: true,
    tool: { color: DEFAULT_COLOR, size: DEFAULT_SIZE },

    nextSeq: 0,
    active: null,          // in-progress local stroke state
    pointerId: null,

    flushTimer: null,
    pendingFlush: false,

    onStrokeBatch: null,
    toolChangeCbs: [],
    undoCbs: [],
    clearCbs: [],

    resizeObserver: null,
    resizeRaf: 0,
    bound: false
  };

  function fireAll(list, payload) {
    for (var i = 0; i < list.length; i++) safe(list[i], payload);
  }

  function resetState() {
    S.strokes = [];
    S.bySeq = Object.create(null);
  }

  function indexStroke(stroke) {
    S.bySeq[String(stroke.seq)] = stroke;
    if (stroke.seq >= S.nextSeq) S.nextSeq = stroke.seq + 1;
  }

  function clearSurface() {
    if (!S.ctx) return;
    S.ctx.save();
    S.ctx.setTransform(1, 0, 0, 1, 0, 0);
    S.ctx.clearRect(0, 0, S.canvas.width, S.canvas.height);
    S.ctx.restore();
  }

  function redraw() {
    if (!S.ctx) return;
    clearSurface();
    for (var i = 0; i < S.strokes.length; i++) {
      drawStroke(S.ctx, S.strokes[i], S.w, S.h);
    }
  }

  function measure() {
    var f = fitCanvas(S.canvas);
    if (!f) return false;
    S.ctx = f.ctx;
    S.w = f.w;
    S.h = f.h;
    S.dpr = f.dpr;
    return true;
  }

  function handleResize() {
    if (!S.canvas) return;
    if (S.resizeRaf) return;
    S.resizeRaf = window.requestAnimationFrame(function () {
      S.resizeRaf = 0;
      // resizing the backing store wipes it, so always re-render
      if (measure()) redraw();
    });
  }

  // --- drawable affordance ---------------------------------------------------
  function applyDrawableStyle() {
    if (!S.canvas || !S.canvas.style) return;
    if (S.drawable) {
      S.canvas.style.cursor = 'crosshair';
      S.canvas.style.opacity = '1';
      S.canvas.style.touchAction = 'none';
      if (S.canvas.classList) {
        S.canvas.classList.remove('not-drawable');
        S.canvas.classList.add('drawable');
      }
      S.canvas.removeAttribute('aria-disabled');
    } else {
      S.canvas.style.cursor = 'not-allowed';
      S.canvas.style.opacity = '0.82';
      S.canvas.style.touchAction = 'auto';
      if (S.canvas.classList) {
        S.canvas.classList.remove('drawable');
        S.canvas.classList.add('not-drawable');
      }
      S.canvas.setAttribute('aria-disabled', 'true');
    }
    S.canvas.style.transition = 'opacity 140ms ease';
  }

  // --- local input ----------------------------------------------------------
  function eventPoint(e) {
    var rect = S.canvas.getBoundingClientRect();
    var cx, cy;
    if (typeof e.clientX === 'number') {
      cx = e.clientX; cy = e.clientY;
    } else if (e.touches && e.touches.length) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length) {
      cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY;
    } else {
      return null;
    }
    return {
      px: cx - rect.left,
      py: cy - rect.top,
      t: (e.timeStamp && e.timeStamp > 0) ? e.timeStamp : (window.performance ? performance.now() : Date.now())
    };
  }

  // Width multiplier from pointer speed: fast = thinner. Smoothed so it doesn't
  // flicker, and clamped so the line always stays readable.
  function widthMulFor(speed, prevMul) {
    var t = (speed - SPEED_SLOW) / (SPEED_FAST - SPEED_SLOW);
    t = clamp(t, 0, 1);
    var target = WIDTH_MAX_MUL + (WIDTH_MIN_MUL - WIDTH_MAX_MUL) * t;
    var prev = typeof prevMul === 'number' ? prevMul : 1;
    return clamp(prev + (target - prev) * 0.35, WIDTH_MIN_MUL, WIDTH_MAX_MUL);
  }

  function scheduleFlush() {
    if (S.flushTimer) return;
    S.flushTimer = window.setTimeout(function () {
      S.flushTimer = null;
      flushBatch(false);
    }, BATCH_MS);
  }

  function cancelFlushTimer() {
    if (S.flushTimer) {
      window.clearTimeout(S.flushTimer);
      S.flushTimer = null;
    }
  }

  /** Emit the points accumulated since the last emit for the active stroke. */
  function flushBatch(final) {
    var a = S.active;
    if (!a) return;
    var stroke = a.stroke;
    var from = a.sent;
    var to = stroke.points.length;
    if (to <= from) {
      if (final) a.sent = to;
      return;
    }
    var slice = [];
    for (var i = from; i < to; i++) {
      var p = stroke.points[i];
      // round to 4 decimals — plenty at any realistic canvas size, and it
      // keeps the websocket payload small.
      slice.push([
        Math.round(p[0] * 10000) / 10000,
        Math.round(p[1] * 10000) / 10000,
        Math.round(p[2] * 1000) / 1000
      ]);
    }
    a.sent = to;
    safe(S.onStrokeBatch, {
      seq: stroke.seq,
      color: stroke.color,
      size: stroke.size,
      points: slice
    });
  }

  function beginStroke(e) {
    if (!S.drawable || !S.canvas || S.active) return;
    var pt = eventPoint(e);
    if (!pt) return;

    var stroke = {
      seq: S.nextSeq++,
      color: S.tool.color,
      size: S.tool.size,
      points: [],
      local: true
    };
    S.bySeq[String(stroke.seq)] = stroke;
    S.strokes.push(stroke);

    S.active = {
      stroke: stroke,
      sent: 0,
      lastPx: pt.px,
      lastPy: pt.py,
      lastT: pt.t,
      mul: 1
    };

    stroke.points.push([pt.px / S.w, pt.py / S.h, 1]);
    // immediate dot so the first touch feels instant
    drawDot(S.ctx, stroke.points, stroke.color, stroke.size, S.w, S.h);
    scheduleFlush();
  }

  function extendStroke(e) {
    var a = S.active;
    if (!a || !S.drawable) return;

    // coalesce: on supporting browsers grab every intermediate sample
    var events = null;
    if (isFn(e.getCoalescedEvents)) {
      try { events = e.getCoalescedEvents(); } catch (err) { events = null; }
    }
    if (!events || !events.length) events = [e];

    for (var k = 0; k < events.length; k++) {
      var pt = eventPoint(events[k]);
      if (!pt) continue;
      var dx = pt.px - a.lastPx;
      var dy = pt.py - a.lastPy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DIST_PX) continue;

      var dt = Math.max(1, pt.t - a.lastT);
      a.mul = widthMulFor(dist / dt, a.mul);

      a.lastPx = pt.px; a.lastPy = pt.py; a.lastT = pt.t;

      var pts = a.stroke.points;
      pts.push([pt.px / S.w, pt.py / S.h, a.mul]);
      drawSegment(S.ctx, pts, pts.length - 1, a.stroke.color, a.stroke.size, S.w, S.h);
    }
    scheduleFlush();
  }

  function endStroke() {
    if (!S.active) return;
    cancelFlushTimer();
    flushBatch(true);
    // paint the tail cap
    var stroke = S.active.stroke;
    if (stroke.points.length > 1) {
      drawSegment(S.ctx, stroke.points, stroke.points.length - 1, stroke.color, stroke.size, S.w, S.h);
    }
    S.active = null;
    S.pointerId = null;
  }

  function bindInput() {
    if (S.bound || !S.canvas) return;
    S.bound = true;
    var c = S.canvas;

    if (window.PointerEvent) {
      c.addEventListener('pointerdown', function (e) {
        if (!S.drawable) return;
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.pointerType === 'touch' && e.cancelable) e.preventDefault();
        S.pointerId = e.pointerId;
        if (isFn(c.setPointerCapture)) {
          try { c.setPointerCapture(e.pointerId); } catch (err) {}
        }
        beginStroke(e);
      }, { passive: false });

      c.addEventListener('pointermove', function (e) {
        if (!S.active) return;
        if (S.pointerId !== null && e.pointerId !== S.pointerId) return;
        if (e.cancelable) e.preventDefault();
        extendStroke(e);
      }, { passive: false });

      var up = function (e) {
        if (!S.active) return;
        if (S.pointerId !== null && e.pointerId !== undefined && e.pointerId !== S.pointerId) return;
        if (e.cancelable) e.preventDefault();
        endStroke();
      };
      c.addEventListener('pointerup', up, { passive: false });
      c.addEventListener('pointercancel', up, { passive: false });
      c.addEventListener('pointerleave', function (e) {
        // only mouse-out-of-canvas ends the stroke; captured pointers keep going
        if (e.pointerType === 'mouse' && S.active) endStroke();
      });
    } else {
      // legacy touch + mouse fallback
      c.addEventListener('touchstart', function (e) {
        if (!S.drawable) return;
        if (e.cancelable) e.preventDefault();
        beginStroke(e);
      }, { passive: false });
      c.addEventListener('touchmove', function (e) {
        if (!S.active) return;
        if (e.cancelable) e.preventDefault();
        extendStroke(e);
      }, { passive: false });
      c.addEventListener('touchend', function (e) {
        if (e.cancelable) e.preventDefault();
        endStroke();
      }, { passive: false });
      c.addEventListener('touchcancel', endStroke);

      c.addEventListener('mousedown', function (e) {
        if (!S.drawable || e.button !== 0) return;
        beginStroke(e);
      });
      window.addEventListener('mousemove', function (e) {
        if (S.active) extendStroke(e);
      });
      window.addEventListener('mouseup', function () {
        if (S.active) endStroke();
      });
    }

    // stop iOS long-press / context menu interrupting a stroke
    c.addEventListener('contextmenu', function (e) {
      if (S.drawable) e.preventDefault();
    });

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (window.ResizeObserver) {
      try {
        S.resizeObserver = new window.ResizeObserver(handleResize);
        S.resizeObserver.observe(c);
      } catch (err) { /* ignore */ }
    }
    // a lost tab or backgrounded app shouldn't leave a stroke open forever
    window.addEventListener('blur', function () { if (S.active) endStroke(); });
  }

  // --- toolbar wiring -------------------------------------------------------
  function setActiveIn(container, selector, el) {
    if (!container || !isFn(container.querySelectorAll)) return;
    var sibs = container.querySelectorAll(selector);
    for (var i = 0; i < sibs.length; i++) {
      if (sibs[i].classList) sibs[i].classList.remove('active');
      sibs[i].setAttribute('aria-pressed', 'false');
    }
    if (el) {
      if (el.classList) el.classList.add('active');
      el.setAttribute('aria-pressed', 'true');
    }
  }

  function wireToolbar() {
    var bar;
    try { bar = document.getElementById('tool-bar'); } catch (e) { bar = null; }
    if (!bar) return; // fail silently — ui.js may not have rendered yet

    try {
      var swatches = bar.querySelectorAll('.swatch[data-color]');
      for (var i = 0; i < swatches.length; i++) {
        (function (el) {
          el.addEventListener('click', function () {
            var color = el.getAttribute('data-color');
            if (!color) return;
            api.setTool({ color: color });
            setActiveIn(bar, '.swatch[data-color]', el);
            fireAll(S.toolChangeCbs, { color: S.tool.color, size: S.tool.size });
          });
        })(swatches[i]);
      }

      var sizes = bar.querySelectorAll('.size-btn[data-size]');
      for (var j = 0; j < sizes.length; j++) {
        (function (el) {
          el.addEventListener('click', function () {
            var size = num(el.getAttribute('data-size'), null);
            if (size === null) return;
            api.setTool({ size: size });
            setActiveIn(bar, '.size-btn[data-size]', el);
            fireAll(S.toolChangeCbs, { color: S.tool.color, size: S.tool.size });
          });
        })(sizes[j]);
      }

      // reflect the initial tool state in the DOM
      var initColor = bar.querySelector('.swatch[data-color="' + S.tool.color + '"]');
      if (initColor) setActiveIn(bar, '.swatch[data-color]', initColor);
      var initSize = bar.querySelector('.size-btn[data-size="' + S.tool.size + '"]');
      if (initSize) setActiveIn(bar, '.size-btn[data-size]', initSize);

      var undoBtn = document.getElementById('undo-btn');
      if (undoBtn) {
        undoBtn.addEventListener('click', function () {
          var removed = api.undoLocal();
          fireAll(S.undoCbs, removed ? { seq: removed.seq } : null);
        });
      }

      var clearBtn = document.getElementById('clear-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          api.clear();
          fireAll(S.clearCbs, null);
        });
      }
    } catch (e) { /* fail silently */ }
  }

  // ---------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------
  var api = {};

  api.init = function (canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || !canvasEl.getContext) return api;

    S.canvas = canvasEl;
    S.onStrokeBatch = isFn(opts.onStrokeBatch) ? opts.onStrokeBatch : null;
    if (opts.color) S.tool.color = opts.color;
    if (opts.size !== undefined) S.tool.size = clamp(num(opts.size, DEFAULT_SIZE), 0.5, 200);
    if (opts.drawable !== undefined) S.drawable = !!opts.drawable;

    resetState();
    S.nextSeq = 0;
    S.active = null;
    cancelFlushTimer();

    if (!measure()) return api;
    clearSurface();
    applyDrawableStyle();
    bindInput();
    wireToolbar();

    if (isFn(opts.onToolChange)) S.toolChangeCbs.push(opts.onToolChange);
    if (isFn(opts.onUndo)) S.undoCbs.push(opts.onUndo);
    if (isFn(opts.onClear)) S.clearCbs.push(opts.onClear);

    return api;
  };

  api.setDrawable = function (bool) {
    S.drawable = !!bool;
    if (!S.drawable && S.active) endStroke();
    applyDrawableStyle();
    return S.drawable;
  };

  api.isDrawable = function () { return S.drawable; };

  api.setTool = function (tool) {
    if (!tool || typeof tool !== 'object') return { color: S.tool.color, size: S.tool.size };
    if (typeof tool.color === 'string' && tool.color) S.tool.color = tool.color;
    if (tool.size !== undefined) {
      var sz = num(tool.size, null);
      if (sz !== null) S.tool.size = clamp(sz, 0.5, 200);
    }
    return { color: S.tool.color, size: S.tool.size };
  };

  api.getTool = function () { return { color: S.tool.color, size: S.tool.size }; };

  /**
   * HOT PATH. Append points to an existing stroke and draw only the new
   * segments. Never full-redraws.
   */
  api.applyBatch = function (batch) {
    if (!batch || typeof batch !== 'object') return;
    var pts = normalizePoints(batch.points);
    if (!pts.length) return;

    var key = String(num(batch.seq, 0));
    var stroke = S.bySeq[key];

    if (!stroke) {
      stroke = {
        seq: num(batch.seq, 0),
        color: (typeof batch.color === 'string' && batch.color) ? batch.color : DEFAULT_COLOR,
        size: clamp(num(batch.size, DEFAULT_SIZE), 0.5, 200),
        points: [],
        local: false
      };
      indexStroke(stroke);
      S.strokes.push(stroke);
    }

    if (!S.ctx) {
      // not initialized yet — still keep the model consistent
      for (var q = 0; q < pts.length; q++) stroke.points.push(pts[q]);
      return;
    }

    var startLen = stroke.points.length;
    for (var i = 0; i < pts.length; i++) stroke.points.push(pts[i]);

    if (startLen === 0 && stroke.points.length === 1) {
      drawDot(S.ctx, stroke.points, stroke.color, stroke.size, S.w, S.h);
      return;
    }

    // Redraw from one segment back: the previous tail cap was provisional, and
    // re-stroking it is what makes batches "flow" instead of popping.
    var from = Math.max(1, startLen - 1);
    for (var j = from; j < stroke.points.length; j++) {
      drawSegment(S.ctx, stroke.points, j, stroke.color, stroke.size, S.w, S.h);
    }
  };

  /** Full idempotent redraw from a complete stroke list. */
  api.renderAll = function (strokes) {
    var list = normalizeStrokeList(strokes);
    // preserve local authorship flags across a server-driven re-render
    var prevLocal = Object.create(null);
    for (var k = 0; k < S.strokes.length; k++) {
      if (S.strokes[k].local) prevLocal[String(S.strokes[k].seq)] = true;
    }

    resetState();
    for (var i = 0; i < list.length; i++) {
      if (prevLocal[String(list[i].seq)]) list[i].local = true;
      S.strokes.push(list[i]);
      indexStroke(list[i]);
    }
    if (S.ctx) redraw();
    return S.strokes;
  };

  api.getStrokes = function () { return S.strokes; };

  api.clear = function () {
    cancelFlushTimer();
    S.active = null;
    resetState();
    clearSurface();
  };

  /** Remove the newest stroke this client authored. Returns it, or null. */
  api.undoLocal = function () {
    for (var i = S.strokes.length - 1; i >= 0; i--) {
      if (S.strokes[i].local) {
        var removed = S.strokes.splice(i, 1)[0];
        delete S.bySeq[String(removed.seq)];
        if (S.ctx) redraw();
        return removed;
      }
    }
    return null;
  };

  /** Remove any stroke by seq (used when a peer undoes). */
  api.removeStroke = function (seq) {
    var key = String(num(seq, NaN));
    if (!S.bySeq[key]) return null;
    for (var i = 0; i < S.strokes.length; i++) {
      if (String(S.strokes[i].seq) === key) {
        var removed = S.strokes.splice(i, 1)[0];
        delete S.bySeq[key];
        if (S.ctx) redraw();
        return removed;
      }
    }
    return null;
  };

  api.onToolChange = function (cb) {
    if (isFn(cb)) S.toolChangeCbs.push(cb);
    return api;
  };
  api.onUndo = function (cb) {
    if (isFn(cb)) S.undoCbs.push(cb);
    return api;
  };
  api.onClear = function (cb) {
    if (isFn(cb)) S.clearCbs.push(cb);
    return api;
  };

  api.resize = function () {
    if (measure()) redraw();
  };

  // ---------------------------------------------------------------------------
  // replay — the reveal showpiece. Fully per-call state, no singletons, so any
  // number of filmstrip canvases can animate simultaneously.
  // ---------------------------------------------------------------------------
  api.replay = function (targetCanvasEl, strokes, opts) {
    opts = opts || {};
    var onDone = isFn(opts.onDone) ? opts.onDone : null;
    var cancelled = false;
    var raf = 0;

    var handle = {
      cancel: function () {
        cancelled = true;
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      done: false
    };

    var fit = targetCanvasEl ? fitCanvas(targetCanvasEl) : null;
    var list = normalizeStrokeList(strokes);

    if (!fit) {
      if (onDone) window.setTimeout(function () { if (!cancelled) { handle.done = true; safe(onDone); } }, 0);
      return handle;
    }

    var ctx = fit.ctx, W = fit.w, H = fit.h;

    function wipe() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, targetCanvasEl.width, targetCanvasEl.height);
      ctx.restore();
    }

    wipe();

    // Nothing to animate.
    var totalSegs = 0;
    for (var i = 0; i < list.length; i++) {
      totalSegs += Math.max(1, (list[i].points.length - 1));
    }
    if (!list.length || totalSegs <= 0) {
      if (onDone) window.setTimeout(function () { if (!cancelled) { handle.done = true; safe(onDone); } }, 0);
      return handle;
    }

    var duration = Math.max(120, num(opts.duration, DEFAULT_REPLAY_MS));
    var start = (window.performance ? performance.now() : Date.now());

    // progress is measured in "segments drawn" across the whole drawing, so
    // long strokes take proportionally longer — it reads like real drawing.
    var drawnSi = 0;   // index of stroke currently being drawn
    var drawnPi = 0;   // how many points of that stroke are on screen

    function segmentsBefore(si) {
      var n = 0;
      for (var k = 0; k < si; k++) n += Math.max(1, list[k].points.length - 1);
      return n;
    }

    function ease(t) {
      // very gentle ease-out; keeps the end from feeling abrupt
      return 1 - Math.pow(1 - t, 1.35);
    }

    function frame(now) {
      raf = 0;
      if (cancelled) return;

      var elapsed = (typeof now === 'number' ? now : (window.performance ? performance.now() : Date.now())) - start;
      var t = clamp(elapsed / duration, 0, 1);
      var targetSegs = ease(t) * totalSegs;

      // advance, drawing only what's newly revealed (incremental, like live ink)
      var guard = 0;
      while (drawnSi < list.length && guard++ < 100000) {
        var stroke = list[drawnSi];
        var pts = stroke.points;
        var base = segmentsBefore(drawnSi);

        if (!pts.length) { drawnSi++; drawnPi = 0; continue; }

        if (pts.length === 1) {
          if (targetSegs >= base + 1) {
            if (drawnPi === 0) {
              drawDot(ctx, pts, stroke.color, stroke.size, W, H);
              drawnPi = 1;
            }
            drawnSi++; drawnPi = 0;
            continue;
          }
          break;
        }

        var want = Math.floor(clamp(targetSegs - base, 0, pts.length - 1));
        if (want <= drawnPi) break;

        for (var s = drawnPi + 1; s <= want; s++) {
          // seed the moveTo for the very first segment of the stroke
          drawSegment(ctx, pts, s, stroke.color, stroke.size, W, H);
        }
        drawnPi = want;

        if (drawnPi >= pts.length - 1) {
          drawnSi++;
          drawnPi = 0;
          continue;
        }
        break;
      }

      if (t >= 1) {
        // guarantee a pixel-exact final frame
        wipe();
        for (var f = 0; f < list.length; f++) drawStroke(ctx, list[f], W, H);
        handle.done = true;
        if (onDone) safe(onDone);
        return;
      }

      raf = window.requestAnimationFrame(frame);
    }

    raf = window.requestAnimationFrame(frame);
    return handle;
  };

  /** Static (non-animated) render of a drawing onto any other canvas. */
  api.renderTo = function (targetCanvasEl, strokes) {
    var fit = targetCanvasEl ? fitCanvas(targetCanvasEl) : null;
    if (!fit) return;
    var list = normalizeStrokeList(strokes);
    fit.ctx.save();
    fit.ctx.setTransform(1, 0, 0, 1, 0, 0);
    fit.ctx.clearRect(0, 0, targetCanvasEl.width, targetCanvasEl.height);
    fit.ctx.restore();
    for (var i = 0; i < list.length; i++) drawStroke(fit.ctx, list[i], fit.w, fit.h);
  };

  window.DriftCanvas = api;
})(window, document);
