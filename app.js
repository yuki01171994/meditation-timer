// --------- Elements
const minutesSelect = document.getElementById("minutes");
const secondsSelect = document.getElementById("seconds");
const pickerWrap = document.getElementById("picker");
const display = document.getElementById("display");
const statusEl = document.getElementById("status");

const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const endBtn = document.getElementById("end");

const totalEl = document.getElementById("total");
const ringArc = document.getElementById("ringArc");

const settingsDlg = document.getElementById("settings");
const settingsBtn = document.getElementById("settingsBtn");
const notifyModeSel = document.getElementById("notifyMode");
const secondsStepSel = document.getElementById("secondsStep");

// --------- Storage keys
const SESSIONS_KEY = "serein.sessions.v1";
const SETTINGS_KEY = "serein.settings.v1";

// --------- Defaults
const DEFAULT_SETTINGS = {
  notifyMode: "sound", // none | sound | vibrate | both
  secondsStep: 5,      // 5 or 1
};
const COMPLETION_HOLD_MS = 3000;

// --------- State
let state = "idle"; // idle | running | paused | holding
let tickId = null;

let startAtMs = null;
let endAtMs = null;
let pausedRemainingSec = 0;

let selectedRange = "day";

// --------- Helpers
function pad(n) { return String(n).padStart(2, "0"); }

