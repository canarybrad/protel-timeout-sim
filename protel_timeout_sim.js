// Reservation lock contention simulator.
// Models a hospitality PMS integration where each reservation is serialized
// behind a single distributed lock. Waiters retry lock acquisition every
// 0.5s for up to 180 attempts (90 seconds total) before timing out.

const LOCK_WAIT_BUDGET_S = 90;          // 180 attempts * 0.5s interval
const HOT_POOL_SIZE = 10;
const HISTORY_S = 120;                  // 2 minutes of timeline
const FOCUS_REZ_IDX = 0;                // hottest reservation; we trace its requests
const FOCUS_LOG_MAX = 25;               // most recent requests on focus rez

// ───── Localization ─────
const STRINGS = {
  en: {
    title: "Reservation Lock Contention Simulator",
    subtitle:
      "How per-reservation locks, multi-step API plans, and slow PMS responses cascade into timeouts as traffic ramps.",
    reset: "Reset",
    pause: "Pause",
    resume: "Resume",
    response: "PMS per-step response time",
    responseHint: "How long the PMS takes per API step (the lock is held for the full duration).",
    traffic: "Inbound API traffic",
    trafficHint: "Combined arrival rate of PMS actions across the property.",
    hot: "Hot-reservation skew",
    hotHint: "% of traffic that targets the 10 hottest reservations (arrival day clustering).",
    reservations: "Active reservations",
    reservationsHint: "Pool size that traffic randomly draws from.",
    speed: "Time acceleration",
    speedHint: "Simulation runs faster than wall-clock for visibility.",
    timeoutRate: "Timeout rate (1m)",
    avgWait: "Avg lock wait",
    p95Wait: "P95 lock wait",
    activeLocks: "Active locks",
    queuedWaiters: "Queued waiters",
    throughput: "Throughput (1m)",
    chartLocksTitle: "Locks & queue over time",
    legendActive: "Active locks",
    legendQueue: "Queued waiters",
    legendTimeouts: "Timeouts / sec",
    chartHistTitle: "Lock wait time distribution",
    legendBucket: "Bucket: 5s",
    legendTOBucket: "≥ 90s = timeout",
    chartFocusTitle: "Hot reservation #0 — request trace",
    focusLegend: "arrival → start → finish, last 60s",
    chartBreakdownTitle: "By action kind (rolling 60s)",
    breakdownLegend: "bar = share of traffic",
    gridTitle: "Reservation lock state",
    gridShown: "first 80 shown",
    cellIdle: "idle",
    cellLocked: "locked",
    cellQ1: "1 waiter",
    cellQ2: "2-3 waiters",
    cellQ3: "4+ waiters",
    cellTO: "recent timeout",
    notesTitle: "What the model reflects",
    note1Bold: "Lock scope:",
    note1: "one distributed lock per reservation, keyed by hotel and confirmation number. Any concurrent action on the same reservation must wait its turn.",
    note2Bold: "Wait budget:",
    note2: "a waiter retries lock acquisition every 0.5 seconds, up to 180 attempts. After 90 seconds it gives up and the request fails with a \"lock not acquired\" error.",
    note3Bold: "Plan length:",
    note3: "realistic hospitality action mix — pre-check-in is 3 API steps, post-notes / update-guest / get-folios / post-payment-method are 2 steps, refresh is 1 step. Each step holds the lock for the full PMS response time.",
    note4Bold: "Transient retries:",
    note4: "~10% of fetches hit a transient \"not yet finalized\" warning from the PMS and retry once after a 10s cool-off, inflating the time the lock stays held.",
    note5Bold: "Hot-reservation skew:",
    note5: "on arrival day, many flows (pre-check-in, payment method, post-notes, folios) target the same few confirmation numbers — the slider concentrates traffic to expose contention.",
    // Dynamic / canvas
    sec: "s",
    perSec: (n) => `${n} / sec`,
    perMin: (n) => `${n} / min`,
    percent: (n) => `${n}%`,
    speedX: (n) => `${n}x`,
    maxLocks: (n) => `max locks: ${n}`,
    maxTimeouts: (n) => `max timeouts/s: ${n}`,
    waitingSamples: "waiting for samples…",
    bucketTO: "≥90 TO",
    noFocusTraffic: "no traffic on reservation #0 yet…",
    timeoutsLabel: (n, pct) => `${n} TO (${pct}%)`,
    avgWaitS: (n) => `${n}s wait`,
    tickRel: (s) => `-${s}s`,
    actionNames: {
      PRE_CHECKIN: "PRE_CHECKIN",
      POST_NOTES: "POST_NOTES",
      UPDATE_GUEST: "UPDATE_GUEST",
      GET_FOLIOS: "GET_FOLIOS",
      POST_PAYMENT_METHOD: "POST_PAYMENT_METHOD",
      PRE_CHECKOUT: "PRE_CHECKOUT",
      ADD_ACCOMPANYING_GUEST: "ADD_ACCOMPANYING_GUEST",
      REFRESH_RESERVATION: "REFRESH_RESERVATION",
      REFRESH_GUEST: "REFRESH_GUEST",
    },
  },
  el: {
    title: "Προσομοιωτής Συμφόρησης Κλειδωμάτων Κρατήσεων",
    subtitle:
      "Πώς τα κλειδώματα ανά κράτηση, τα πολυβηματικά σχέδια API και οι αργές αποκρίσεις του PMS κλιμακώνονται σε λήξεις χρόνου καθώς αυξάνεται η κίνηση.",
    reset: "Επαναφορά",
    pause: "Παύση",
    resume: "Συνέχιση",
    response: "Χρόνος απόκρισης PMS ανά βήμα",
    responseHint: "Πόσο διαρκεί κάθε βήμα API του PMS (το κλείδωμα κρατείται για όλη τη διάρκεια).",
    traffic: "Εισερχόμενη κίνηση API",
    trafficHint: "Συνολικός ρυθμός άφιξης ενεργειών PMS στο ξενοδοχείο.",
    hot: "Συγκέντρωση σε δημοφιλείς κρατήσεις",
    hotHint: "% κίνησης που στοχεύει τις 10 πιο δημοφιλείς κρατήσεις (συγκέντρωση ημέρας άφιξης).",
    reservations: "Ενεργές κρατήσεις",
    reservationsHint: "Μέγεθος συνόλου από όπου επιλέγει τυχαία η κίνηση.",
    speed: "Επιτάχυνση χρόνου",
    speedHint: "Η προσομοίωση τρέχει ταχύτερα από τον πραγματικό χρόνο για ορατότητα.",
    timeoutRate: "Ρυθμός λήξεων (1λ)",
    avgWait: "Μέση αναμονή κλειδώματος",
    p95Wait: "P95 αναμονή κλειδώματος",
    activeLocks: "Ενεργά κλειδώματα",
    queuedWaiters: "Σε αναμονή",
    throughput: "Διεκπεραίωση (1λ)",
    chartLocksTitle: "Κλειδώματα & ουρά διαχρονικά",
    legendActive: "Ενεργά κλειδώματα",
    legendQueue: "Σε αναμονή",
    legendTimeouts: "Λήξεις / δευτ",
    chartHistTitle: "Κατανομή χρόνου αναμονής κλειδώματος",
    legendBucket: "Κάδος: 5δ",
    legendTOBucket: "≥ 90δ = λήξη",
    chartFocusTitle: "Δημοφιλής κράτηση #0 — ίχνη αιτημάτων",
    focusLegend: "άφιξη → έναρξη → λήξη, τελευταία 60δ",
    chartBreakdownTitle: "Ανά τύπο ενέργειας (κυλιόμενα 60δ)",
    breakdownLegend: "ράβδος = μερίδιο κίνησης",
    gridTitle: "Κατάσταση κλειδώματος κρατήσεων",
    gridShown: "εμφανίζονται οι πρώτες 80",
    cellIdle: "αδρανές",
    cellLocked: "κλειδωμένο",
    cellQ1: "1 σε αναμονή",
    cellQ2: "2-3 σε αναμονή",
    cellQ3: "4+ σε αναμονή",
    cellTO: "πρόσφατη λήξη",
    notesTitle: "Τι μοντελοποιεί η προσομοίωση",
    note1Bold: "Πεδίο κλειδώματος:",
    note1: "ένα κατανεμημένο κλείδωμα ανά κράτηση, με κλειδί το ξενοδοχείο και τον αριθμό επιβεβαίωσης. Οποιαδήποτε ταυτόχρονη ενέργεια στην ίδια κράτηση πρέπει να περιμένει τη σειρά της.",
    note2Bold: "Όριο αναμονής:",
    note2: "ο αναμένων προσπαθεί κάθε 0,5 δευτερόλεπτα, έως 180 φορές. Μετά από 90 δευτερόλεπτα εγκαταλείπει και το αίτημα αποτυγχάνει με σφάλμα «lock not acquired».",
    note3Bold: "Μήκος σχεδίου:",
    note3: "ρεαλιστική σύνθεση ενεργειών ξενοδοχείου — pre-check-in 3 βήματα API, post-notes / update-guest / get-folios / post-payment-method 2 βήματα, refresh 1 βήμα. Κάθε βήμα κρατά το κλείδωμα για όλο τον χρόνο απόκρισης του PMS.",
    note4Bold: "Παροδικές επαναλήψεις:",
    note4: "~10% των ανακτήσεων συναντούν παροδική προειδοποίηση «not yet finalized» από το PMS και επαναλαμβάνουν μία φορά μετά από 10δ διάλειμμα, διογκώνοντας τον χρόνο που κρατείται το κλείδωμα.",
    note5Bold: "Συγκέντρωση σε δημοφιλείς κρατήσεις:",
    note5: "την ημέρα άφιξης, πολλές ροές (pre-check-in, μέθοδος πληρωμής, post-notes, folios) στοχεύουν τους ίδιους λίγους αριθμούς επιβεβαίωσης — το slider συγκεντρώνει την κίνηση για να αναδείξει τη συμφόρηση.",
    // Dynamic / canvas
    sec: "δ",
    perSec: (n) => `${n} / δευτ`,
    perMin: (n) => `${n} / λεπτό`,
    percent: (n) => `${n}%`,
    speedX: (n) => `${n}×`,
    maxLocks: (n) => `μέγ κλειδώματα: ${n}`,
    maxTimeouts: (n) => `μέγ λήξεις/δ: ${n}`,
    waitingSamples: "αναμονή δειγμάτων…",
    bucketTO: "≥90 ΛΗ",
    noFocusTraffic: "καμία κίνηση στην κράτηση #0 ακόμη…",
    timeoutsLabel: (n, pct) => `${n} ΛΗ (${pct}%)`,
    avgWaitS: (n) => `${n}δ αναμονή`,
    tickRel: (s) => `-${s}δ`,
    actionNames: {
      PRE_CHECKIN: "Προ-Άφιξη",
      POST_NOTES: "Σημειώσεις",
      UPDATE_GUEST: "Ενημέρωση Επισκέπτη",
      GET_FOLIOS: "Λήψη Λογαριασμών",
      POST_PAYMENT_METHOD: "Μέθοδος Πληρωμής",
      PRE_CHECKOUT: "Προ-Αναχώρηση",
      ADD_ACCOMPANYING_GUEST: "Συνοδός Επισκέπτη",
      REFRESH_RESERVATION: "Ανανέωση Κράτησης",
      REFRESH_GUEST: "Ανανέωση Επισκέπτη",
    },
  },
};

