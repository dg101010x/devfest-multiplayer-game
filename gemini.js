/* DRIFT — gemini.js
 * window.DriftGemini — AI helpers backed by the Gemini REST API, with
 * graceful local fallbacks for every single method. Classic script.
 */
(function () {
  'use strict';

  var MODEL = 'gemini-2.0-flash';
  var ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    MODEL +
    ':generateContent';
  var TIMEOUT_MS = 6000;

  /* ---------------------------------------------------------------- config */

  function getKey() {
    try {
      var cfg = window.DRIFT_CONFIG;
      var k = cfg && cfg.geminiKey;
      if (typeof k !== 'string') return null;
      k = k.trim();
      // The shipped template uses PASTE_ME placeholders. Treat those as absent,
      // otherwise every call fires a doomed request instead of using fallbacks.
      if (!k || /^paste_?me$/i.test(k) || k.indexOf('PASTE_ME') !== -1) return null;
      return k;
    } catch (e) {}
    return null;
  }

  function isEnabled() {
    return !!getKey();
  }

  /* ------------------------------------------------------------- transport */

  // Returns the model's text, or null on any failure. Never throws.
  function callGemini(text, genConfig) {
    var key = getKey();
    if (!key) return Promise.resolve(null);
    if (typeof fetch !== 'function') return Promise.resolve(null);

    var controller = null;
    var timer = null;
    try {
      if (typeof AbortController === 'function') controller = new AbortController();
    } catch (e) {
      controller = null;
    }

    var body = {
      contents: [{ parts: [{ text: String(text) }] }],
      generationConfig: Object.assign(
        {
          temperature: 0.9,
          maxOutputTokens: 512,
          topP: 0.95
        },
        genConfig || {}
      )
    };

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (controller) opts.signal = controller.signal;

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    try {
      if (controller) {
        timer = setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {}
        }, TIMEOUT_MS);
      }

      return fetch(ENDPOINT + '?key=' + encodeURIComponent(key), opts)
        .then(function (res) {
          if (!res || !res.ok) return null;
          return res.json();
        })
        .then(function (data) {
          cleanup();
          try {
            var out =
              data &&
              data.candidates &&
              data.candidates[0] &&
              data.candidates[0].content &&
              data.candidates[0].content.parts &&
              data.candidates[0].content.parts[0] &&
              data.candidates[0].content.parts[0].text;
            return typeof out === 'string' && out.length ? out : null;
          } catch (e) {
            return null;
          }
        })
        .catch(function () {
          cleanup();
          return null;
        });
    } catch (e) {
      cleanup();
      return Promise.resolve(null);
    }
  }

  /* ---------------------------------------------------------------- parsing */

  function stripFences(raw) {
    var s = String(raw == null ? '' : raw).trim();
    // ```json ... ```  /  ``` ... ```
    s = s.replace(/^\s*```[a-zA-Z0-9_-]*\s*/, '');
    s = s.replace(/\s*```\s*$/, '');
    return s.trim();
  }

  function parseJSONLoose(raw, wantArray) {
    var s = stripFences(raw);
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {}
    // Pull out the first balanced-ish JSON blob.
    var open = wantArray ? '[' : '{';
    var close = wantArray ? ']' : '}';
    var a = s.indexOf(open);
    var b = s.lastIndexOf(close);
    if (a !== -1 && b > a) {
      var slice = s.slice(a, b + 1);
      try {
        return JSON.parse(slice);
      } catch (e2) {}
      // Trailing-comma tolerance.
      try {
        return JSON.parse(slice.replace(/,\s*([\]}])/g, '$1'));
      } catch (e3) {}
    }
    // Last resort for arrays: line-ish list.
    if (wantArray) {
      var lines = s
        .split(/[\n,]+/)
        .map(function (l) {
          return l.replace(/^[\s\-*\d.)"'\[\]]+/, '').replace(/["'\[\]]+$/, '').trim();
        })
        .filter(function (l) {
          return l.length > 1 && l.length < 60;
        });
      if (lines.length) return lines;
    }
    return null;
  }

  /* ------------------------------------------------------- text normalizing */

  function normalize(s) {
    var t = String(s == null ? '' : s).toLowerCase().trim();
    // strip punctuation / symbols, keep letters digits spaces
    t = t.replace(/[‘’“”]/g, '');
    t = t.replace(/[^a-z0-9\s]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/^(?:a|an|the)\s+/, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function levenshtein(a, b) {
    a = String(a);
    b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (var k = 1; k <= b.length; k++) {
        var cost = ca === b.charCodeAt(k - 1) ? 0 : 1;
        var del = prev[k] + 1;
        var ins = cur[k - 1] + 1;
        var sub = prev[k - 1] + cost;
        cur[k] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
      }
      for (var m = 0; m <= b.length; m++) prev[m] = cur[m];
    }
    return prev[b.length];
  }

  // Pure-local verdict. Used as the fast path AND as the API fallback.
  function localVerdict(prompt, guess) {
    var p = normalize(prompt);
    var g = normalize(guess);
    if (!p || !g) return { correct: false, close: false, reason: 'empty' };
    if (p === g) return { correct: true, close: false, reason: 'exact' };
    if (g.length > 4 && p.length > 4 && levenshtein(p, g) <= 1) {
      return { correct: true, close: false, reason: 'exact' };
    }
    // Simple plural/suffix tolerance still counts as exact-ish.
    var depl = function (x) {
      return x.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '');
    };
    if (depl(p) === depl(g) && depl(p).length > 2) {
      return { correct: true, close: false, reason: 'exact' };
    }
    return { correct: false, close: false, reason: 'no match' };
  }

  /* ----------------------------------------------------------- word fallback */

  var FALLBACK_WORDS = [
    'astronaut cat', 'haunted toaster', 'pizza delivery dragon', 'stage fright',
    'robot barber', 'vampire dentist', 'melting snowman', 'disco shark',
    'broken umbrella', 'grandma on a skateboard', 'sleepy volcano', 'spaghetti tornado',
    'lonely lighthouse', 'detective pigeon', 'yoga bear', 'cursed vending machine',
    'traffic jam', 'escalator', 'mustache comb', 'alien picnic',
    'bubble bath', 'karate grandpa', 'squirrel heist', 'invisible dog',
    'cowboy penguin', 'laundry day', 'jellyfish wedding', 'tax audit',
    'rubber duck army', 'thunderstorm', 'ice cream avalanche', 'ghost librarian',
    'treadmill', 'opera singer', 'camping disaster', 'sock puppet mayor',
    'banana phone', 'wizard on a bicycle', 'overcaffeinated barista', 'midnight snack',
    'parking ticket', 'mermaid at a gym', 'sentient mop', 'birthday candle',
    'hamster wheel', 'bungee jumping sloth', 'burnt toast', 'first date',
    'knight in a dishwasher', 'pirate accountant', 'dandelion', 'runaway shopping cart',
    'lawn flamingo', 'raccoon chef', 'hot air balloon', 'dentist chair',
    'whale in a bathtub', 'sunburn', 'tiny hat', 'confused octopus',
    'space laundromat', 'unicycle', 'chainsaw juggler', 'quicksand',
    'bees in a minivan', 'frozen pizza', 'mailbox', 'goose with a knife',
    'telescope', 'bedtime story', 'nervous sandwich', 'cactus hug',
    'escaped balloon', 'skateboarding nun', 'microwave fire', 'tangled headphones',
    'camel in a sweater', 'piano falling', 'awkward silence', 'lost sock',
    'crab rave', 'power outage', 'shopping mall santa', 'drone delivery',
    'moose in a canoe', 'wet paint', 'bad haircut', 'guitar solo',
    'turtle racing', 'sunglasses at night', 'dinosaur birthday', 'spilled coffee',
    'elevator music', 'submarine kitchen', 'ninja gardener', 'rollercoaster',
    'pancake stack', 'hiccups', 'library whisper', 'rocket powered chair',
    'swamp monster prom', 'parachute', 'overpacked suitcase', 'snail mail',
    'flamethrower chef', 'hedgehog in traffic', 'windmill', 'bowling strike',
    'last slice of pizza', 'security camera', 'donut hole', 'fortune teller',
    'sheep shearing', 'fire hydrant', 'lemonade stand', 'yeti on vacation',
    'bagpipes', 'fishing trip', 'tiny violin', 'sandcastle collapse',
    'runaway train', 'nose whistle', 'cat loaf', 'alarm clock rage'
  ];

  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function fallbackPrompts(count) {
    var n = Math.max(1, count | 0 || 1);
    var pool = shuffled(FALLBACK_WORDS);
    var out = [];
    while (out.length < n) {
      out = out.concat(pool.slice(0, Math.min(n - out.length, pool.length)));
      if (out.length < n) pool = shuffled(FALLBACK_WORDS);
    }
    return out.slice(0, n);
  }

  var FALLBACK_AI_GUESSES = [
    'a very sad hotdog', 'my uncle', 'wifi router', 'a haunted spoon',
    'two raccoons in a trenchcoat', 'the concept of monday', 'a damp pigeon',
    'my landlord', 'an aggressive lamp', 'unpaid parking ticket',
    'a potato with ambitions', 'emotional support brick', 'a confused goose',
    'leftover soup', 'a bus that gave up', 'the vibe of a dentist office',
    'a sock with opinions', 'microwave burrito', 'a tiny angry horse',
    'a shopping cart in a river', 'grandma wifi password', 'a cursed stapler'
  ];

  /* ------------------------------------------------------- generatePrompts() */

  function generatePrompts(count) {
    var n = Math.max(1, Math.min(200, count | 0 || 10));
    if (!isEnabled()) return Promise.resolve(fallbackPrompts(n));

    var ask =
      'Generate exactly ' + n + ' prompts for a Pictionary-style drawing game.\n' +
      'Rules:\n' +
      '- Each must be concrete and visually drawable (nouns or short noun phrases).\n' +
      '- Mix easy everyday things with absurd, funny combinations.\n' +
      '- Mix single words and 2-4 word comedic compounds.\n' +
      '- Lowercase, no punctuation, no numbering, no explanations.\n' +
      '- Examples of the vibe: "astronaut cat", "haunted toaster", "pizza delivery dragon", "stage fright".\n' +
      'Respond with ONLY a JSON array of ' + n + ' strings. No markdown, no prose.';

    return callGemini(ask, { temperature: 1.0, maxOutputTokens: 2048 })
      .then(function (text) {
        if (!text) return fallbackPrompts(n);
        var parsed = parseJSONLoose(text, true);
        if (!parsed || !Array.isArray(parsed)) return fallbackPrompts(n);
        var seen = Object.create(null);
        var words = [];
        for (var i = 0; i < parsed.length; i++) {
          var w = parsed[i];
          if (typeof w !== 'string') continue;
          w = w.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
          w = w.replace(/[.,;:!?]+$/, '').trim();
          if (w.length < 2 || w.length > 48) continue;
          if (seen[w]) continue;
          seen[w] = 1;
          words.push(w);
        }
        if (words.length < Math.min(3, n)) return fallbackPrompts(n);
        if (words.length < n) {
          var fill = fallbackPrompts(n * 2);
          for (var j = 0; j < fill.length && words.length < n; j++) {
            if (!seen[fill[j]]) {
              seen[fill[j]] = 1;
              words.push(fill[j]);
            }
          }
        }
        return words.slice(0, n);
      })
      .catch(function () {
        return fallbackPrompts(n);
      });
  }

  /* ------------------------------------------------------------ judgeGuess() */

  function judgeGuess(prompt, guess) {
    var local;
    try {
      local = localVerdict(prompt, guess);
    } catch (e) {
      local = { correct: false, close: false, reason: 'no match' };
    }

    // FAST PATH — zero network.
    if (local.correct) return Promise.resolve(local);

    var p = normalize(prompt);
    var g = normalize(guess);
    if (!p || !g) return Promise.resolve({ correct: false, close: false, reason: 'empty' });
    if (!isEnabled()) return Promise.resolve(local);

    var ask =
      'You are the judge in a Pictionary game. The secret answer and a player guess are given.\n' +
      'Decide semantic equivalence generously: synonyms, baby-animal names, plurals, ' +
      'everyday paraphrases and obvious equivalents all count as CORRECT ' +
      '(e.g. answer "dog" guess "puppy" => correct; answer "astronaut" guess "space man" => correct).\n' +
      '"close" means the guess is in the same ballpark / right category but not the thing itself.\n' +
      'Answer with ONLY this JSON, nothing else:\n' +
      '{"correct":true|false,"close":true|false,"reason":"<=6 words"}\n\n' +
      'ANSWER: ' + String(prompt) + '\nGUESS: ' + String(guess);

    return callGemini(ask, { temperature: 0.1, maxOutputTokens: 120 })
      .then(function (text) {
        if (!text) return local;
        var parsed = parseJSONLoose(text, false);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return local;
        var correct = parsed.correct === true || parsed.correct === 'true';
        var close = parsed.close === true || parsed.close === 'true';
        var reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
        if (reason.length > 60) reason = reason.slice(0, 60);
        if (!reason) reason = correct ? 'same meaning' : close ? 'same ballpark' : 'no match';
        return {
          correct: correct,
          close: correct ? false : close,
          reason: reason
        };
      })
      .catch(function () {
        return local;
      });
  }

  /* --------------------------------------------------------------- aiGuess() */

  function aiGuess(ctx) {
    ctx = ctx || {};
    var prompt = String(ctx.prompt == null ? '' : ctx.prompt);
    var elapsed = Number(ctx.elapsedMs) || 0;
    var strokes = Number(ctx.strokeCount) || 0;
    var hint = ctx.roundHint ? String(ctx.roundHint) : '';
    var prev = Array.isArray(ctx.previousGuesses) ? ctx.previousGuesses : [];

    var taken = Object.create(null);
    for (var i = 0; i < prev.length; i++) {
      var pv = normalize(prev[i]);
      if (pv) taken[pv] = 1;
    }

    function fresh(candidate) {
      if (typeof candidate !== 'string') return null;
      var c = candidate
        .toLowerCase()
        .replace(/["'`*]/g, '')
        .replace(/[.!?]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (c.length < 2 || c.length > 48) return null;
      if (taken[normalize(c)]) return null;
      return c;
    }

    function fallbackWrong() {
      var pool = shuffled(FALLBACK_AI_GUESSES);
      for (var k = 0; k < pool.length; k++) {
        var f = fresh(pool[k]);
        if (f) return f;
      }
      return null;
    }

    // Decide locally whether GEM actually knows the answer this time.
    var goesReal = elapsed > 25000 && Math.random() < 0.2;
    if (goesReal) {
      var real = fresh(prompt);
      if (real) return Promise.resolve(real);
      // already guessed it — stay quiet rather than repeat
      return Promise.resolve(null);
    }

    // Too early / too little on canvas: sometimes GEM just says nothing.
    if (strokes < 2 && elapsed < 6000 && Math.random() < 0.5) {
      return Promise.resolve(null);
    }

    if (!isEnabled()) return Promise.resolve(fallbackWrong());

    var ask =
      'You are GEM, a goofy AI player in a Pictionary game. You must shout out ONE wrong guess.\n' +
      'The real answer is "' + prompt + '" — you must NOT guess it or any synonym of it.\n' +
      'Instead give something thematically adjacent but clearly different and funny ' +
      '(same vibe, wrong thing). 1-4 words, lowercase, no punctuation, no quotes, no explanation.\n' +
      (hint ? 'Round hint: ' + hint + '\n' : '') +
      'Drawing progress: ' + strokes + ' strokes, ' + Math.round(elapsed / 1000) + 's elapsed.\n' +
      (prev.length
        ? 'Already guessed (do not repeat): ' + prev.slice(-12).join(', ') + '\n'
        : '') +
      'Respond with only the guess.';

    return callGemini(ask, { temperature: 1.1, maxOutputTokens: 40 })
      .then(function (text) {
        if (!text) return fallbackWrong();
        var line = String(text).split('\n')[0];
        var cand = fresh(line);
        if (!cand) return fallbackWrong();
        // Safety: never accidentally reveal the answer on a "wrong" turn.
        if (normalize(cand) === normalize(prompt)) return fallbackWrong();
        return cand;
      })
      .catch(function () {
        return fallbackWrong();
      });
  }

  /* ------------------------------------------------------------ writeRoast() */

  function chainEnds(chain) {
    var list = Array.isArray(chain) ? chain : [];
    var first = '';
    var last = '';
    for (var i = 0; i < list.length; i++) {
      var link = list[i] || {};
      if (!first && link.prompt) first = String(link.prompt);
      var w = link.winningGuess || link.prompt;
      if (w) last = String(w);
    }
    return { first: first || 'something', last: last || 'something else' };
  }

  function fallbackRoast(chain) {
    var e = chainEnds(chain);
    var variants = [
      'You started at "' + e.first + '" and ended at "' + e.last +
        '". Genuinely impressive how fast that fell apart.',
      'From "' + e.first + '" to "' + e.last +
        '" in a handful of rounds. The chain did not break, it evaporated.',
      '"' + e.first + '" walked in and "' + e.last +
        '" walked out. Nobody lied, and yet somehow everybody did.'
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  function writeRoast(chain) {
    var list = Array.isArray(chain) ? chain : [];
    if (!isEnabled() || !list.length) return Promise.resolve(fallbackRoast(list));

    var lines = [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i] || {};
      lines.push(
        (i + 1) +
          '. prompt "' + String(l.prompt == null ? '?' : l.prompt) + '" -> ' +
          (l.gotIt
            ? 'guessed "' + String(l.winningGuess == null ? '?' : l.winningGuess) + '"'
            : 'nobody got it, carried "' +
              String(l.winningGuess == null ? '?' : l.winningGuess) + '"') +
          ' (drawer: ' + String(l.drawerName || 'someone') + ')'
      );
    }
    var e = chainEnds(list);

    var ask =
      'This is the drift chain from a game of telephone-Pictionary:\n' +
      lines.join('\n') + '\n\n' +
      'Write a short, punchy, affectionate roast about how far the idea drifted from "' +
      e.first + '" to "' + e.last + '".\n' +
      'Rules: 2-3 sentences, max 45 words. Playful and warm, like a friend. ' +
      'Roast the DRIFT itself, never anyone\'s drawing ability or intelligence. ' +
      'No hashtags, no emoji spam, no preamble. Output only the roast text.';

    return callGemini(ask, { temperature: 1.0, maxOutputTokens: 200 })
      .then(function (text) {
        if (!text) return fallbackRoast(list);
        var out = stripFences(text).replace(/\s+/g, ' ').trim();
        out = out.replace(/^["']|["']$/g, '').trim();
        if (out.length < 10) return fallbackRoast(list);
        if (out.length > 400) out = out.slice(0, 400).trim() + '…';
        return out;
      })
      .catch(function () {
        return fallbackRoast(list);
      });
  }

  /* ----------------------------------------------------------------- export */

  window.DriftGemini = {
    isEnabled: isEnabled,
    generatePrompts: generatePrompts,
    judgeGuess: judgeGuess,
    aiGuess: aiGuess,
    writeRoast: writeRoast,
    // exposed for tests / reuse by the game
    _normalize: normalize,
    _levenshtein: levenshtein,
    _localVerdict: localVerdict,
    FALLBACK_WORDS: FALLBACK_WORDS
  };
})();
