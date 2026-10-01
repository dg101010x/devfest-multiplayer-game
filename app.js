// DRIFT — orchestration layer.
// Owns Firebase, the round lifecycle, and the wiring between DriftUI /
// DriftCanvas / DriftChat / DriftGemini.
//
// Single-writer model: the HOST client drives every state transition (round
// start, round end, rotation, reveal). Other clients only ever write their own
// strokes, their own chat messages, and their own player doc. This trades a bit
// of resilience for having zero write races, which is the right call for a
// room of people standing next to each other.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection,
  addDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CFG = window.DRIFT_CONFIG || {};
const ROUND_SECONDS = 70;
const GEM_ID = "__gem__";

let db = null, auth = null, uid = null;
let online = false;           // false => local-only fallback mode

// ---------------------------------------------------------------- state
const S = {
  code: null,
  me: null,                   // {id,name,emoji,joinOrder}
  isHost: false,
  players: [],
  room: null,
  round: null,                // live round doc
  roundId: null,
  totalRounds: 4,
  promptDeck: [],
  chain: [],                  // completed rounds, for the reveal
  seq: 0,
  strokesBySeq: new Map(),
  lastGuess: null,            // drives the "drift" when nobody gets it
  judging: false,
  timerHandle: null,
  gemHandle: null,
  unsubs: [],
};

const EMOJI = ["🦊","🐙","🐸","🦄","🐧","🦁","🐳","🦖","🐝","🦋","🐨","🦉"];
const nowMs = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 10);
const code4 = () => {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, they read badly on a projector
  return Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join("");
};

// Firestore rejects nested arrays, so points travel flat.
// canvas.js uses [x, y, w] triples (w = speed taper), so the stride is 3.
const flat = (pts) => {
  const o = [];
  for (const p of pts) o.push(+p[0].toFixed(4), +p[1].toFixed(4), +(p.length > 2 ? p[2] : 1).toFixed(3));
  return o;
};
const unflat = (a) => {
  const o = [];
  for (let i = 0; i + 2 < a.length; i += 3) o.push([a[i], a[i + 1], a[i + 2]]);
  return o;
};

const cleanup = () => { S.unsubs.forEach((u) => { try { u(); } catch {} }); S.unsubs = []; };

// ---------------------------------------------------------------- boot
async function boot() {
  DriftUI.init();
  DriftUI.onJoin(handleJoin);
  DriftUI.onStart(handleStart);
  DriftUI.onEndGame(() => finishGame());

  DriftChat.init({
    onSend: handleSend,
    onReaction: (emoji) => pushMessage({ kind: "reaction", body: emoji }),
    onTyping: () => {},
  });

  DriftCanvas.init(document.getElementById("drift-canvas"), {
    onStrokeBatch: handleStrokeBatch,
  });
  DriftCanvas.onClear(() => pushCanvasEvent({ op: "clear" }));
  DriftCanvas.onUndo(() => pushCanvasEvent({ op: "undo", strokes: DriftCanvas.getStrokes() }));
  DriftCanvas.setDrawable(false);

  const fb = CFG.firebase || {};
  if (!fb.apiKey || fb.apiKey === "PASTE_ME") {
    console.warn("[drift] no Firebase config — running single-device fallback");
    DriftUI.toast("offline mode — add Firebase config to go multiplayer");
    return;
  }
  try {
    const appFb = initializeApp(fb);
    db = getFirestore(appFb);
    auth = getAuth(appFb);
    await signInAnonymously(auth);
    await new Promise((res) => onAuthStateChanged(auth, (u) => { if (u) { uid = u.uid; res(); } }));
    online = true;
  } catch (e) {
    console.error("[drift] firebase init failed", e);
    DriftUI.toast("couldn't reach Firebase — offline mode");
  }
}