let currentLang = (typeof localStorage !== "undefined" && localStorage.getItem("lang")) || "en";
if (!STRINGS[currentLang]) currentLang = "en";
function t(key) {
  return STRINGS[currentLang][key] ?? STRINGS.en[key] ?? key;
}
function tAction(name) {
  return STRINGS[currentLang].actionNames[name] || name;
}

// Per-action color, used consistently across the breakdown + focus trace.
const ACTION_COLORS = {
  PRE_CHECKIN: "#4f8cff",
  POST_NOTES: "#7aa7ff",
  UPDATE_GUEST: "#45c08a",
  GET_FOLIOS: "#f0b341",
  POST_PAYMENT_METHOD: "#e25555",
  PRE_CHECKOUT: "#c178f0",
  ADD_ACCOMPANYING_GUEST: "#5cc2c2",
  REFRESH_RESERVATION: "#888fa8",
  REFRESH_GUEST: "#aab3c4",
};

// Realistic hospitality action mix.
// `steps` = number of API round-trips held under the same reservation lock.
// `code321Pct` = chance of a transient "not finalized" retry on the fetch
// (adds 10s cool-off + an extra round-trip).
const ACTION_KINDS = [
  { name: "PRE_CHECKIN", steps: 3, weight: 12, code321Pct: 0.12 },
  { name: "POST_NOTES", steps: 2, weight: 10, code321Pct: 0.10 },
  { name: "UPDATE_GUEST", steps: 2, weight: 18, code321Pct: 0.10 },
  { name: "GET_FOLIOS", steps: 2, weight: 10, code321Pct: 0.08 },
  { name: "POST_PAYMENT_METHOD", steps: 2, weight: 8, code321Pct: 0.10 },
  { name: "PRE_CHECKOUT", steps: 2, weight: 6, code321Pct: 0.10 },
  { name: "ADD_ACCOMPANYING_GUEST", steps: 2, weight: 6, code321Pct: 0.05 },
  { name: "REFRESH_RESERVATION", steps: 1, weight: 25, code321Pct: 0.15 },
  { name: "REFRESH_GUEST", steps: 1, weight: 5, code321Pct: 0.10 },
];
const ACTION_WEIGHT_TOTAL = ACTION_KINDS.reduce((s, a) => s + a.weight, 0);

