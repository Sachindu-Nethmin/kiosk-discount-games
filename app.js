/* Kiosk Discount Games — standalone vanilla implementation of the Claude Design canvas. */

(function () {
  "use strict";

  var PASTELS = ["#FFE0EC", "#DDEEFF", "#E6E0FF", "#FFF1D0", "#DCF7E6", "#F2ECF9"];
  var BOX_COLORS = ["#FFE0EC", "#DDEEFF", "#DCF7E6"];
  var SWATCHES = ["#7A3FF2", "#E8452C", "#1F6FEB", "#12A15C", "#F0B429"];
  var STORE_KEY = "kiosk-discount-games.cfg.v1";

  var defaultCfg = {
    brandName: "Bloom & Bean",
    accent: "#7A3FF2",
    playsPerUser: 3,
    expiryDays: 14,
    winRate: 3,
    headline: "Play once, win a discount",
    subhead: "Pick a game below. Every customer gets a try.",
    winMessage: "Show this code at the counter to redeem.",
    loseMessage: "No prize this time — come back tomorrow for another go.",
    prizes: [
      { label: "10% off", symbol: "10%", odds: 30, color: PASTELS[0] },
      { label: "20% off", symbol: "20%", odds: 18, color: PASTELS[1] },
      { label: "Free coffee", symbol: "FREE", odds: 12, color: PASTELS[2] },
      { label: "5% off", symbol: "5%", odds: 25, color: PASTELS[3] },
      { label: "50% off", symbol: "50%", odds: 3, color: PASTELS[4] }
    ],
    reels: [
      { label: "10% off", symbol: "10%", odds: 40, color: PASTELS[0] },
      { label: "20% off", symbol: "20%", odds: 40, color: PASTELS[1] },
      { label: "Free coffee", symbol: "FREE", odds: 20, color: PASTELS[2] }
    ],
    boxes: [
      { label: "5% off", symbol: "5%", odds: 45, color: PASTELS[3] },
      { label: "Free coffee", symbol: "FREE", odds: 25, color: PASTELS[2] },
      { label: "50% off", symbol: "50%", odds: 30, color: PASTELS[4] }
    ]
  };

  function loadCfg() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return clone(defaultCfg);
      var saved = JSON.parse(raw);
      var cfg = clone(defaultCfg);
      Object.keys(cfg).forEach(function (k) {
        if (saved[k] !== undefined && saved[k] !== null) cfg[k] = saved[k];
      });
      if (!Array.isArray(cfg.prizes) || !cfg.prizes.length) cfg.prizes = clone(defaultCfg.prizes);
      if (!Array.isArray(cfg.reels) || !cfg.reels.length) cfg.reels = clone(defaultCfg.reels);
      if (!Array.isArray(cfg.boxes) || !cfg.boxes.length) cfg.boxes = clone(defaultCfg.boxes);
      return cfg;
    } catch (e) {
      return clone(defaultCfg);
    }
  }

  function saveCfg(cfg) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Darken a hex colour by `amount` (0..1) — used for the accent's pressed/deep tone. */
  function shade(hex, amount) {
    var m = /^#?([a-f\d]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
      return Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
    });
    return "#" + parts.map(function (c) { return ("0" + c.toString(16)).slice(-2); }).join("");
  }

  function tint(hex, amount) {
    var m = /^#?([a-f\d]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
      return Math.max(0, Math.min(255, Math.round(c + (255 - c) * amount)));
    });
    return "#" + parts.map(function (c) { return ("0" + c.toString(16)).slice(-2); }).join("");
  }

  var cfg = loadCfg();

  var state = {
    screen: "home",
    busy: false,
    rotation: 0,
    reels: (cfg.reels || []).slice(0, 3).map(function (p) { return p.symbol; }),
    picked: null,
    revealed: false,
    pickedPrize: "",
    result: null,
    coupon: "",
    playsLeft: Number(cfg.playsPerUser) || 0
  };

  var timers = [];
  var reelInt = null;
  var locked = 0;
  var paintedRotation = 0;
  var root = document.getElementById("app");

  /* --- drag-to-spin state --- */
  var drag = { active: false, startAngle: 0, baseRotation: 0, lastAngle: 0, lastTime: 0, velocity: 0 };
  var momentumRaf = null;
  var wheelCenterX = 0;
  var wheelCenterY = 0;

  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (reelInt) { clearInterval(reelInt); reelInt = null; }
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    render();
  }

  function setCfg(patch) {
    Object.keys(patch).forEach(function (k) { cfg[k] = patch[k]; });
    saveCfg(cfg);
    render();
  }

  /* ---------- game logic ---------- */

  var LOSE_PRIZE = { label: "Try again", symbol: "—", color: PASTELS[5], won: false };

  /* Classic slot-machine fruit/casino symbols (CC0/public-domain assets in /images).
     Map a configured prize `symbol` to a matching reel image, falling back to text. */
  var SLOT_SYMBOLS = [
    { match: /bar/i, img: "bar.jpg" },
    { match: /7|seven|777/i, img: "seven.jpg" },
    { match: /50|gold|top/i, img: "seven.jpg" },
    { match: /free|coffee|bell/i, img: "bell.jpg" },
    { match: /20|plum/i, img: "lemon.jpg" },
    { match: /cherry|10|10%/i, img: "cherry.jpg" },
    { match: /5|grape|orange/i, img: "bar.jpg" }
  ];

  function slotImage(symbol) {
    var s = String(symbol == null ? "" : symbol);
    for (var i = 0; i < SLOT_SYMBOLS.length; i++) {
      if (SLOT_SYMBOLS[i].match.test(s)) return SLOT_SYMBOLS[i].img;
    }
    return null;
  }

  /* Roll towards a simple win rate: cfg.winRate is "1 in N" customers win. */
  function roll() {
    var rate = Math.max(1, Number(cfg.winRate) || 1);
    return Math.random() < 1 / rate;
  }

  function draw(list) {
    var prizes = list || cfg.prizes;
    var total = prizes.reduce(function (a, p) { return a + (Number(p.odds) || 0); }, 0) || 1;
    var r = Math.random() * total;
    for (var i = 0; i < prizes.length; i++) {
      r -= Number(prizes[i].odds) || 0;
      if (r <= 0) return i;
    }
    return prizes.length - 1;
  }

  function makeCode() {
    var cs = "ACDEFHJKLMNPRTUVWXY3479";
    var out = "";
    for (var i = 0; i < 6; i++) out += cs[Math.floor(Math.random() * cs.length)];
    return out;
  }

  function land(prize) {
    var won = !!(prize && prize.won);
    var p = won
      ? prize
      : clone(LOSE_PRIZE);
    setState({
      result: p,
      coupon: won ? makeCode() : "",
      busy: false,
      playsLeft: Math.max(0, state.playsLeft - 1)
    });
  }

  function spin(optionalVelocity) {
    if (state.busy || state.playsLeft <= 0) return;
    var i = draw();
    var n = cfg.prizes.length;
    var seg = 360 / n;
    var center = i * seg + seg / 2;
    var base = state.rotation - (state.rotation % 360);
    var extraTurns, duration;
    if (typeof optionalVelocity === "number" && Math.abs(optionalVelocity) > 2) {
      var absVel = Math.abs(optionalVelocity);
      extraTurns = Math.max(3, Math.min(12, absVel * 0.6));
      duration = Math.max(2, Math.min(6, extraTurns / absVel * 2));
    } else {
      extraTurns = 5;
      duration = 4.2;
    }
    var won = roll();
    var landed = won ? (function (q) { var c = clone(cfg.prizes[q]); c.won = true; return c; })(i) : LOSE_PRIZE;
    var parts = root.querySelectorAll(".wheel-disc, .wheel-labels");
    if (parts.length) {
      for (var j = 0; j < parts.length; j++) {
        parts[j].style.transition = "transform " + duration + "s cubic-bezier(.13, .72, .16, 1)";
      }
    }
    setState({ busy: true, rotation: base + 360 * extraTurns + (360 - center) });
    after(Math.round(duration * 1000) + 200, function () { land(landed); });
  }

  function pull() {
    if (state.busy || state.playsLeft <= 0) return;
    var prizes = cfg.reels.length ? cfg.reels : cfg.prizes;
    var won = roll();
    var finals;
    var outcome;
    if (won) {
      var wi = draw(prizes);
      var wsym = prizes[wi].symbol;
      finals = [wsym, wsym, wsym];
      outcome = clone(prizes[wi]);
      outcome.won = true;
    } else {
      var s0 = draw(prizes);
      var s1 = draw(prizes);
      var s2 = draw(prizes);
      var symbols = [prizes[s0].symbol, prizes[s1].symbol, prizes[s2].symbol];
      finals = (symbols[0] === symbols[1] && symbols[1] === symbols[2])
        ? [symbols[0], prizes[(s0 + 1) % prizes.length].symbol, symbols[2]]
        : symbols;
      outcome = LOSE_PRIZE;
    }

    setState({ busy: true });
    locked = 0;
    reelInt = setInterval(function () {
      setState({
        reels: state.reels.map(function (v, k) {
          return locked > k ? v : prizes[Math.floor(Math.random() * prizes.length)].symbol;
        })
      });
    }, 70);

    [900, 1500, 2100].forEach(function (t, k) {
      after(t, function () {
        locked = k + 1;
        setState({
          reels: state.reels.map(function (v, j) { return j === k ? finals[k] : v; })
        });
        if (k === 2) {
          clearInterval(reelInt); reelInt = null;
          after(500, function () { land(outcome); });
        }
      });
    });
  }

  function pick(k) {
    if (state.busy || state.picked !== null || state.playsLeft <= 0) return;
    var won = roll();
    var chosen = won
      ? (function (q) { var c = clone(cfg.boxes[q]); c.won = true; return c; })(draw(cfg.boxes))
      : LOSE_PRIZE;
    setState({ busy: true, picked: k });
    after(450, function () { setState({ revealed: true, pickedPrize: chosen.label }); });
    after(1200, function () { land(chosen); });
  }

  function go(screen) {
    clearTimers();
    locked = 0;
    drag.active = false;
    if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = null; }
    setState({ screen: screen, result: null, picked: null, revealed: false, pickedPrize: "", busy: false });
  }

  /* ---------- rendering ---------- */

  function applyAccent() {
    var s = document.documentElement.style;
    s.setProperty("--accent", cfg.accent);
    s.setProperty("--accent-dark", shade(cfg.accent, 0.24));
    s.setProperty("--accent-soft", tint(cfg.accent, 0.9));
    s.setProperty("--accent-line", tint(cfg.accent, 0.82));
  }

  function derived() {
    var prizes = cfg.prizes;
    var n = prizes.length || 1;
    var seg = 360 / n;
    var total = prizes.reduce(function (a, p) { return a + (Number(p.odds) || 0); }, 0);
    var gradient = "conic-gradient(" + prizes.map(function (p, i) {
      return p.color + " " + (i * seg) + "deg " + ((i + 1) * seg) + "deg";
    }).join(", ") + ")";
    var expiry = new Date(Date.now() + (Number(cfg.expiryDays) || 0) * 864e5);
    return {
      seg: seg,
      total: total,
      gradient: gradient,
      won: !!(state.result && state.result.won),
      expiryLine: "Valid until " + expiry.toLocaleDateString(undefined, {
        day: "numeric", month: "long", year: "numeric"
      })
    };
  }

  function topbarHtml() {
    var initial = (cfg.brandName || "S").trim().charAt(0).toUpperCase() || "S";
    var playsLabel = state.playsLeft > 0
      ? state.playsLeft + " play" + (state.playsLeft === 1 ? "" : "s") + " left"
      : "No plays left";
    return '' +
      '<div class="topbar">' +
        '<div class="brand">' +
          '<div class="brand-mark">' + esc(initial) + '</div>' +
          '<div class="brand-name">' + esc(cfg.brandName) + '</div>' +
        '</div>' +
        '<div class="topbar-right">' +
          '<div class="plays-pill">' + esc(playsLabel) + '</div>' +
          '<button class="icon-btn" data-action="open-admin" aria-label="Game settings" title="Game settings">⚙</button>' +
        '</div>' +
      '</div>';
  }

  function homeHtml() {
    return '' +
      '<div class="screen">' +
        '<div class="hero">' +
          '<h1>' + esc(cfg.headline) + '</h1>' +
          '<p>' + esc(cfg.subhead) + '</p>' +
        '</div>' +
        '<div class="game-grid">' +
          '<button class="game-card game-card--wheel" data-action="play" data-game="wheel">' +
            '<div class="art-wheel"></div>' +
            '<div class="card-text">' +
              '<h2>Spin the wheel</h2>' +
              '<div class="card-sub">One spin, one prize.</div>' +
            '</div>' +
            '<div class="card-cta">Play</div>' +
          '</button>' +
          '<button class="game-card game-card--slots" data-action="play" data-game="slots">' +
            '<div class="art-slots"><span></span><span></span><span></span></div>' +
            '<div class="card-text">' +
              '<h2>Slot machine</h2>' +
              '<div class="card-sub">Match three, take the deal.</div>' +
            '</div>' +
            '<div class="card-cta">Play</div>' +
          '</button>' +
          '<button class="game-card game-card--boxes" data-action="play" data-game="boxes">' +
            '<div class="art-boxes"><span></span><span class="tall"></span><span></span></div>' +
            '<div class="card-text">' +
              '<h2>Mystery boxes</h2>' +
              '<div class="card-sub">Pick one of three.</div>' +
            '</div>' +
            '<div class="card-cta">Play</div>' +
          '</button>' +
        '</div>' +
      '</div>';
  }

  function wheelHtml(d) {
    var labels = cfg.prizes.map(function (p, i) {
      var t = "rotate(" + (i * d.seg + d.seg / 2) + "deg) translateY(-172px)";
      return '<div class="wheel-label" style="transform: ' + t + ';">' + esc(p.label) + '</div>';
    }).join("");
    var rot = "rotate(" + paintedRotation + "deg)";
    var disabled = state.busy || state.playsLeft <= 0;
    return '' +
      '<div class="screen screen--game">' +
        '<button class="back-btn" data-action="home">← Back</button>' +
        '<h1 class="game-title">Spin the wheel</h1>' +
        '<div class="wheel-stage">' +
          '<div class="wheel-pointer"></div>' +
          '<div class="wheel-disc" style="background: ' + d.gradient + '; transform: ' + rot + ';"></div>' +
          '<div class="wheel-labels" style="transform: ' + rot + ';">' + labels + '</div>' +
          '<div class="wheel-hub">WIN</div>' +
        '</div>' +
        '<button class="big-btn" data-action="spin"' + (disabled ? " disabled" : "") + '>' +
          (state.busy ? "Spinning…" : "SPIN") +
        '</button>' +
      '</div>';
  }

  function slotsHtml() {
    var reels = state.reels.map(function (symbol) {
      var img = slotImage(symbol);
      var face = img
        ? '<img class="reel-symbol" src="images/' + img + '" alt="' + esc(symbol) + '" />'
        : esc(symbol);
      return '<div class="reel"><div class="reel-window">' + face + '</div><div class="reel-label">' + esc(symbol) + '</div></div>';
    }).join("");
    var disabled = state.busy || state.playsLeft <= 0;
    return '' +
      '<div class="screen screen--game" style="gap: 34px;">' +
        '<button class="back-btn" data-action="home">← Back</button>' +
        '<h1 class="game-title">Slot machine</h1>' +
        '<div class="slot-machine">' +
          '<div class="slot-screen">' +
            '<div class="payline"></div>' +
            '<div class="slot-reels">' + reels + '</div>' +
          '</div>' +
          '<div class="slot-top">' + esc(cfg.brandName) + '</div>' +
          '<button class="slot-lever big-btn" data-action="pull"' + (disabled ? " disabled" : "") + '>' +
            '<span class="lever-knob"></span>' +
            (state.busy ? "Rolling…" : "PULL") +
          '</button>' +
        '</div>' +
      '</div>';
  }

  function boxesHtml() {
    var boxes = cfg.boxes.map(function (_, k) {
      var isPicked = state.picked === k;
      var bg = isPicked && state.revealed ? "#FFF" : BOX_COLORS[k % BOX_COLORS.length];
      var border = isPicked ? cfg.accent : "transparent";
      var transform = isPicked
        ? (state.revealed ? "scale(1.06)" : "scale(.94)")
        : (state.picked === null ? "scale(1)" : "scale(.92)");
      var face = isPicked && state.revealed ? (state.pickedPrize || "") : String(k + 1);
      return '<button class="mystery-box" data-action="pick" data-index="' + k + '" ' +
        'style="background: ' + bg + '; border-color: ' + border + '; transform: ' + transform + ';">' +
        esc(face) + '</button>';
    }).join("");
    return '' +
      '<div class="screen screen--game" style="gap: 38px;">' +
        '<button class="back-btn" data-action="home">← Back</button>' +
        '<div class="box-head">' +
          '<h1 class="game-title">Mystery boxes</h1>' +
          '<div class="game-sub">Tap a box to open it.</div>' +
        '</div>' +
        '<div class="box-row">' + boxes + '</div>' +
      '</div>';
  }

  function resultHtml(d) {
    if (!state.result) return "";
    var couponBlock = d.won
      ? '<div class="coupon-wrap">' +
          '<div class="coupon">' + esc(state.coupon) + '</div>' +
          '<div class="coupon-expiry">' + esc(d.expiryLine) + '</div>' +
        '</div>'
      : "";
    var noPlays = state.playsLeft <= 0;
    return '' +
      '<div class="overlay" role="dialog" aria-modal="true">' +
        '<div class="result-card">' +
          '<div class="result-kicker">' + (d.won ? "You won" : "So close") + '</div>' +
          '<div class="result-prize">' + esc(state.result.label) + '</div>' +
          '<div class="result-msg">' + esc(d.won ? cfg.winMessage : cfg.loseMessage) + '</div>' +
          couponBlock +
          '<div class="result-actions">' +
            '<button class="btn-primary" data-action="play-again"' + (noPlays ? " disabled" : "") + '>' +
              (noPlays ? "No plays left" : "Play again") +
            '</button>' +
            '<button class="btn-soft" data-action="finish">Done</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function adminHtml(d) {
    var swatches = SWATCHES.map(function (color) {
      var ring = cfg.accent === color ? "#2A2140" : "#fff";
      return '<button class="swatch" data-action="swatch" data-color="' + color + '" ' +
        'style="background: ' + color + '; border: 3px solid ' + ring + ';" ' +
        'aria-label="Accent ' + color + '"></button>';
    }).join("");

    function outcomeRows(key) {
      var list = cfg[key];
      return list.map(function (p, i) {
        return '' +
          '<div class="prize-grid prize-row" style="background: ' + p.color + ';">' +
            '<input class="field" value="' + esc(p.label) + '" data-field="' + key + '-label" data-index="' + i + '" ' +
              'data-fkey="' + key + '-label-' + i + '" aria-label="Prize name" />' +
            '<input class="field" value="' + esc(p.symbol) + '" data-field="' + key + '-symbol" data-index="' + i + '" ' +
              'data-fkey="' + key + '-symbol-' + i + '" aria-label="Reel symbol" />' +
            '<div class="range-cell">' +
              '<input type="range" min="0" max="100" step="1" value="' + esc(p.odds) + '" ' +
                'data-field="' + key + '-odds" data-index="' + i + '" data-fkey="' + key + '-range-' + i + '" aria-label="Odds" />' +
            '</div>' +
            '<input class="field field--center" value="' + esc(p.odds) + '" data-field="' + key + '-odds" ' +
              'data-index="' + i + '" data-fkey="' + key + '-odds-' + i + '" inputmode="numeric" aria-label="Chance" />' +
            '<button class="row-remove" data-action="remove-prize" data-set="' + key + '" data-index="' + i + '" aria-label="Remove prize">×</button>' +
          '</div>';
      }).join("");
    }

    function outcomePanel(title, key) {
      var list = cfg[key];
      var total = list.reduce(function (a, p) { return a + (Number(p.odds) || 0); }, 0);
      var note = total === 100
        ? "Odds total 100% ✓"
        : "Odds total " + total + "% — normalised automatically";
      var color = total === 100 ? "#2E9E63" : "#C2803A";
      return '' +
        '<div class="panel">' +
          '<div class="panel-head">' +
            '<div class="panel-title">' + esc(title) + '</div>' +
            '<div class="odds-note" style="color: ' + color + ';">' + esc(note) + '</div>' +
          '</div>' +
          '<div class="prize-grid prize-headings">' +
            '<div>Prize name</div><div>Reel symbol</div><div>Odds</div><div>Chance</div><div></div>' +
          '</div>' +
          '<div class="prize-rows">' + outcomeRows(key) + '</div>' +
          '<button class="btn-pill-soft" data-action="add-prize" data-set="' + key + '">+ Add prize</button>' +
        '</div>';
    }

    return '' +
      '<div class="admin">' +
        '<div class="admin-inner">' +
          '<div class="admin-head">' +
            '<div class="admin-title">Game settings</div>' +
            '<button class="btn-dark" data-action="close-admin">Done</button>' +
          '</div>' +

          outcomePanel("Spin the wheel prizes", "prizes") +
          outcomePanel("Slot machine rewards", "reels") +
          outcomePanel("Mystery box contents", "boxes") +

          '<div class="two-col">' +
            '<div class="panel panel-stack">' +
              '<div class="panel-title">Play limits</div>' +
              '<label class="label" for="f-plays">Plays per customer</label>' +
              '<input id="f-plays" class="field-lg" value="' + esc(cfg.playsPerUser) + '" ' +
                'data-field="playsPerUser" data-fkey="playsPerUser" inputmode="numeric" />' +
              '<label class="label" for="f-winrate">Win chance (1 in N customers)<br><span style="color:var(--faint);font-size:13px;">Lower N = more wins. 3 means ~1 in 3 win.</span></label>' +
              '<input id="f-winrate" class="field-lg" value="' + esc(cfg.winRate) + '" ' +
                'data-field="winRate" data-fkey="winRate" inputmode="numeric" />' +
              '<label class="label" for="f-expiry">Coupon valid for (days)</label>' +
              '<input id="f-expiry" class="field-lg" value="' + esc(cfg.expiryDays) + '" ' +
                'data-field="expiryDays" data-fkey="expiryDays" inputmode="numeric" />' +
            '</div>' +
            '<div class="panel panel-stack">' +
              '<div class="panel-title">Brand</div>' +
              '<label class="label" for="f-brand">Store name</label>' +
              '<input id="f-brand" class="field-lg" value="' + esc(cfg.brandName) + '" ' +
                'data-field="brandName" data-fkey="brandName" />' +
              '<label class="label">Accent colour</label>' +
              '<div class="swatches">' + swatches + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="panel panel-stack">' +
            '<div class="panel-title">Copy</div>' +
            '<div class="copy-grid">' +
              copyField("Headline", "headline", cfg.headline) +
              copyField("Subhead", "subhead", cfg.subhead) +
              copyField("Win message", "winMessage", cfg.winMessage) +
              copyField("Lose message", "loseMessage", cfg.loseMessage) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function copyField(label, field, value) {
    return '' +
      '<div class="copy-field">' +
        '<label class="label" for="f-' + field + '">' + esc(label) + '</label>' +
        '<input id="f-' + field + '" class="field-lg" value="' + esc(value) + '" ' +
          'data-field="' + field + '" data-fkey="' + field + '" />' +
      '</div>';
  }

  function render() {
    applyAccent();
    var d = derived();

    var body = "";
    if (state.screen === "wheel") body = wheelHtml(d);
    else if (state.screen === "slots") body = slotsHtml();
    else if (state.screen === "boxes") body = boxesHtml();
    else body = homeHtml();

    var html = '<div class="shell">' + topbarHtml() + body + '</div>' +
      resultHtml(d) +
      (state.screen === "admin" ? adminHtml(d) : "");

    var focus = captureFocus();
    root.innerHTML = html;
    restoreFocus(focus);
    spinWheelTo(state.rotation);

    document.title = (cfg.brandName ? cfg.brandName + " — " : "") + "Kiosk Discount Games";
  }

  function spinWheelTo(deg, skipTransition) {
    if (state.screen !== "wheel" || (deg === paintedRotation && !skipTransition)) return;
    var parts = root.querySelectorAll(".wheel-disc, .wheel-labels");
    if (!parts.length) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        paintedRotation = deg;
        for (var i = 0; i < parts.length; i++) {
          if (skipTransition) {
            parts[i].style.transition = "none";
          }
          parts[i].style.transform = "rotate(" + deg + "deg)";
        }
      });
    });
  }

  function captureFocus() {
    var el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.fkey) return null;
    var info = { key: el.dataset.fkey, start: null, end: null };
    try { info.start = el.selectionStart; info.end = el.selectionEnd; } catch (e) { /* range inputs */ }
    return info;
  }

  function restoreFocus(info) {
    if (!info) return;
    var el = root.querySelector('[data-fkey="' + info.key + '"]');
    if (!el) return;
    el.focus();
    if (info.start != null) {
      try { el.setSelectionRange(info.start, info.end); } catch (e) { /* not a text input */ }
    }
  }

  /* ---------- events ---------- */

  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    var action = el.dataset.action;
    var index = Number(el.dataset.index);

    switch (action) {
      case "play": go(el.dataset.game); break;
      case "home": go("home"); break;
      case "spin": spin(); break;
      case "pull": pull(); break;
      case "pick": pick(index); break;
      case "open-admin":
        clearTimers();
        setState({ screen: "admin", result: null, busy: false });
        break;
      case "close-admin":
        setState({
          screen: "home",
          playsLeft: Math.min(state.playsLeft, Number(cfg.playsPerUser) || 0) || Number(cfg.playsPerUser) || 0
        });
        break;
      case "play-again":
        clearTimers();
        locked = 0;
        drag.active = false;
        if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = null; }
        setState({ result: null, picked: null, revealed: false, pickedPrize: "", busy: false, reels: (cfg.reels || []).slice(0, 3).map(function (p) { return p.symbol; }) });
        break;
      case "finish": go("home"); break;
      case "add-prize":
        {
          var set = el.dataset.set || "prizes";
          cfg[set] = (cfg[set] || []).concat([{
            label: "New prize", symbol: "★", odds: 5,
            color: PASTELS[(cfg[set] || []).length % PASTELS.length]
          }]);
          setCfg((function () { var o = {}; o[set] = cfg[set]; return o; })());
        }
        break;
      case "remove-prize":
        {
          var rset = el.dataset.set || "prizes";
          setCfg((function () {
            var o = {};
            o[rset] = (cfg[rset] || []).filter(function (_, k) { return k !== index; });
            return o;
          })());
        }
        break;
      case "swatch":
        setCfg({ accent: el.dataset.color });
        break;
    }
  });

  root.addEventListener("input", function (e) {
    var el = e.target;
    var field = el.dataset && el.dataset.field;
    if (!field) return;
    var index = Number(el.dataset.index);
    var value = el.value;

    if (field === "prize-label" || field === "prize-symbol" || field === "prize-odds" ||
        field === "reels-label" || field === "reels-symbol" || field === "reels-odds" ||
        field === "boxes-label" || field === "boxes-symbol" || field === "boxes-odds") {
      var set = field.split("-")[0];
      var key = /-label$/.test(field) ? "label" : /-symbol$/.test(field) ? "symbol" : "odds";
      var val = key === "odds" ? Math.max(0, Math.min(100, Number(value) || 0)) : value;
      cfg[set] = (cfg[set] || []).map(function (p, k) {
        if (k !== index) return p;
        var next = {}; Object.keys(p).forEach(function (kk) { next[kk] = p[kk]; });
        next[key] = val;
        return next;
      });
      setCfg((function () { var o = {}; o[set] = cfg[set]; return o; })());
      return;
    }

    if (field === "playsPerUser") {
      var plays = Number(value) || 0;
      cfg.playsPerUser = plays;
      saveCfg(cfg);
      setState({ playsLeft: plays });
      return;
    }

    if (field === "expiryDays") { setCfg({ expiryDays: Number(value) || 0 }); return; }

    if (field === "winRate") { setCfg({ winRate: Math.max(1, Number(value) || 1) }); return; }

    setCfg((function () { var o = {}; o[field] = value; return o; })());
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (state.screen === "admin") {
      setState({
        screen: "home",
        playsLeft: Math.min(state.playsLeft, Number(cfg.playsPerUser) || 0) || Number(cfg.playsPerUser) || 0
      });
    } else if (state.result) {
      go("home");
    }
  });

  /* --- drag-to-spin via pointer events --- */

  function angleFromCenter(x, y) {
    return Math.atan2(x - wheelCenterX, -(y - wheelCenterY)) * (180 / Math.PI);
  }

  function onDragPointerDown(e) {
    var stage = e.target.closest(".wheel-stage");
    if (!stage) return;
    if (state.busy || state.playsLeft <= 0) return;
    if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = null; }
    var rect = stage.getBoundingClientRect();
    wheelCenterX = rect.left + rect.width / 2;
    wheelCenterY = rect.top + rect.height / 2;
    drag.active = true;
    drag.startAngle = angleFromCenter(e.clientX, e.clientY);
    drag.baseRotation = state.rotation;
    drag.lastAngle = drag.startAngle;
    drag.lastTime = e.timeStamp;
    drag.velocity = 0;
    stage.classList.add("dragging");
    var parts = root.querySelectorAll(".wheel-disc, .wheel-labels");
    for (var i = 0; i < parts.length; i++) {
      parts[i].style.transition = "none";
    }
    e.preventDefault();
  }

  function onDragPointerMove(e) {
    if (!drag.active) return;
    var currentAngle = angleFromCenter(e.clientX, e.clientY);
    var delta = currentAngle - drag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    var dt = e.timeStamp - drag.lastTime;
    if (dt > 0) {
      var instantVelocity = delta / dt * 16;
      drag.velocity = drag.velocity * 0.6 + instantVelocity * 0.4;
    }
    drag.lastAngle = currentAngle;
    drag.lastTime = e.timeStamp;
    var newRotation = state.rotation + delta;
    setState({ rotation: newRotation });
    e.preventDefault();
  }

  function onDragPointerUp(e) {
    if (!drag.active) return;
    drag.active = false;
    var stage = e.target.closest(".wheel-stage") || root.querySelector(".wheel-stage");
    if (stage) stage.classList.remove("dragging");
    if (Math.abs(drag.velocity) > 0.5) {
      spin(drag.velocity);
    }
    drag.velocity = 0;
  }

  root.addEventListener("pointerdown", onDragPointerDown);
  document.addEventListener("pointermove", onDragPointerMove);
  document.addEventListener("pointerup", onDragPointerUp);

  render();
})();