function formatMMSS(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function formatHHMMSS(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function nowMs() { return Date.now(); }

// --------- Settings
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let settings = loadSettings();
notifyModeSel.value = settings.notifyMode;
secondsStepSel.value = String(settings.secondsStep);

settingsBtn.addEventListener("click", () => settingsDlg.showModal());
document.getElementById("saveSettings").addEventListener("click", () => {
  settings.notifyMode = notifyModeSel.value;
  settings.secondsStep = Number(secondsStepSel.value);
  saveSettings(settings);
  rebuildSecondsOptions();
  resetFromInputs();
});

// --------- Picker options
function buildOptions(select, values) {
  select.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = pad(v);
    select.appendChild(opt);
  }
}

function rebuildSecondsOptions() {
  const step = settings.secondsStep === 1 ? 1 : 5;
  const values = [];
  for (let v = 0; v <= 59; v += step) values.push(v);
  // keep max at 55 when step=5 (Apple Watch feel)
  const filtered = step === 5 ? values.filter(v => v <= 55) : values;
  buildOptions(secondsSelect, filtered);
}

buildOptions(minutesSelect, Array.from({ length: 60 }, (_, i) => i));
rebuildSecondsOptions();

// --------- Timer core (endAt-based, drift-resistant)
function getInputSeconds() {
  const m = Number(minutesSelect.value || 0);
  const s = Number(secondsSelect.value || 0);
  return m * 60 + s;
}

function setPickerEnabled(enabled) {
  minutesSelect.disabled = !enabled;
  secondsSelect.disabled = !enabled;
  pickerWrap.style.opacity = enabled ? "1" : "0.65";
}

function setStatus(text) { statusEl.textContent = text || ""; }

function setDisplay(sec) {
  display.textContent = formatMMSS(Math.max(0, sec));
}

function remainingSeconds() {
  if (state === "running" && endAtMs != null) {
    return Math.ceil((endAtMs - nowMs()) / 1000);
  }
  if (state === "paused") return pausedRemainingSec;
  return 0;
}

function stopTick() {
  if (tickId) cancelAnimationFrame(tickId);
  tickId = null;
}

function tick() {
  if (state !== "running") return;

  const rem = remainingSeconds();
  setDisplay(clamp(rem, 0, 60 * 60)); // safety clamp
  if (rem <= 0) {
    complete();
    return;
  }
  tickId = requestAnimationFrame(tick);
}

function start() {
  if (state === "running" || state === "holding") return;

  const total = (state === "paused") ? pausedRemainingSec : getInputSeconds();
  if (total <= 0) return;

  if (state !== "paused") startAtMs = nowMs();
  endAtMs = nowMs() + total * 1000;

  state = "running";
  setPickerEnabled(false);
  setStatus("");
  stopTick();
  tick();
}

function pause() {
  if (state !== "running") return;
  pausedRemainingSec = Math.max(0, remainingSeconds());
  state = "paused";
  stopTick();
  setStatus("Paused");
}

function end(interrupted = true) {
  // End: save as interrupted session if time elapsed > 0
  if (state === "idle" || state === "holding") {
    resetFromInputs();
    return;
  }

  const endMs = nowMs();
  stopTick();

  const elapsedSec = startAtMs ? Math.max(0, Math.round((endMs - startAtMs) / 1000)) : 0;
  if (elapsedSec > 0) {
    saveSession({
      startedAt: new Date(startAtMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      durationSeconds: elapsedSec,
      completed: !interrupted ? true : false,
    });
  }

  state = "idle";
  startAtMs = null;
  endAtMs = null;
  pausedRemainingSec = 0;

  setPickerEnabled(true);
  setStatus("");
  resetFromInputs();
  refreshHistory();
}

function complete() {
  // Save completed session based on actual elapsed time
  const endMs = nowMs();
  const elapsedSec = startAtMs ? Math.max(0, Math.round((endMs - startAtMs) / 1000)) : 0;

  stopTick();
  state = "holding";
  setDisplay(0);
  setStatus("");

  if (elapsedSec > 0) {
    saveSession({
      startedAt: new Date(startAtMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      durationSeconds: elapsedSec,
      completed: true,
    });
  }

  fireCompletionNotice();

  // Hold 00:00 for 3 seconds, then go idle
  setTimeout(() => {
    state = "idle";
    startAtMs = null;
    endAtMs = null;
    pausedRemainingSec = 0;

    setPickerEnabled(true);
    resetFromInputs();
    refreshHistory();
  }, COMPLETION_HOLD_MS);
}

// --------- Completion notice (sound/vibrate)
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 740;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();

    // gentle envelope
    const t = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    setTimeout(() => { o.stop(); ctx.close(); }, 420);
  } catch {}
}

function vibrate() {
  if (navigator.vibrate) {
    navigator.vibrate([70, 30, 70]); // gentle
  }
}

function fireCompletionNotice() {
  const mode = settings.notifyMode;
  if (mode === "none") return;
  if (mode === "sound" || mode === "both") beep();
  if (mode === "vibrate" || mode === "both") vibrate();
}

// --------- Events
startBtn.addEventListener("click", start);
pauseBtn.addEventListener("click", pause);
endBtn.addEventListener("click", () => end(true));

minutesSelect.addEventListener("change", () => { if (state === "idle") resetFromInputs(); });
secondsSelect.addEventListener("change", () => { if (state === "idle") resetFromInputs(); });

// --------- Sessions + History
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSession(session) {
  const sessions = loadSessions();
  sessions.push(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

// Monday-start week
function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun ... 6 Sat
  const diff = (day === 0) ? -6 : (1 - day);
  x.setDate(x.getDate() + diff);
  return x;
}

function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function inRangeByStartedAt(session, range) {
  const s = new Date(session.startedAt);
  const now = new Date();

  if (range === "day") {
    const a = startOfDay(now);
    const b = new Date(a); b.setDate(b.getDate() + 1);
    return s >= a && s < b;
  }
  if (range === "week") {
    const a = startOfWeekMonday(now);
    const b = new Date(a); b.setDate(b.getDate() + 7);
    return s >= a && s < b;
  }
  if (range === "month") {
    const a = startOfMonth(now);
    const b = new Date(a); b.setMonth(b.getMonth() + 1);
    return s >= a && s < b;
  }
  return true; // all
}

function calcTotalSeconds(range) {
  const sessions = loadSessions();
  let sum = 0;
  for (const ses of sessions) {
    if (inRangeByStartedAt(ses, range)) {
      sum += Number(ses.durationSeconds || 0);
    }
  }
  return sum;
}

// Ring: non-goal style — just a gentle arc based on log scale
function updateRing(totalSec) {
  const circumference = 289;
  // Map seconds -> 0..1 softly (log curve)
  const k = Math.log10(1 + totalSec);
  const t = clamp(k / 4, 0, 1); // tune "4" for feel
  const offset = circumference * (1 - t);
  ringArc.style.strokeDashoffset = String(offset);
}

function refreshHistory() {
  const totalSec = calcTotalSeconds(selectedRange);
  totalEl.textContent = formatHHMMSS(totalSec);
  updateRing(totalSec);
}

// Range buttons
document.querySelectorAll(".segBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedRange = btn.dataset.range;
    document.querySelectorAll(".segBtn").forEach(b => b.classList.toggle("active", b === btn));
    refreshHistory();
  });
});

// --------- Init
function resetFromInputs() {
  const total = getInputSeconds();
  setDisplay(total);
}
resetFromInputs();
document.querySelector(`.segBtn[data-range="${selectedRange}"]`)?.classList.add("active");
refreshHistory();
setPickerEnabled(true);
setStatus("");