function pickAction() {
  let r = Math.random() * ACTION_WEIGHT_TOTAL;
  for (const a of ACTION_KINDS) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return ACTION_KINDS[ACTION_KINDS.length - 1];
}

function pickReservation(state) {
  const n = state.reservations.length;
  if (Math.random() < state.hotShare && n > HOT_POOL_SIZE) {
    return Math.floor(Math.random() * HOT_POOL_SIZE);
  }
  return Math.floor(Math.random() * n);
}

// ───── Simulation state ─────
const state = {
  // Sim clock in seconds.
  t: 0,
  running: true,
  speed: 20,

  // Tunables.
  pmsStepS: 15,
  trafficPerSec: 4.0,
  hotShare: 0.35,

  // Reservations: each has { lockedUntil, queue: [request], lastTimeoutAt, holder }.
  reservations: [],

  // Aggregate counters / rolling windows.
  completed: [], // {finishedAt, waitS, actionName}
  timeouts: [], // {at, actionName}
  // Last N requests targeting the focus reservation. Each entry mutates in place
  // as it transitions queued → holding → done / timedout.
  focusLog: [],
  // Timeline samples every 0.5s of sim time: {t, active, queued, timeoutsRecent}.
  timeline: [],
  // Histogram buckets: 0-5,5-10,...85-90 s. Last bucket = ≥90s timeouts.
  histogram: new Array(19).fill(0),

  // Traffic generator accumulator (fractional requests/tick).
  pendingArrivals: 0,
};