// ---------------------------------------------------------------- join
async function handleJoin({ name, code }) {
  const clean = (name || "").trim().slice(0, 18) || "player";
  S.me = { id: uid || rid(), name: clean, emoji: EMOJI[(Math.random() * EMOJI.length) | 0], joinOrder: nowMs() };

  if (!online) {
    S.code = "SOLO"; S.isHost = true; S.players = [S.me];
    DriftUI.setRoomCode("SOLO"); DriftUI.setRoster(S.players, null);
    DriftUI.showPhase("lobby");
    return;
  }

  if (code) {
    S.code = code.trim().toUpperCase();
    const snap = await getDoc(doc(db, "rooms", S.code));
    if (!snap.exists()) { DriftUI.toast(`no room "${S.code}"`); return; }
    S.isHost = false;
  } else {
    S.code = code4();
    S.isHost = true;
    await setDoc(doc(db, "rooms", S.code), {
      code: S.code, hostId: S.me.id, status: "lobby",
      roundNumber: 0, totalRounds: S.totalRounds,
      currentRoundId: null, createdAt: serverTimestamp(),
    });
  }

  await setDoc(doc(db, "rooms", S.code, "players", S.me.id), S.me);
  window.history.replaceState({}, "", `?r=${S.code}`);
  DriftUI.setRoomCode(S.code);
  DriftUI.showPhase("lobby");
  subscribeRoom();

  // Presence heartbeat + best-effort departure.
  setInterval(() => {
    if (S.code && S.me) updateDoc(doc(db, "rooms", S.code, "players", S.me.id), { lastSeen: nowMs() }).catch(() => {});
  }, 10000);
  window.addEventListener("beforeunload", () => {
    try { deleteDoc(doc(db, "rooms", S.code, "players", S.me.id)); } catch {}
  });
}

function subscribeRoom() {
  S.unsubs.push(onSnapshot(doc(db, "rooms", S.code), (snap) => {
    if (!snap.exists()) return;
    const r = snap.data();
    const prevRound = S.roundId;
    S.room = r;
    S.totalRounds = r.totalRounds || S.totalRounds;

    if (r.status === "reveal") return showReveal(r);
    if (r.currentRoundId && r.currentRoundId !== prevRound) {
      S.roundId = r.currentRoundId;
      subscribeRound(r.currentRoundId);
    }
  }));

  S.unsubs.push(onSnapshot(
    query(collection(db, "rooms", S.code, "players"), orderBy("joinOrder")),
    (snap) => {
      const before = new Set(S.players.map((p) => p.id));
      S.players = snap.docs.map((d) => d.data());
      S.players.filter((p) => !before.has(p.id) && before.size)
        .forEach((p) => DriftChat.addMessage({ id: `sys-join-${p.id}`, kind: "system", body: `${p.emoji} ${p.name} joined` }));
      DriftUI.setRoster(S.players, S.round?.drawerId || null);
    }
  ));
}

// ---------------------------------------------------------------- rounds
async function handleStart() {
  if (!S.isHost) return;
  if (online && S.players.length < 2) {
    DriftUI.toast("need another player — share the link! (GEM will play too)");
  }
  S.promptDeck = await DriftGemini.generatePrompts(12);
  S.chain = [];
  await startRound(1, S.promptDeck.pop(), "seed");
}

async function startRound(number, prompt, source) {
  const order = [...S.players].sort((a, b) => a.joinOrder - b.joinOrder);
  const drawer = order[(number - 1) % order.length];
  const id = rid();
  const payload = {
    id, roundNumber: number, drawerId: drawer.id, drawerName: drawer.name,
    prompt, source, status: "drawing",
    endsAt: Timestamp.fromMillis(nowMs() + ROUND_SECONDS * 1000),
    winningGuess: null, winnerId: null, winnerName: null,
  };
  if (!online) { S.roundId = id; S.round = payload; return enterRound(payload); }
  await setDoc(doc(db, "rooms", S.code, "rounds", id), payload);
  await updateDoc(doc(db, "rooms", S.code), { status: "playing", roundNumber: number, currentRoundId: id });
}

function subscribeRound(id) {
  S.unsubs.push(onSnapshot(doc(db, "rooms", S.code, "rounds", id), (snap) => {
    if (!snap.exists()) return;
    const r = snap.data();
    const wasLive = S.round?.status === "drawing";
    S.round = r;
    if (r.status === "drawing" && !wasLive) enterRound(r);
    if (r.status === "ended" && wasLive) endRoundLocal(r);
  }));

  // Stroke batches are append-only docs; each snapshot delivers only new ones.
  S.unsubs.push(onSnapshot(collection(db, "rooms", S.code, "rounds", id, "strokes"), (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type !== "added") return;
      const b = ch.doc.data();
      if (b.by === S.me.id) return;                     // already drawn locally
      if (b.op === "clear") return DriftCanvas.clear();
      if (b.op === "undo") return DriftCanvas.renderAll((b.strokes || []).map((s) => ({ ...s, points: unflat(s.points) })));
      DriftCanvas.applyBatch({ seq: b.seq, color: b.color, size: b.size, points: unflat(b.points) });
    });
  }));

  S.unsubs.push(onSnapshot(
    query(collection(db, "rooms", S.code, "rounds", id, "messages"), orderBy("createdAt")),
    (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== "added") return;
        const m = ch.doc.data();
        if (m.kind === "reaction") return DriftChat.addReaction(m.body, m.name);
        DriftChat.addMessage(m);
        if (m.kind === "guess" && m.playerId !== S.round?.drawerId) {
          S.lastGuess = m.body;
          maybeJudge(m);
        }
      });
    }
  ));
}

