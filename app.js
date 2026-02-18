document.addEventListener("DOMContentLoaded", () => {
  try {
    console.log("App initialized");

    // --------- Elements
    const minutesSelect = document.getElementById("minutes");
    const secondsSelect = document.getElementById("seconds");
    const pickerWrap = document.getElementById("picker");
    const display = document.getElementById("display");
    const statusEl = document.getElementById("status");
    const timerContainer = document.querySelector(".timer");

    function addPetals() { /* effect is now CSS-only via .timer.breathing */ }
    function removePetals() {
      if (!timerContainer) return;
      timerContainer.querySelectorAll(".breathe-container").forEach(el => el.remove());
    }



    if (!document.getElementById("start")) {
      throw new Error("UI Elements not found");
    }
    const startBtn = document.getElementById("start");
    const pauseBtn = document.getElementById("pause");
    const endBtn = document.getElementById("end");

    const totalEl = document.getElementById("total");
    const ringArc = document.getElementById("ringArc");
    const calendarView = document.getElementById("calendarView");
    const currentMonthLabel = document.getElementById("currentMonthLabel");
    const calendarGrid = document.getElementById("calendarGrid");
    const prevMonthBtn = document.getElementById("prevMonth");
    const nextMonthBtn = document.getElementById("nextMonth");
    const dayDetailPanel = document.getElementById("dayDetailPanel");
    const selectedDateLabel = document.getElementById("selectedDateLabel");
    const dayTotalTime = document.getElementById("dayTotalTime");
    const daySessionsList = document.getElementById("daySessionsList");

    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth();
    let selectedDateStr = null;

    const settingsModal = document.getElementById("settingsModal");
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsCloseBtn = document.getElementById("settingsClose");
    const notifyModeSel = document.getElementById("notifyMode");
    const secondsStepSel = document.getElementById("secondsStep");

    const timerView = document.getElementById("timerView");
    const statsView = document.getElementById("statsView");
    const viewTimerBtn = document.getElementById("viewTimer");
    const viewStatsBtn = document.getElementById("viewStats");

    const barChart = document.getElementById("barChart");
    const barLabels = document.getElementById("barLabels");
    const chartRangeLabel = document.getElementById("chartRangeLabel");
    const chartTotalTime = document.getElementById("chartTotalTime");
    const statDailyAvg = document.getElementById("statDailyAvg");
    const statBestDay = document.getElementById("statBestDay");
    const statTotalCount = document.getElementById("statTotalCount");
    let currentChartRange = "day";

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
    let lastRemainingSec = null; // To track countdown beeps
    let audioCtx = null; // Reused AudioContext for iOS


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
    if (notifyModeSel) notifyModeSel.value = settings.notifyMode;
    if (secondsStepSel) secondsStepSel.value = String(settings.secondsStep);

    function openSettings() {
      console.log("Opening settings");
      if (settingsModal) {
        settingsModal.classList.add("open");
        settingsModal.setAttribute("aria-hidden", "false");
      }
    }

    function closeSettings() {
      console.log("Closing settings");
      if (settingsModal) {
        settingsModal.classList.remove("open");
        settingsModal.setAttribute("aria-hidden", "true");
      }
    }

    if (settingsBtn) {
      settingsBtn.addEventListener("click", openSettings);
      settingsBtn.addEventListener("touchstart", (e) => { e.preventDefault(); openSettings(); }, { passive: false });
    }
    if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettings);

    // Close on overlay click
    if (settingsModal) {
      settingsModal.addEventListener("click", (e) => {
        if (e.target.dataset.close) closeSettings();
      });
    }

    const saveBtn = document.getElementById("saveSettings");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        settings.notifyMode = notifyModeSel.value;
        settings.secondsStep = Number(secondsStepSel.value);
        saveSettings(settings);
        rebuildSecondsOptions();
        resetFromInputs();
        closeSettings();
      });
    }

    // --------- Picker options
    function buildOptions(select, values) {
      if (!select) return;
      select.innerHTML = "";
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = pad(v);
        select.appendChild(opt);
      }
    }

    function rebuildSecondsOptions() {
      if (!secondsSelect) return;
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
        return Math.round((endAtMs - nowMs()) / 1000);
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

      // Countdown beep at 3, 2, 1
      if (rem > 0 && rem <= 3 && rem !== lastRemainingSec) {
        lastRemainingSec = rem;
        fireTickNotice();
      }

      if (rem <= 0) {
        complete();
        return;
      }
      tickId = requestAnimationFrame(tick);
    }

    function start() {
      if (state === "running" || state === "holding") return;

      // Resume audio context on user gesture (iOS requirement)
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      const total = (state === "paused") ? pausedRemainingSec : getInputSeconds();
      if (total <= 0) return;

      if (state !== "paused") startAtMs = nowMs();
      endAtMs = nowMs() + total * 1000;

      state = "running";
      lastRemainingSec = null;
      setPickerEnabled(false);
      setStatus("");
      if (timerContainer) timerContainer.classList.add("breathing");
      addPetals();
      stopTick();
      tick();
    }


    function pause() {
      if (state !== "running") return;
      pausedRemainingSec = Math.max(0, remainingSeconds());
      state = "paused";
      stopTick();
      if (timerContainer) timerContainer.classList.remove("breathing");
      removePetals();
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
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
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
      lastRemainingSec = null;

      setPickerEnabled(true);
      if (timerContainer) timerContainer.classList.remove("breathing");
      removePetals();
      setStatus("");
      resetFromInputs();
      refreshHistory();
      renderAnalyticsChart(currentChartRange);
    }


    // ... complete() is below ...

    function triggerRipple(type) {
      const r = document.createElement("div");
      r.className = `ripple ${type}`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 1000);
    }

    function playTickBeep() {
      try {
        if (!audioCtx) return;
        const ctx = audioCtx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880; // A5 - Higher pitch for tick
        g.gain.value = 0.05; // Quiet
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        setTimeout(() => { o.stop(); }, 150);
      } catch { }
    }

    function fireTickNotice() {
      const mode = settings.notifyMode;

      // Visual feedback: Always trigger unless "none"
      if (mode !== "none") {
        triggerRipple("weak");
      }

      // Sound feedback
      if (mode === "sound" || mode === "both") {
        playTickBeep();
      }
    }

    function complete() {
      // Save completed session based on actual elapsed time
      const endMs = nowMs();
      const elapsedSec = startAtMs ? Math.max(0, Math.round((endMs - startAtMs) / 1000)) : 0;

      stopTick();
      state = "holding";
      if (timerContainer) timerContainer.classList.remove("breathing");
      removePetals();
      setDisplay(0);
      setStatus("");


      // Fire notification immediately
      fireCompletionNotice();

      // Visual feedback: Always trigger unless "none"
      const mode = settings.notifyMode;
      if (mode !== "none") {
        triggerRipple("strong");
      }

      if (elapsedSec > 0) {
        saveSession({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          startedAt: new Date(startAtMs).toISOString(),
          endedAt: new Date(endMs).toISOString(),
          durationSeconds: elapsedSec,
          completed: true,
        });
      }

      // Hold 00:00 for 3 seconds, then go idle
      setTimeout(() => {
        state = "idle";
        startAtMs = null;
        endAtMs = null;
        pausedRemainingSec = 0;
        lastRemainingSec = null;

        setPickerEnabled(true);
        setStatus("");
        resetFromInputs();
        refreshHistory();
      }, COMPLETION_HOLD_MS);
    }

    // --------- Completion notice (sound/vibrate)
    // Richer singing bowl style sound
    function playBell() {
      try {
        if (!audioCtx) return;
        const ctx = audioCtx;

        const t = ctx.currentTime;

        // Fundamental frequency (528Hz - often used in meditation)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(528, t);

        // Overtone (Harmonic)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(528 * 1.5, t); // Perfect fifth

        // Connect
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        // Envelope - Long release for meditation feel
        const duration = 2.5;

        // Osc 1 (Main)
        gain1.gain.setValueAtTime(0, t);
        gain1.gain.linearRampToValueAtTime(0.15, t + 0.05); // Attack
        gain1.gain.exponentialRampToValueAtTime(0.001, t + duration); // Release

        // Osc 2 (Overtone - subtle)
        gain2.gain.setValueAtTime(0, t);
        gain2.gain.linearRampToValueAtTime(0.05, t + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + duration - 0.5);

        osc1.start(t);
        osc2.start(t);

        osc1.stop(t + duration + 0.5);
        osc2.stop(t + duration + 0.5);

        osc1.stop(t + duration + 0.5);
        osc2.stop(t + duration + 0.5);

        // Do not close context, keep for next beep
      } catch (e) { console.error(e); }
    }

    function vibrate() {
      if (navigator.vibrate) {
        navigator.vibrate([70, 30, 70]); // gentle
      }
    }

    function fireCompletionNotice() {
      const mode = settings.notifyMode;
      if (mode === "none") return;
      if (mode === "sound" || mode === "both") playBell();
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
      renderAnalyticsChart(currentChartRange);
    }

    function deleteSession(id) {
      if (!confirm("Are you sure you want to delete this session?")) return;
      let sessions = loadSessions();
      sessions = sessions.filter(s => s.id !== id);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      refreshHistory();
      renderAnalyticsChart(currentChartRange);
      if (selectedDateStr) {
        showDayDetails(selectedDateStr);
      }
    }

    function startOfDay(d) {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
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

    // Range buttons
    document.querySelectorAll(".segBtn").forEach(btn => {
      const handle = (e) => {
        if (e.type === 'touchstart') e.preventDefault();
        console.log("Range selected:", btn.dataset.range);
        selectedRange = btn.dataset.range;
        document.querySelectorAll(".segBtn").forEach(b => b.classList.toggle("active", b === btn));
        refreshHistory();
      };
      btn.addEventListener("click", handle);
      btn.addEventListener("touchstart", handle, { passive: false });
    });

    // --------- Calendar Logic
    function getMonthName(y, m) {
      return new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
    }

    function getSessionsForDay(y, m, d) {
      const sessions = loadSessions();
      // Simple string match
      const target = new Date(y, m, d).toDateString();
      return sessions.filter(s => new Date(s.startedAt).toDateString() === target);
    }

    function toDateKey(dateObj) {
      return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
    }

    function renderCalendar() {
      currentMonthLabel.textContent = getMonthName(calYear, calMonth);
      calendarGrid.innerHTML = "";

      const firstDay = new Date(calYear, calMonth, 1);
      const lastDay = new Date(calYear, calMonth + 1, 0);

      // Monday start: Sun=0 -> 6, Mon=1 -> 0
      let startDay = firstDay.getDay() - 1;
      if (startDay < 0) startDay = 6;

      const totalDays = lastDay.getDate();

      // Empty cells
      for (let i = 0; i < startDay; i++) {
        const c = document.createElement("div");
        c.className = "dayCell otherMonth";
        calendarGrid.appendChild(c);
      }

      const todayKey = toDateKey(new Date());

      for (let d = 1; d <= totalDays; d++) {
        const dateObj = new Date(calYear, calMonth, d);
        const key = toDateKey(dateObj);
        const sessions = getSessionsForDay(calYear, calMonth, d);

        const c = document.createElement("div");
        c.className = "dayCell";
        c.textContent = d;

        if (key === toDateKey(new Date())) c.classList.add("today"); // Re-check today
        if (key === selectedDateStr) c.classList.add("selected");

        if (sessions.length > 0) {
          const dot = document.createElement("div");
          dot.className = "dot";
          // If none completed, grey dot
          if (!sessions.some(s => s.completed)) dot.classList.add("interrupted");
          c.appendChild(dot);
        }

        c.addEventListener("click", () => {
          // Toggle selection
          if (selectedDateStr === key) {
            selectedDateStr = null;
            dayDetailPanel.hidden = true;
          } else {
            selectedDateStr = key;
            showDayDetails(key);
          }
          renderCalendar();
        });

        calendarGrid.appendChild(c);
      }
    }

    function showDayDetails(dateKey) {
      const [y, m, d] = dateKey.split("-").map(Number);
      const dateObj = new Date(y, m - 1, d);
      selectedDateLabel.textContent = dateObj.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

      const sessions = getSessionsForDay(y, m - 1, d);
      sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

      const daySum = sessions.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
      dayTotalTime.textContent = formatHHMMSS(daySum);

      daySessionsList.innerHTML = "";
      if (sessions.length === 0) {
        daySessionsList.innerHTML = `<div style="text-align:center; opacity:0.5; font-size:0.85rem; padding:1rem;">No sessions</div>`;
      } else {
        sessions.forEach(s => {
          const st = new Date(s.startedAt);
          const timeStr = st.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
          const durStr = formatMMSS(s.durationSeconds);
          const statusText = s.completed ? "Done" : "Incomplete";
          const statusColor = s.completed ? "#00d2b4" : "#b9c1cf";

          const el = document.createElement("div");
          el.className = "sessionItem";
          el.innerHTML = `
            <span class="sessionTime">${timeStr}</span>
            <div style="display:grid;">
              <span class="sessionDur">${durStr}</span>
            </div>
            <span class="sessionStatus" style="color: ${statusColor}">${statusText}</span>
            <button class="deleteSessionBtn" title="Delete session">✕</button>
          `;
          el.querySelector(".deleteSessionBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteSession(s.id);
          });
          daySessionsList.appendChild(el);
        });
      }
      dayDetailPanel.hidden = false;
    }

    prevMonthBtn.addEventListener("click", () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    nextMonthBtn.addEventListener("click", () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });

    // --------- View Switching
    viewTimerBtn.addEventListener("click", () => {
      timerView.hidden = false;
      statsView.hidden = true;
      viewTimerBtn.classList.add("active");
      viewStatsBtn.classList.remove("active");
    });

    viewStatsBtn.addEventListener("click", () => {
      timerView.hidden = true;
      statsView.hidden = false;
      viewTimerBtn.classList.remove("active");
      viewStatsBtn.classList.add("active");
      renderAnalyticsChart(currentChartRange);
    });

    // --------- Analytics Logic
    document.querySelectorAll("[data-chart-range]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-chart-range]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentChartRange = btn.dataset.chartRange;
        renderAnalyticsChart(currentChartRange);
      });
    });

    function renderAnalyticsChart(range) {
      const sessions = loadSessions();
      let data = [];
      let labels = [];
      let totalTime = 0;

      const now = new Date();

      if (range === "day") {
        chartRangeLabel.textContent = "Last 7 Days";
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const key = d.toLocaleDateString("en-US", { weekday: "short" });
          const daySum = sessions
            .filter(s => startOfDay(new Date(s.startedAt)).getTime() === startOfDay(d).getTime())
            .reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
          data.push(daySum);
          labels.push(key);
          totalTime += daySum;
        }
      } else if (range === "week") {
        chartRangeLabel.textContent = "Last 4 Weeks";
        for (let i = 3; i >= 0; i--) {
          const start = new Date(now);
          start.setDate(start.getDate() - (i * 7 + (start.getDay() || 7) - 1));
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(end.getDate() + 7);

          const weekSum = sessions
            .filter(s => {
              const st = new Date(s.startedAt).getTime();
              return st >= start.getTime() && st < end.getTime();
            })
            .reduce((acc, s) => acc + (s.durationSeconds || 0), 0);

          data.push(weekSum);
          labels.push(`W-${i}`);
          totalTime += weekSum;
        }
      } else if (range === "month") {
        chartRangeLabel.textContent = "Last 6 Months";
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthLabel = d.toLocaleDateString("en-US", { month: "short" });
          const monthSum = sessions
            .filter(s => {
              const st = new Date(s.startedAt);
              return st.getFullYear() === d.getFullYear() && st.getMonth() === d.getMonth();
            })
            .reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
          data.push(monthSum);
          labels.push(monthLabel);
          totalTime += monthSum;
        }
      }

      // Render Bars
      const max = Math.max(...data, 1);
      barChart.innerHTML = "";
      barLabels.innerHTML = "";

      data.forEach((val, i) => {
        const height = (val / max) * 100;
        const wrapper = document.createElement("div");
        wrapper.className = "barWrapper";

        const h = Math.floor(val / 3600);
        const m = Math.floor((val % 3600) / 60);
        const timeDisplay = h > 0 ? `${h}h ${m}m` : `${m}m`;

        wrapper.innerHTML = `
          <div class="bar" style="height: ${height}%">
            <span class="barValue">${timeDisplay}</span>
          </div>
        `;
        barChart.appendChild(wrapper);

        const lbl = document.createElement("div");
        lbl.className = "barLabel";
        lbl.textContent = labels[i];
        barLabels.appendChild(lbl);
      });

      // Update Summary
      const hTotal = Math.floor(totalTime / 3600);
      const mTotal = Math.floor((totalTime % 3600) / 60);
      chartTotalTime.textContent = `${hTotal}h ${mTotal}m`;

      statTotalCount.textContent = sessions.length;

      const avg = totalTime / data.length;
      const mAvg = Math.floor(avg / 60);
      statDailyAvg.textContent = `${mAvg}m`;

      const best = Math.max(...data);
      const hBest = Math.floor(best / 3600);
      const mBest = Math.floor((best % 3600) / 60);
      statBestDay.textContent = best > 0 ? `${hBest}h ${mBest}m` : "-";
    }

    // Initial render
    renderAnalyticsChart(currentChartRange);

    // Update refreshHistory to include calendar
    function refreshHistory() {
      const totalSec = calcTotalSeconds(selectedRange);
      totalEl.textContent = formatHHMMSS(totalSec);
      updateRing(totalSec);
      renderCalendar();
      if (selectedDateStr) showDayDetails(selectedDateStr);
    }

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

  } catch (e) {
    console.error(e);
    const s = document.getElementById("status");
    if (s) s.textContent = "Error: " + e.message;
  }
});