function buildReservations(n) {
  state.reservations = Array.from({ length: n }, () => ({
    lockedUntil: 0,
    queue: [],
    lastTimeoutAt: -1e9,
    holder: null,
  }));
  state.focusLog = [];
}

function createRequest() {
  const action = pickAction();
  // Per-step actual hold time = configured PMS step time + transient-retry inflation.
  // Each fetch step has a chance of a single retry that adds 10s cool-off + another round-trip.
  let totalHoldS = 0;
  for (let i = 0; i < action.steps; i++) {
    totalHoldS += state.pmsStepS;
    if (i === 0 && Math.random() < action.code321Pct) {
      // Fetch step retried once after 10s cool-off (NOT_FINALIZED_COOLOFF_SECONDS).
      totalHoldS += 10 + state.pmsStepS;
    }
  }
  return {
    id: Math.random().toString(36).slice(2, 9),
    actionName: action.name,
    steps: action.steps,
    arrivedAt: state.t,
    holdS: totalHoldS,
    state: "queued",
    startedAt: null,
    finishedAt: null,
  };
}

function recordFocus(rezIdx, req) {
  if (rezIdx !== FOCUS_REZ_IDX) return;
  state.focusLog.push(req);
  while (state.focusLog.length > FOCUS_LOG_MAX) state.focusLog.shift();
}

function startHolding(rez, req) {
  req.state = "holding";
  req.startedAt = state.t;
  rez.lockedUntil = state.t + req.holdS;
  rez.holder = req;
}

function admit(rezIdx, req) {
  const rez = state.reservations[rezIdx];
  recordFocus(rezIdx, req);
  if (rez.lockedUntil <= state.t && rez.queue.length === 0) {
    startHolding(rez, req);
    bucketWait(0);
    return;
  }
  rez.queue.push(req);
}

function bucketWait(waitS) {
  const idx = Math.min(Math.floor(waitS / 5), 18);
  state.histogram[idx]++;
}