function enterRound(r) {
  const isDrawer = r.drawerId === S.me.id;
  DriftCanvas.clear();
  S.strokesBySeq.clear();
  S.seq = 0;
  DriftChat.clear();
  DriftChat.setEnabled(!isDrawer);
  DriftUI.showPhase("play");
  DriftUI.setRole(isDrawer);
  DriftUI.setPrompt(isDrawer ? r.prompt : null);
  DriftUI.setRoundInfo(r.roundNumber, S.totalRounds);
  DriftUI.setRoster(S.players, r.drawerId);
  DriftCanvas.setDrawable(isDrawer);
  DriftChat.addMessage({
    id: `sys-r${r.roundNumber}`, kind: "system",
    body: r.source === "seed"
      ? `round ${r.roundNumber} — ${r.drawerName} is drawing`
      : `round ${r.roundNumber} — ${r.drawerName} is drawing “${r.prompt}” (from the last guess)`,
  });
  startTimer(r);
  if (S.isHost) scheduleGem(r);
}

function startTimer(r) {
  clearInterval(S.timerHandle);
  const endMs = r.endsAt?.toMillis ? r.endsAt.toMillis() : nowMs() + ROUND_SECONDS * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((endMs - nowMs()) / 1000));
    DriftUI.setTimer(left, ROUND_SECONDS);
    if (left <= 0) {
      clearInterval(S.timerHandle);
      if (S.isHost && S.round?.status === "drawing") endRound(null, null);
    }
  };
  tick();
  S.timerHandle = setInterval(tick, 250);
}

// ---------------------------------------------------------------- drawing
function handleStrokeBatch(batch) {
  if (!S.round || S.round.drawerId !== S.me.id) return;
  if (!online) return;
  addDoc(collection(db, "rooms", S.code, "rounds", S.roundId, "strokes"), {
    seq: batch.seq, color: batch.color, size: batch.size,
    points: flat(batch.points), by: S.me.id, t: nowMs(),
  }).catch((e) => console.warn("stroke write failed", e));
}

function pushCanvasEvent(ev) {
  if (!online || !S.roundId || S.round?.drawerId !== S.me.id) return;
  const payload = { ...ev, by: S.me.id, t: nowMs() };
  if (ev.strokes) payload.strokes = ev.strokes.map((s) => ({ ...s, points: flat(s.points) }));
  addDoc(collection(db, "rooms", S.code, "rounds", S.roundId, "strokes"), payload).catch(() => {});
}

// ---------------------------------------------------------------- chat
function handleSend(text) {
  const body = (text || "").trim().slice(0, 80);
  if (!body) return;
  if (S.round?.drawerId === S.me.id) return;
  pushMessage({ kind: "guess", body });
}

function pushMessage({ kind, body, name, playerId }) {
  const m = {
    id: rid(), playerId: playerId || S.me.id, name: name || S.me.name,
    body, kind, createdAt: nowMs(),
  };
  if (!online || !S.roundId) {
    if (kind === "reaction") DriftChat.addReaction(body, m.name); else DriftChat.addMessage(m);
    if (kind === "guess") { S.lastGuess = body; maybeJudge(m); }
    return;
  }
  addDoc(collection(db, "rooms", S.code, "rounds", S.roundId, "messages"), m).catch(() => {});
}

// Only the drawer's client judges — one judge, no races, and it's the client
// that legitimately knows the answer.
async function maybeJudge(m) {
  if (!S.round || S.round.status !== "drawing") return;
  if (S.round.drawerId !== S.me.id) return;
  if (m.playerId === S.me.id || S.judging) return;
  S.judging = true;
  try {
    const v = await DriftGemini.judgeGuess(S.round.prompt, m.body);
    if (v.correct) await endRound(m.body, m);
    else if (v.close) pushMessage({ kind: "close", body: `${m.body} — so close!`, name: "SYSTEM", playerId: "sys" });
  } finally { S.judging = false; }
}