function step(dtS) {
  state.t += dtS;

  // 1. Generate new arrivals via Poisson-ish accumulator.
  state.pendingArrivals += state.trafficPerSec * dtS;
  while (state.pendingArrivals >= 1) {
    state.pendingArrivals -= 1;
    const rezIdx = pickReservation(state);
    admit(rezIdx, createRequest());
  }

  // 2. Advance each reservation: finalize current holder, time out queue, promote next.
  for (let i = 0; i < state.reservations.length; i++) {
    const rez = state.reservations[i];

    // Holder finished — mark done so the focus trace stops growing it.
    if (rez.holder && rez.lockedUntil <= state.t) {
      rez.holder.state = "done";
      rez.holder.finishedAt = rez.lockedUntil;
      const waitS = Math.max(0, rez.holder.startedAt - rez.holder.arrivedAt);
      state.completed.push({
        finishedAt: rez.lockedUntil,
        waitS,
        actionName: rez.holder.actionName,
      });
      rez.holder = null;
    }

    // Time out anyone who's waited too long.
    if (rez.queue.length > 0) {
      const stillWaiting = [];
      for (const req of rez.queue) {
        if (state.t - req.arrivedAt >= LOCK_WAIT_BUDGET_S) {
          req.state = "timedout";
          req.finishedAt = state.t;
          state.timeouts.push({ at: state.t, actionName: req.actionName });
          state.histogram[18]++; // ≥90s bucket
          rez.lastTimeoutAt = state.t;
        } else {
          stillWaiting.push(req);
        }
      }
      rez.queue = stillWaiting;
    }

    // Promote queued waiter when lock frees.
    while (rez.lockedUntil <= state.t && rez.queue.length > 0) {
      const next = rez.queue.shift();
      bucketWait(state.t - next.arrivedAt);
      startHolding(rez, next);
    }
  }

  // 3. Sample timeline.
  if (state.timeline.length === 0 || state.t - state.timeline[state.timeline.length - 1].t >= 0.5) {
    let active = 0, queued = 0;
    for (const rez of state.reservations) {
      if (rez.lockedUntil > state.t) active++;
      queued += rez.queue.length;
    }
    const windowStart = state.t - 1;
    let timeoutsRecent = 0;
    for (let i = state.timeouts.length - 1; i >= 0; i--) {
      if (state.timeouts[i].at < windowStart) break;
      timeoutsRecent++;
    }
    state.timeline.push({ t: state.t, active, queued, timeoutsRecent });
    while (state.timeline.length > 0 && state.t - state.timeline[0].t > HISTORY_S) {
      state.timeline.shift();
    }
  }

  // 4. Trim rolling windows.
  const oneMinAgo = state.t - 60;
  while (state.completed.length > 0 && state.completed[0].finishedAt < oneMinAgo) {
    state.completed.shift();
  }
  while (state.timeouts.length > 0 && state.timeouts[0].at < oneMinAgo) {
    state.timeouts.shift();
  }
}

// ───── Rendering ─────
const timelineCanvas = document.getElementById("timeline-canvas");
const tlCtx = timelineCanvas.getContext("2d");
const histCanvas = document.getElementById("histogram-canvas");
const histCtx = histCanvas.getContext("2d");
const focusCanvas = document.getElementById("focus-canvas");
const focusCtx = focusCanvas.getContext("2d");
const breakdown = document.getElementById("action-breakdown");
const grid = document.getElementById("reservation-grid");

const meters = {
  timeoutRate: document.getElementById("timeout-rate"),
  timeoutRateBar: document.getElementById("timeout-rate-bar"),
  avgWait: document.getElementById("avg-wait"),
  p95Wait: document.getElementById("p95-wait"),
  activeLocks: document.getElementById("active-locks"),
  queuedWaiters: document.getElementById("queued-waiters"),
  throughput: document.getElementById("throughput"),
};

function rebuildGrid() {
  grid.innerHTML = "";
  const n = Math.min(80, state.reservations.length);
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    el.className = "rez";
    grid.appendChild(el);
  }
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderTimeline() {
  const rect = timelineCanvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  tlCtx.clearRect(0, 0, w, h);

  // Background grid.
  tlCtx.strokeStyle = "#262d3d";
  tlCtx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    tlCtx.beginPath();
    tlCtx.moveTo(0, y);
    tlCtx.lineTo(w, y);
    tlCtx.stroke();
  }

  if (state.timeline.length < 2) return;

  const maxActive = Math.max(10, ...state.timeline.map((s) => s.active + s.queued));
  const maxTimeout = Math.max(2, ...state.timeline.map((s) => s.timeoutsRecent));
  const tMin = state.timeline[0].t;
  const tMax = state.timeline[state.timeline.length - 1].t;
  const span = Math.max(1, tMax - tMin);

  const xOf = (t) => ((t - tMin) / span) * w;
  const yOfLocks = (v) => h - (v / maxActive) * (h * 0.85) - 8;
  const yOfTimeouts = (v) => h - (v / maxTimeout) * (h * 0.85) - 8;

  // Stacked area: active (blue) + queued (purple).
  tlCtx.fillStyle = "rgba(79, 140, 255, 0.35)";
  tlCtx.beginPath();
  tlCtx.moveTo(xOf(state.timeline[0].t), h);
  for (const s of state.timeline) tlCtx.lineTo(xOf(s.t), yOfLocks(s.active));
  tlCtx.lineTo(xOf(state.timeline[state.timeline.length - 1].t), h);
  tlCtx.closePath();
  tlCtx.fill();

  tlCtx.fillStyle = "rgba(193, 120, 240, 0.35)";
  tlCtx.beginPath();
  tlCtx.moveTo(xOf(state.timeline[0].t), yOfLocks(state.timeline[0].active));
  for (const s of state.timeline) tlCtx.lineTo(xOf(s.t), yOfLocks(s.active + s.queued));
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    tlCtx.lineTo(xOf(state.timeline[i].t), yOfLocks(state.timeline[i].active));
  }
  tlCtx.closePath();
  tlCtx.fill();

  // Line on top: active locks.
  tlCtx.strokeStyle = "#4f8cff";
  tlCtx.lineWidth = 1.6;
  tlCtx.beginPath();
  for (let i = 0; i < state.timeline.length; i++) {
    const x = xOf(state.timeline[i].t), y = yOfLocks(state.timeline[i].active);
    if (i === 0) tlCtx.moveTo(x, y); else tlCtx.lineTo(x, y);
  }
  tlCtx.stroke();

  // Timeouts/sec on secondary axis (red).
  tlCtx.strokeStyle = "#e25555";
  tlCtx.lineWidth = 1.6;
  tlCtx.beginPath();
  for (let i = 0; i < state.timeline.length; i++) {
    const x = xOf(state.timeline[i].t), y = yOfTimeouts(state.timeline[i].timeoutsRecent);
    if (i === 0) tlCtx.moveTo(x, y); else tlCtx.lineTo(x, y);
  }
  tlCtx.stroke();

  // Axis labels.
  tlCtx.fillStyle = "#98a0b3";
  tlCtx.font = "11px -apple-system, sans-serif";
  tlCtx.fillText(t("maxLocks")(maxActive), 6, 12);
  tlCtx.textAlign = "right";
  tlCtx.fillStyle = "#e25555";
  tlCtx.fillText(t("maxTimeouts")(maxTimeout), w - 6, 12);
  tlCtx.textAlign = "left";
}

function renderHistogram() {
  const rect = histCanvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  histCtx.clearRect(0, 0, w, h);

  const buckets = state.histogram;
  const total = buckets.reduce((s, b) => s + b, 0);
  if (total === 0) {
    histCtx.fillStyle = "#98a0b3";
    histCtx.font = "12px -apple-system, sans-serif";
    histCtx.fillText(t("waitingSamples"), 12, 24);
    return;
  }
  const maxBucket = Math.max(...buckets);
  const barW = w / buckets.length;
  const padding = 24;

  for (let i = 0; i < buckets.length; i++) {
    const ratio = buckets[i] / maxBucket;
    const barH = ratio * (h - padding * 2);
    const x = i * barW + 2;
    const y = h - padding - barH;
    histCtx.fillStyle = i === 18 ? "#e25555" : "#4f8cff";
    histCtx.fillRect(x, y, barW - 4, barH);
  }

  // Axis labels for buckets.
  histCtx.fillStyle = "#98a0b3";
  histCtx.font = "10px -apple-system, sans-serif";
  histCtx.textAlign = "center";
  for (let i = 0; i < buckets.length; i++) {
    const label = i === 18 ? t("bucketTO") : `${i * 5}`;
    histCtx.fillText(label, i * barW + barW / 2, h - 8);
  }
  histCtx.textAlign = "left";
}