// ---------------------------------------------------------------- GEM
function scheduleGem(r) {
  clearTimeout(S.gemHandle);
  if (!DriftGemini.isEnabled()) return;
  const guesses = [];
  const startedAt = nowMs();
  const loop = async () => {
    if (!S.round || S.round.status !== "drawing" || S.round.id !== r.id) return;
    const g = await DriftGemini.aiGuess({
      prompt: r.prompt, strokeCount: DriftCanvas.getStrokes().length,
      elapsedMs: nowMs() - startedAt, previousGuesses: guesses,
    });
    if (g) {
      guesses.push(g);
      pushMessage({ kind: "ai", body: g, name: "GEM", playerId: GEM_ID });
      if (S.round.drawerId === S.me.id) maybeJudge({ id: rid(), playerId: GEM_ID, name: "GEM", body: g });
    }
    S.gemHandle = setTimeout(loop, 9000 + Math.random() * 7000);
  };
  S.gemHandle = setTimeout(loop, 12000);
}

// ---------------------------------------------------------------- round end
async function endRound(guess, msg) {
  if (!S.isHost && !(S.round?.drawerId === S.me.id)) return;
  clearTimeout(S.gemHandle);
  const patch = {
    status: "ended",
    winningGuess: guess || S.lastGuess || null,
    winnerId: msg?.playerId || null,
    winnerName: msg?.name || null,
    gotIt: !!guess,
    strokes: DriftCanvas.getStrokes().map((s) => ({ ...s, points: flat(s.points) })),
  };
  if (!online) { S.round = { ...S.round, ...patch }; return endRoundLocal(S.round); }
  await updateDoc(doc(db, "rooms", S.code, "rounds", S.roundId), patch).catch(() => {});
}

function endRoundLocal(r) {
  clearInterval(S.timerHandle);
  clearTimeout(S.gemHandle);
  DriftCanvas.setDrawable(false);
  DriftChat.setEnabled(false);

  S.chain.push({
    roundNumber: r.roundNumber, prompt: r.prompt, source: r.source,
    drawerName: r.drawerName, winningGuess: r.winningGuess, winnerName: r.winnerName,
    gotIt: !!r.gotIt,
    strokes: (r.strokes || []).map((s) => ({ ...s, points: unflat(s.points) })),
  });

  if (r.gotIt) DriftUI.flashCorrect(r.winnerName || "someone", r.prompt);
  else DriftUI.flashDrift(r.winningGuess || "…nothing");

  if (!S.isHost) return;
  setTimeout(() => {
    const next = r.winningGuess;
    if (r.roundNumber >= S.totalRounds || !next) return finishGame();
    startRound(r.roundNumber + 1, next, "guess");
  }, 2600);
}

async function finishGame() {
  const roast = await DriftGemini.writeRoast(S.chain);
  if (!online) return showReveal({ roast, chainJson: JSON.stringify(S.chain) });
  await updateDoc(doc(db, "rooms", S.code), {
    status: "reveal", roast,
    chainJson: JSON.stringify(S.chain.map((c) => ({ ...c, strokes: c.strokes.map((s) => ({ ...s, points: flat(s.points) })) }))),
  }).catch(() => {});
}

function showReveal(room) {
  clearInterval(S.timerHandle);
  clearTimeout(S.gemHandle);
  let chain = S.chain;
  try {
    if (room.chainJson) {
      chain = JSON.parse(room.chainJson).map((c) => ({
        ...c, strokes: (c.strokes || []).map((s) => ({ ...s, points: Array.isArray(s.points[0]) ? s.points : unflat(s.points) })),
      }));
    }
  } catch {}
  DriftUI.showPhase("reveal");
  DriftUI.renderReveal(chain, room.roast || "");
  // Replay each sketch onto its filmstrip canvas, staggered.
  requestAnimationFrame(() => {
    document.querySelectorAll(".reveal-canvas").forEach((cv, i) => {
      const link = chain[i];
      if (link) setTimeout(() => DriftCanvas.replay(cv, link.strokes, { duration: 1800 }), i * 450);
    });
  });
}

boot();