function renderFocus() {
  const rect = focusCanvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  focusCtx.clearRect(0, 0, w, h);

  const labelW = 130;
  const padR = 12;
  const padTop = 18;
  const padBot = 18;
  const trackW = w - labelW - padR;

  // Window: last 60 sim seconds.
  const windowS = 60;
  const tEnd = state.t;
  const tStart = tEnd - windowS;
  const xOf = (t) => labelW + ((Math.max(t, tStart) - tStart) / windowS) * trackW;

  // 90s budget marker — show only if the budget line falls inside the window.
  // (It's drawn relative to each request's arrivedAt, not absolute time, so we
  // skip a global vertical line and show per-row markers instead.)

  // Time axis.
  focusCtx.strokeStyle = "#262d3d";
  focusCtx.fillStyle = "#98a0b3";
  focusCtx.font = "10px -apple-system, sans-serif";
  focusCtx.lineWidth = 1;
  for (let s = 0; s <= windowS; s += 15) {
    const x = xOf(tStart + s);
    focusCtx.beginPath();
    focusCtx.moveTo(x, padTop);
    focusCtx.lineTo(x, h - padBot);
    focusCtx.stroke();
    focusCtx.fillText(t("tickRel")(windowS - s), x + 2, h - 4);
  }

  const visible = state.focusLog.filter((r) => (r.finishedAt ?? tEnd) >= tStart);
  if (visible.length === 0) {
    focusCtx.fillStyle = "#98a0b3";
    focusCtx.fillText(t("noFocusTraffic"), labelW, padTop + 18);
    return;
  }

  const rowH = Math.max(10, Math.min(18, (h - padTop - padBot) / visible.length));

  for (let i = 0; i < visible.length; i++) {
    const req = visible[i];
    const y = padTop + i * rowH;

    // Label: action name.
    focusCtx.fillStyle = ACTION_COLORS[req.actionName] || "#ccc";
    focusCtx.font = "11px -apple-system, sans-serif";
    focusCtx.fillText(tAction(req.actionName), 6, y + rowH - 4);

    // Wait portion: from arrivedAt to startedAt-or-now-or-timeoutAt.
    const arrX = xOf(req.arrivedAt);
    let waitEnd = req.startedAt ?? req.finishedAt ?? tEnd;
    const waitX = xOf(waitEnd);
    if (waitX > arrX) {
      focusCtx.fillStyle = "rgba(152, 160, 179, 0.35)";
      focusCtx.fillRect(arrX, y + 2, waitX - arrX, rowH - 6);
    }

    // Hold portion: from startedAt to finishedAt-or-now.
    if (req.startedAt !== null) {
      const holdStartX = xOf(req.startedAt);
      const holdEndX = xOf(req.finishedAt ?? tEnd);
      focusCtx.fillStyle = ACTION_COLORS[req.actionName] || "#4f8cff";
      focusCtx.fillRect(holdStartX, y + 2, Math.max(2, holdEndX - holdStartX), rowH - 6);
    }

    // Timeout marker.
    if (req.state === "timedout") {
      const toX = xOf(req.finishedAt);
      focusCtx.strokeStyle = "#e25555";
      focusCtx.lineWidth = 2;
      focusCtx.beginPath();
      focusCtx.moveTo(toX - 4, y + 3);
      focusCtx.lineTo(toX + 4, y + rowH - 5);
      focusCtx.moveTo(toX + 4, y + 3);
      focusCtx.lineTo(toX - 4, y + rowH - 5);
      focusCtx.stroke();
    }

    // Step count badge on right edge of hold (so you can see "3-step PRE_CHECKIN held for 135s").
    if (req.startedAt !== null && req.state !== "timedout") {
      const holdEndX = xOf(req.finishedAt ?? tEnd);
      focusCtx.fillStyle = "#0f1115";
      focusCtx.font = "9px -apple-system, sans-serif";
      const label = `${req.steps}×`;
      focusCtx.fillText(label, holdEndX - 14, y + rowH - 6);
    }
  }
}

function renderBreakdown() {
  // Aggregate from rolling 60s windows.
  const counts = {};
  for (const k of Object.keys(ACTION_COLORS)) {
    counts[k] = { fired: 0, timedOut: 0, waitSum: 0, waitN: 0 };
  }
  for (const c of state.completed) {
    if (!counts[c.actionName]) continue;
    counts[c.actionName].fired++;
    counts[c.actionName].waitSum += c.waitS;
    counts[c.actionName].waitN++;
  }
  for (const t of state.timeouts) {
    if (!counts[t.actionName]) continue;
    counts[t.actionName].fired++;
    counts[t.actionName].timedOut++;
  }
  const totalFired = Object.values(counts).reduce((s, c) => s + c.fired, 0);

  const rows = Object.entries(counts)
    .sort((a, b) => b[1].fired - a[1].fired);

  breakdown.innerHTML = "";
  for (const [name, c] of rows) {
    const row = document.createElement("div");
    row.className = "action-row";
    const share = totalFired > 0 ? (c.fired / totalFired) * 100 : 0;
    const timeoutPct = c.fired > 0 ? (c.timedOut / c.fired) * 100 : 0;
    const avgWait = c.waitN > 0 ? c.waitSum / c.waitN : 0;
    const toClass = timeoutPct >= 25 ? "bad" : timeoutPct >= 8 ? "warn" : "";

    row.innerHTML = `
      <div class="name" style="color:${ACTION_COLORS[name]}">${tAction(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${share}%;background:${ACTION_COLORS[name]}"></div></div>
      <div class="timeout-pct ${toClass}">${t("timeoutsLabel")(c.timedOut, timeoutPct.toFixed(0))}</div>
      <div class="wait">${t("avgWaitS")(avgWait.toFixed(0))}</div>
    `;
    breakdown.appendChild(row);
  }
}

function renderGrid() {
  const cells = grid.children;
  for (let i = 0; i < cells.length; i++) {
    const rez = state.reservations[i];
    if (!rez) continue;
    const justTimedOut = state.t - rez.lastTimeoutAt < 3;
    const held = rez.lockedUntil > state.t;
    const q = rez.queue.length;
    cells[i].style.background = justTimedOut
      ? "var(--grid-timeout)"
      : held && q >= 4
      ? "var(--grid-q3)"
      : held && q >= 2
      ? "var(--grid-q2)"
      : held && q >= 1
      ? "var(--grid-q1)"
      : held
      ? "var(--grid-held)"
      : "var(--grid-idle)";
  }
}

function renderMeters() {
  const completedCount = state.completed.length;
  const timeoutCount = state.timeouts.length;
  const total = completedCount + timeoutCount;
  const rate = total > 0 ? (timeoutCount / total) * 100 : 0;
  meters.timeoutRate.textContent = `${rate.toFixed(1)}%`;
  meters.timeoutRateBar.style.width = `${Math.min(100, rate)}%`;
  meters.timeoutRate.style.color = rate > 10 ? "var(--danger)" : rate > 3 ? "var(--warn)" : "var(--good)";

  const waits = state.completed.map((c) => c.waitS).sort((a, b) => a - b);
  const avg = waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : 0;
  const p95 = waits.length ? waits[Math.floor(waits.length * 0.95)] || waits[waits.length - 1] : 0;
  meters.avgWait.textContent = `${avg.toFixed(1)}${t("sec")}`;
  meters.p95Wait.textContent = `${p95.toFixed(1)}${t("sec")}`;
  meters.p95Wait.style.color = p95 > 60 ? "var(--danger)" : p95 > 20 ? "var(--warn)" : "var(--good)";

  let active = 0, queued = 0;
  for (const rez of state.reservations) {
    if (rez.lockedUntil > state.t) active++;
    queued += rez.queue.length;
  }
  meters.activeLocks.textContent = active.toString();
  meters.queuedWaiters.textContent = queued.toString();
  meters.queuedWaiters.style.color = queued > active ? "var(--warn)" : "var(--text)";

  meters.throughput.textContent = t("perMin")(completedCount);
}

// ───── Wiring ─────
const sliderAppliers = [];
function bindSlider(id, valueId, setter, formatter) {
  const slider = document.getElementById(id);
  const value = document.getElementById(valueId);
  const apply = () => {
    setter(parseFloat(slider.value));
    value.textContent = formatter(parseFloat(slider.value));
  };
  slider.addEventListener("input", apply);
  apply();
  sliderAppliers.push(apply);
}

bindSlider(
  "response-slider",
  "response-value",
  (v) => (state.pmsStepS = v),
  (v) => `${v}${t("sec")}`
);
bindSlider(
  "traffic-slider",
  "traffic-value",
  (v) => (state.trafficPerSec = v / 10),
  (v) => t("perSec")((v / 10).toFixed(1))
);
bindSlider(
  "hot-slider",
  "hot-value",
  (v) => (state.hotShare = v / 100),
  (v) => t("percent")(v)
);
bindSlider(
  "reservations-slider",
  "reservations-value",
  (v) => {
    buildReservations(v);
    rebuildGrid();
  },
  (v) => `${v}`
);
bindSlider(
  "speed-slider",
  "speed-value",
  (v) => (state.speed = v),
  (v) => t("speedX")(v)
);

const playBtn = document.getElementById("play-btn");
function refreshPlayBtn() {
  playBtn.textContent = state.running ? t("pause") : t("resume");
}
playBtn.addEventListener("click", () => {
  state.running = !state.running;
  refreshPlayBtn();
});
refreshPlayBtn();

const langSelect = document.getElementById("lang-select");
langSelect.value = currentLang;
langSelect.addEventListener("change", () => {
  currentLang = langSelect.value;
  try { localStorage.setItem("lang", currentLang); } catch (e) {}
  applyTranslations();
});

function applyTranslations() {
  document.documentElement.lang = currentLang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  refreshPlayBtn();
  for (const apply of sliderAppliers) apply();
}
applyTranslations();

document.getElementById("reset-btn").addEventListener("click", () => {
  state.t = 0;
  state.completed = [];
  state.timeouts = [];
  state.timeline = [];
  state.histogram = new Array(19).fill(0);
  state.pendingArrivals = 0;
  state.focusLog = [];
  for (const rez of state.reservations) {
    rez.lockedUntil = 0;
    rez.queue = [];
    rez.lastTimeoutAt = -1e9;
    rez.holder = null;
  }
});

// ───── Main loop ─────
let lastFrame = performance.now();
function frame(now) {
  const wallDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (state.running) {
    // Step in small sub-ticks so dt stays under ~0.25s even at high speed.
    const targetDt = wallDt * state.speed;
    const subTicks = Math.max(1, Math.ceil(targetDt / 0.25));
    const subDt = targetDt / subTicks;
    for (let i = 0; i < subTicks; i++) step(subDt);
  }

  renderTimeline();
  renderHistogram();
  renderFocus();
  renderBreakdown();
  renderGrid();
  renderMeters();

  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  fitCanvas(timelineCanvas);
  fitCanvas(histCanvas);
  fitCanvas(focusCanvas);
});

fitCanvas(timelineCanvas);
fitCanvas(histCanvas);
fitCanvas(focusCanvas);
requestAnimationFrame(frame);
