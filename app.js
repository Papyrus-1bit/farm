// ПДД-Тренажёр — теория (билеты, темы, экзамен) для РФ и РБ.

(function () {
  "use strict";

  const LS_REGION = "pdd.region.v1";
  const LS_PROGRESS = "pdd.progress.v1";
  const LS_EXAM_HISTORY = "pdd.examHistory.v1";
  const LS_UI = "pdd.ui.v1";
  const LS_ACTIVE_SESSION = "pdd.activeSession.v1";
  const LS_CUSTOM_BANK = "pdd.customBank.v1";
  const LS_MISTAKES = "pdd.mistakes.v1";

  const DEFAULT_UI = { theme: "dark", font: "system", fontSize: 14, compact: true };

  let bank = [];
  let manifest = null;
  let region = loadRegion();
  let progress = loadProgress();
  let examHistory = loadExamHistory();
  let mistakes = loadMistakes();
  let uiSettings = loadUiSettings();
  let activeQuiz = null;
  let examTimer = null;

  const $ = (id) => document.getElementById(id);
  const bound = new Set();
  const on = (id, evt, fn) => {
    const el = $(id);
    if (!el) return false;
    const key = `${id}:${evt}`;
    if (bound.has(key)) return true;
    el.addEventListener(evt, fn);
    bound.add(key);
    return true;
  };

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function loadRegion() {
    try {
      const r = JSON.parse(localStorage.getItem(LS_REGION) || "null");
      if (r && r.country) return r;
    } catch (e) {}
    return { country: "ru", category: "ab" };
  }

  function saveRegion() {
    localStorage.setItem(LS_REGION, JSON.stringify(region));
  }

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(LS_PROGRESS, JSON.stringify(progress));
  }

  function loadExamHistory() {
    try {
      return JSON.parse(localStorage.getItem(LS_EXAM_HISTORY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveExamHistory() {
    localStorage.setItem(LS_EXAM_HISTORY, JSON.stringify(examHistory));
  }

  function loadMistakes() {
    try {
      return JSON.parse(localStorage.getItem(LS_MISTAKES) || "{}");
    } catch {
      return {};
    }
  }

  function saveMistakes() {
    localStorage.setItem(LS_MISTAKES, JSON.stringify(mistakes));
  }

  function recordMistake(q) {
    const id = q.id;
    const m = mistakes[id] || { weight: 0, count: 0, lastWrong: 0, topic: q.topic || "" };
    m.weight = Math.min(24, m.weight + 4);
    m.count++;
    m.lastWrong = Date.now();
    m.topic = q.topic || m.topic;
    mistakes[id] = m;
    saveMistakes();
  }

  function recordMistakeResolved(q) {
    const m = mistakes[q.id];
    if (!m) return;
    m.weight = Math.max(0, m.weight - 3);
    if (m.weight <= 0) delete mistakes[q.id];
    saveMistakes();
  }

  function mistakePoolSize() {
    return Object.keys(mistakes).length;
  }

  function pickWeightedMistakes(count) {
    const entries = Object.entries(mistakes)
      .map(([id, m]) => ({ id, m, q: bank.find((x) => x.id === id) }))
      .filter((e) => e.q);
    if (!entries.length) return [];
    const picked = [];
    const used = new Set();
    for (let n = 0; n < count && entries.length; n++) {
      const pool = entries.filter((e) => !used.has(e.id));
      if (!pool.length) break;
      const total = pool.reduce((s, e) => s + e.m.weight, 0);
      let r = Math.random() * total;
      let chosen = pool[0];
      for (const e of pool) {
        r -= e.m.weight;
        if (r <= 0) { chosen = e; break; }
      }
      picked.push(shuffleQuestionOptions(chosen.q));
      used.add(chosen.id);
    }
    return picked;
  }

  function loadUiSettings() {
    try {
      return normalizeUiSettings(JSON.parse(localStorage.getItem(LS_UI)) || {});
    } catch (e) {
      return { ...DEFAULT_UI };
    }
  }

  function saveUiSettings() {
    localStorage.setItem(LS_UI, JSON.stringify(uiSettings));
  }

  function normalizeUiSettings(raw) {
    const next = { ...DEFAULT_UI, ...(raw || {}) };
    if (!["dark", "light", "sepia", "contrast"].includes(next.theme)) next.theme = DEFAULT_UI.theme;
    if (!["system", "serif", "dyslexic", "mono"].includes(next.font)) next.font = DEFAULT_UI.font;
    next.fontSize = Math.min(18, Math.max(12, parseInt(next.fontSize, 10) || DEFAULT_UI.fontSize));
    next.compact = !!next.compact;
    return next;
  }

  function applyUiSettings() {
    document.body.dataset.theme = uiSettings.theme;
    document.body.dataset.font = uiSettings.font;
    document.body.classList.toggle("compact", !!uiSettings.compact);
    document.documentElement.style.fontSize = uiSettings.fontSize + "px";
  }

  // ---------------------------------------------------------------------------
  // Bank loading
  // ---------------------------------------------------------------------------

  function bankFileId() {
    if (region.country === "by") return "pdd-by-ab";
    return region.category === "cd" ? "pdd-ru-cd" : "pdd-ru-ab";
  }

  async function loadBank() {
    const status = $("bank-status");
    if (status) {
      status.textContent = "Загрузка…";
      status.className = "badge badge-due";
    }

    try {
      const custom = localStorage.getItem(LS_CUSTOM_BANK);
      if (custom) {
        const parsed = JSON.parse(custom);
        bank = parsed.questions || [];
        manifest = parsed.manifest || { questionCount: bank.length, exam: { count: 20, minutes: 20, maxErrors: 2 } };
      } else {
        const res = await fetch(`data/${bankFileId()}.json`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        bank = data.questions || [];
        manifest = data.manifest || null;
      }
      if (status) {
        status.textContent = `${bank.length} вопросов`;
        status.className = "badge badge-new";
      }
      refreshSelectors();
      updateExamIntro();
      renderReviewIntro();
      if (activeQuiz) activeQuiz = null;
      restoreSavedSession();
      window.dispatchEvent(new CustomEvent("pdd:bank-loaded", { detail: bank.length }));
      return bank.length;
    } catch (err) {
      if (status) {
        status.textContent = "Ошибка загрузки";
        status.className = "badge";
      }
      console.error(err);
      return 0;
    }
  }

  function examRules() {
    const m = manifest?.exam || {};
    if (region.country === "by") {
      return {
        count: 10,
        minutes: m.minutes || 20,
        maxErrors: 1,
        extraOn1Error: 0,
        extraOn2Errors: 0,
        hideFeedbackDuringExam: true,
      };
    }
    return {
      count: 20,
      minutes: m.minutes || 20,
      maxErrors: 2,
      extraOn1Error: 5,
      extraOn2Errors: 10,
      hideFeedbackDuringExam: true,
      ...m,
    };
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function shuffleQuestionOptions(q) {
    const originalCorrect = new Set(q.correct);
    const shuffled = shuffle(q.options.map((text, originalIdx) => ({ text, originalIdx })));
    return {
      ...q,
      options: shuffled.map((x) => x.text),
      correct: shuffled
        .map((x, i) => (originalCorrect.has(x.originalIdx) ? i : null))
        .filter((i) => i !== null),
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderRichText(s) {
    return escapeHtml(s).replace(/\n/g, "<br>");
  }

  function topics() {
    const set = new Set();
    for (const q of bank) set.add(q.topic || "Разное");
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function ticketNumbers() {
    const set = new Set();
    for (const q of bank) if (q.ticket) set.add(q.ticket);
    return [...set].sort((a, b) => a - b);
  }

  function byTopic(topic) {
    if (topic === "__all__") return bank.slice();
    return bank.filter((q) => q.topic === topic);
  }

  function byTicket(num) {
    return bank
      .filter((q) => q.ticket === num)
      .sort((a, b) => (a.ticketIndex || 0) - (b.ticketIndex || 0));
  }

  function recordAttempt(q, isCorrect, mode) {
    const st = progress[q.id] || { attempts: 0, correct: 0, wrong: 0, last: 0, lastMode: "" };
    st.attempts++;
    if (isCorrect) st.correct++;
    else st.wrong++;
    st.last = Date.now();
    st.lastMode = mode;
    progress[q.id] = st;
    saveProgress();
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function imageHtml(q) {
    if (!q.image) return "";
    return `<div class="q-image"><img src="${escapeHtml(q.image)}" alt="Иллюстрация к вопросу" loading="lazy" /></div>`;
  }

  function explanationHtml(q) {
    if (!q.explanation) return "";
    return `<div class="explanation"><strong>Пояснение:</strong> ${renderRichText(q.explanation)}</div>`;
  }

  function keyboardHintHtml() {
    return '<div class="kbd-hint">Клавиши: <kbd>1</kbd>–<kbd>3</kbd> или <kbd>A</kbd>–<kbd>Г</kbd> — ответ, <kbd>Enter</kbd> — дальше</div>';
  }

  function mobileActionBarHtml(buttons) {
    if (!buttons.length) return "";
    const btns = buttons
      .map((b) => `<button class="mob-btn${b.primary ? " primary" : ""}" data-action="${b.action}"${b.disabled ? " disabled" : ""}>${escapeHtml(b.label)}</button>`)
      .join("");
    return `<div class="mobile-action-bar">${btns}</div>`;
  }

  function bindMobileActions(stage) {
    stage.querySelectorAll(".mobile-action-bar [data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const target = stage.querySelector(`#${action}, [id="${action}"]`);
        if (target && !target.disabled) target.click();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const VIEW_TITLES = {
    tickets: "Билеты",
    topics: "Темы",
    exam: "Экзамен",
    review: "Разбор ошибок",
    handbook: "Справочник",
    stats: "Статистика",
    settings: "Настройки",
  };

  function switchView(view) {
    if (!view) return;
    const target = document.getElementById("view-" + view);
    if (!target) {
      console.warn("Unknown view:", view);
      return;
    }

    document.querySelectorAll(".nav-item, .bn-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    target.classList.remove("hidden");

    const titleEl = $("view-title");
    if (titleEl) titleEl.textContent = VIEW_TITLES[view] || view;

    if (view === "stats") renderStats();
    if (view === "handbook") renderHandbook();
    if (view === "review") renderReviewIntro();
    document.getElementById("sidebar")?.classList.remove("open");
  }

  function bindNav() {
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-item, .bn-item");
      if (!btn?.dataset.view) return;
      e.preventDefault();
      switchView(btn.dataset.view);
    });
  }
  bindNav();

  $("sidebar-toggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
  });

  // ---------------------------------------------------------------------------
  // Region
  // ---------------------------------------------------------------------------

  function syncRegionControls() {
    const country = $("region-country");
    const category = $("region-category");
    const wrap = $("region-category-wrap");
    if (!country || !category || !wrap) return;
    country.value = region.country;
    category.value = region.category;
    wrap.style.display = region.country === "ru" ? "" : "none";
    const ticketWrap = $("ticket-select-wrap");
    if (ticketWrap) ticketWrap.style.display = ticketNumbers().length ? "" : "none";
  }

  async function onRegionCountryChange() {
    const country = $("region-country");
    if (!country) return;
    region.country = country.value;
    if (region.country === "by") region.category = "ab";
    saveRegion();
    syncRegionControls();
    localStorage.removeItem(LS_CUSTOM_BANK);
    clearSavedSession();
    await loadBank();
  }

  async function onRegionCategoryChange() {
    const category = $("region-category");
    if (!category) return;
    region.category = category.value;
    saveRegion();
    localStorage.removeItem(LS_CUSTOM_BANK);
    clearSavedSession();
    await loadBank();
  }

  // ---------------------------------------------------------------------------
  // Selectors
  // ---------------------------------------------------------------------------

  function refreshSelectors() {
    syncRegionControls();
    const ticketSel = $("ticket-number");
    if (!ticketSel) return;
    const nums = ticketNumbers();
    ticketSel.innerHTML = nums.map((n) => `<option value="${n}">Билет ${n}</option>`).join("");
    if (!nums.length) ticketSel.innerHTML = '<option value="">—</option>';

    const topicSel = $("topic-select");
    if (!topicSel) return;
    const ts = topics();
    topicSel.innerHTML = ts.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    if (ts.length) renderTopicIntro();
  }

  function renderTopicIntro() {
    const topicSel = $("topic-select");
    if (!topicSel) return;
    const pool = byTopic(topicSel.value);
    const total = $("topic-total");
    if (total) total.textContent = `В теме: ${pool.length}`;
    if (!activeQuiz || activeQuiz.mode !== "topic") {
      const stage = $("topic-stage");
      if (stage) stage.innerHTML = '<div class="empty-hint">Тренировка по разделам ПДД с мгновенной проверкой и пояснением.</div>';
    }
  }

  function updateExamIntro() {
    const rules = examRules();
    const extraHint = region.country === "ru" ? " · при 1 ошибке +5 вопросов, при 2 — +10" : "";
    const rulesEl = $("exam-rules");
    if (rulesEl) rulesEl.textContent = `${rules.count} вопросов${extraHint}`;
    const timeEl = $("exam-time");
    if (timeEl) timeEl.textContent = `${rules.minutes} минут`;
    const errEl = $("exam-errors");
    if (errEl) errEl.textContent = region.country === "by" ? "максимум 1 ошибка" : `максимум ${rules.maxErrors} ошибки`;
    if (!activeQuiz || activeQuiz.mode !== "exam") {
      const stage = $("exam-stage");
      if (stage) {
        stage.innerHTML =
          `<div class="empty-hint" id="exam-intro-text">Режим экзамена: ${rules.count} вопросов, ${rules.minutes} мин. ` +
          `Во время экзамена не показывается, верен ответ или нет. Результат и пояснения — после завершения.</div>`;
      }
    }
  }

  function onTicketStart() {
    const num = parseInt($("ticket-number").value, 10);
    const items = byTicket(num);
    if (!items.length) {
      $("ticket-stage").innerHTML = '<div class="empty-hint">Билеты недоступны для выбранного банка (например, демо-банк Беларуси).</div>';
      return;
    }
    startPracticeQuiz("ticket", items.map(shuffleQuestionOptions), $("ticket-stage"));
  }

  function onTopicStart() {
    const pool = byTopic($("topic-select").value);
    if (!pool.length) return;
    const cv = $("topic-count").value;
    const n = cv === "all" ? pool.length : Math.min(parseInt(cv, 10), pool.length);
    startPracticeQuiz("topic", shuffle(pool).slice(0, n).map(shuffleQuestionOptions), $("topic-stage"));
  }

  function setStatus(el, cls, msg) {
    if (!el) return;
    el.className = "status " + cls;
    el.textContent = msg;
  }

  function onImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const questions = Array.isArray(data) ? data : data.questions;
        if (!Array.isArray(questions)) throw new Error("Нет массива questions");
        localStorage.setItem(LS_CUSTOM_BANK, JSON.stringify({ questions, manifest: data.manifest || null }));
        setStatus($("import-status"), "ok", `Импортировано ${questions.length} вопросов`);
        await loadBank();
      } catch (err) {
        setStatus($("import-status"), "err", err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  function onExportProgress() {
    const blob = new Blob([JSON.stringify({ version: 1, progress, examHistory, region }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pdd-progress.json";
    a.click();
  }

  function onImportProgressFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.progress) progress = { ...progress, ...data.progress };
        if (data.examHistory) examHistory = data.examHistory.concat(examHistory);
        saveProgress();
        saveExamHistory();
        setStatus($("progress-status"), "ok", "Прогресс импортирован");
      } catch (err) {
        setStatus($("progress-status"), "err", err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  function onResetProgress() {
    if (!confirm("Сбросить всю статистику?")) return;
    progress = {};
    examHistory = [];
    mistakes = {};
    saveProgress();
    saveExamHistory();
    saveMistakes();
    setStatus($("progress-status"), "ok", "Статистика сброшена");
    renderReviewIntro();
  }

  async function onResetBank() {
    if (!confirm("Вернуть встроенный банк?")) return;
    localStorage.removeItem(LS_CUSTOM_BANK);
    await loadBank();
    setStatus($("import-status"), "ok", "Встроенный банк восстановлен");
  }

  function setupDom() {
    on("topic-select", "change", renderTopicIntro);
    on("ticket-start", "click", onTicketStart);
    on("topic-start", "click", onTopicStart);
    on("review-start", "click", onReviewStart);
    on("exam-start", "click", startExam);
    on("region-country", "change", () => { void onRegionCountryChange(); });
    on("region-category", "change", () => { void onRegionCategoryChange(); });
    on("import-file", "change", onImportFile);
    on("export-progress", "click", onExportProgress);
    on("import-progress", "click", () => $("progress-file")?.click());
    on("progress-file", "change", onImportProgressFile);
    on("reset-progress", "click", onResetProgress);
    on("reset-bank", "click", () => { void onResetBank(); });
    on("ui-theme", "change", () => updateUiSettings({ theme: $("ui-theme").value }));
    on("ui-font", "change", () => updateUiSettings({ font: $("ui-font").value }));
    on("ui-font-size", "input", () => updateUiSettings({ fontSize: parseInt($("ui-font-size").value, 10) }));
    on("ui-compact", "change", () => updateUiSettings({ compact: $("ui-compact").checked }));
    on("ui-reset", "click", () => updateUiSettings({ ...DEFAULT_UI }));
    bindHandbookUi();
  }

  async function remount() {
    setupDom();
    syncRegionControls();
    syncUiControls();
    applyUiSettings();
    if (bank.length) {
      refreshSelectors();
      updateExamIntro();
      const status = $("bank-status");
      if (status) {
        status.textContent = `${bank.length} вопросов`;
        status.className = "badge badge-new";
      }
    } else {
      await loadBank();
    }
    return bank.length;
  }

  function startPracticeQuiz(mode, items, stage) {
    clearExamTimer();
    clearSavedSession();
    activeQuiz = {
      mode,
      items,
      idx: 0,
      correctCount: 0,
      answers: new Array(items.length).fill(null),
      flags: mode === "ticket" || mode === "review" ? new Array(items.length).fill(false) : [],
      stage,
      awaitingNext: false,
    };
    if (mode === "ticket" || mode === "review") drawNavPracticeQuestion();
    else drawTopicQuestion();
  }

  function firstUnanswered(quiz) {
    for (let i = 0; i < quiz.items.length; i++) {
      if (!quiz.answers[i]) return i;
    }
    return -1;
  }

  function practiceNavHtml(quiz) {
    return quiz.items
      .map((_, i) => {
        const a = quiz.answers[i];
        let cls = "enav";
        if (i === quiz.idx) cls += " current";
        if (quiz.flags[i]) cls += " flagged";
        if (a) cls += a.isCorrect ? " ok" : " bad";
        else cls += " unanswered";
        return `<button type="button" class="${cls}" data-goto="${i}">${i + 1}</button>`;
      })
      .join("");
  }

  function drawNavPracticeQuestion() {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const sel = quiz.answers[quiz.idx];
    const pct = Math.round(((quiz.idx + 1) / quiz.items.length) * 100);
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const optsHtml = q.options
      .map((opt, i) => {
        let cls = "opt";
        if (sel) {
          if (q.correct.includes(i)) cls += " correct";
          if (sel.choiceIdx === i && !sel.isCorrect) cls += " wrong";
        }
        return `<button type="button" class="${cls}" data-i="${i}"${sel ? " disabled" : ""}><span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt)}</span></button>`;
      })
      .join("");

    const modeLabel =
      quiz.mode === "review"
        ? "Разбор ошибок"
        : quiz.mode === "ticket"
          ? `Билет ${q.ticket || ""}`
          : escapeHtml(q.topic);

    const answered = quiz.answers.filter(Boolean).length;
    const wrong = quiz.answers.filter((a) => a && !a.isCorrect).length;

    quiz.stage.innerHTML =
      `<div class="quiz-progress"><span>Вопрос ${quiz.idx + 1} из ${quiz.items.length}</span>` +
      `<span class="bar"><span style="width:${pct}%"></span></span>` +
      `<span>Отв: ${answered} · ✓ ${quiz.correctCount}${wrong ? ` · ✗ ${wrong}` : ""}</span></div>` +
      '<div class="exam-workspace"><div class="qcard exam-question-card">' +
      `<div class="fc-head"><span class="fc-topic">${modeLabel}</span></div>` +
      imageHtml(q) +
      `<div class="q-text">${renderRichText(q.q)}</div>` +
      `<div class="options">${optsHtml}</div>` +
      (sel ? explanationHtml(q) : "") +
      '<div class="exam-actions">' +
      `<button type="button" class="btn" id="practice-prev" ${quiz.idx > 0 ? "" : "disabled"}>Назад</button>` +
      `<button type="button" class="btn" id="practice-flag">${quiz.flags[quiz.idx] ? "Снять флажок" : "Флажок"}</button>` +
      `<button type="button" class="btn" id="practice-next">Вперёд</button>` +
      '<button type="button" class="btn btn-primary" id="practice-finish">Завершить</button></div>' +
      "</div>" +
      `<div class="exam-nav-panel"><div class="exam-nav-head"><b>Навигация</b><span>можно пропускать и вернуться</span></div>` +
      `<div class="exam-nav-grid">${practiceNavHtml(quiz)}</div></div></div>` +
      mobileActionBarHtml([
        { action: "practice-prev", label: "Назад", disabled: quiz.idx <= 0 },
        { action: "practice-flag", label: quiz.flags[quiz.idx] ? "Снять" : "Флажок" },
        { action: "practice-next", label: "Вперёд" },
        { action: "practice-finish", label: "Завершить", primary: true },
      ]);

    quiz.stage.querySelectorAll(".opt:not([disabled])").forEach((b) => {
      b.addEventListener("click", () => answerNavPractice(parseInt(b.dataset.i, 10)));
    });
    quiz.stage.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => {
        quiz.idx = parseInt(b.dataset.goto, 10);
        drawNavPracticeQuestion();
      });
    });
    $("practice-prev")?.addEventListener("click", () => { if (quiz.idx > 0) { quiz.idx--; drawNavPracticeQuestion(); } });
    $("practice-next")?.addEventListener("click", () => practiceGoNext());
    $("practice-flag")?.addEventListener("click", () => { quiz.flags[quiz.idx] = !quiz.flags[quiz.idx]; drawNavPracticeQuestion(); });
    $("practice-finish")?.addEventListener("click", () => tryFinishNavPractice());
    bindMobileActions(quiz.stage);
    saveActiveSession();
  }

  function answerNavPractice(choiceIdx) {
    const quiz = activeQuiz;
    if (quiz.answers[quiz.idx]) return;
    const q = quiz.items[quiz.idx];
    const isCorrect = q.correct.includes(choiceIdx);
    if (isCorrect) quiz.correctCount++;
    quiz.answers[quiz.idx] = { q, choiceIdx, isCorrect };
    recordAttempt(q, isCorrect, quiz.mode);
    if (isCorrect && quiz.mode === "review") recordMistakeResolved(q);
    else if (!isCorrect) recordMistake(q);
    drawNavPracticeQuestion();
  }

  function practiceGoNext() {
    const quiz = activeQuiz;
    if (quiz.idx < quiz.items.length - 1) {
      quiz.idx++;
      drawNavPracticeQuestion();
      return;
    }
    const u = firstUnanswered(quiz);
    if (u >= 0) {
      quiz.idx = u;
      drawNavPracticeQuestion();
    } else {
      tryFinishNavPractice();
    }
  }

  function tryFinishNavPractice() {
    const quiz = activeQuiz;
    const u = firstUnanswered(quiz);
    if (u >= 0) {
      quiz.idx = u;
      drawNavPracticeQuestion();
      return;
    }
    finishPractice();
  }

  function drawTopicQuestion() {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const pct = Math.round((quiz.idx / quiz.items.length) * 100);
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const optsHtml = q.options
      .map((opt, i) => `<button type="button" class="opt" data-i="${i}"><span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt)}</span></button>`)
      .join("");

    quiz.stage.innerHTML =
      `<div class="quiz-progress"><span>Вопрос ${quiz.idx + 1} из ${quiz.items.length}</span>` +
      `<span class="bar"><span style="width:${pct}%"></span></span><span>Верно: ${quiz.correctCount}</span></div>` +
      '<div class="qcard">' +
      `<div class="fc-head"><span class="fc-topic">${escapeHtml(q.topic)}</span></div>` +
      imageHtml(q) +
      `<div class="q-text">${renderRichText(q.q)}</div>` +
      `<div class="options">${optsHtml}</div>` +
      keyboardHintHtml() +
      '<div id="q-feedback"></div></div>';

    quiz.stage.querySelectorAll(".opt").forEach((b) => {
      b.addEventListener("click", () => answerTopic(parseInt(b.dataset.i, 10)));
    });
    if (quiz.awaitingNext) renderTopicFeedback();
    saveActiveSession();
  }

  function answerTopic(choiceIdx) {
    const quiz = activeQuiz;
    if (quiz.awaitingNext) return;
    const q = quiz.items[quiz.idx];
    const isCorrect = q.correct.includes(choiceIdx);
    if (isCorrect) quiz.correctCount++;
    quiz.answers[quiz.idx] = { q, choiceIdx, isCorrect };
    recordAttempt(q, isCorrect, quiz.mode);
    if (!isCorrect) recordMistake(q);
    quiz.awaitingNext = true;
    renderTopicFeedback();
    saveActiveSession();
  }

  function renderTopicFeedback() {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const answer = quiz.answers[quiz.idx];
    quiz.stage.querySelectorAll(".opt").forEach((b, i) => {
      b.disabled = true;
      if (q.correct.includes(i)) b.classList.add("correct");
      if (i === answer.choiceIdx && !answer.isCorrect) b.classList.add("wrong");
    });
    const last = quiz.idx >= quiz.items.length - 1;
    const fb = document.getElementById("q-feedback");
    fb.innerHTML =
      explanationHtml(q) +
      '<div class="quiz-foot"><button type="button" class="btn btn-primary" id="q-next">' +
      (last ? "Завершить" : "Дальше") +
      "</button></div>" +
      mobileActionBarHtml([{ action: "q-next", label: last ? "Завершить" : "Дальше", primary: true }]);
    document.getElementById("q-next").addEventListener("click", () => {
      if (last) return finishPractice();
      quiz.idx++;
      quiz.awaitingNext = false;
      drawTopicQuestion();
    });
    bindMobileActions(quiz.stage);
  }

  function finishPractice() {
    const quiz = activeQuiz;
    const total = quiz.items.length;
    const pct = total ? Math.round((quiz.correctCount / total) * 100) : 0;
    const wrong = quiz.answers.filter((a) => a && !a.isCorrect).length;
    let title = "Тренировка завершена";
    if (quiz.mode === "ticket") title = "Билет пройден";
    if (quiz.mode === "review") title = "Разбор завершён";

    let wrongBlock = "";
    if (wrong > 0) {
      wrongBlock =
        '<div class="review-block"><h4>Ошибки</h4>' +
        quiz.answers
          .map((a, i) => {
            if (!a || a.isCorrect) return "";
            const q = quiz.items[i];
            return (
              '<div class="review-item">' +
              `<div class="review-head"><b>${i + 1}.</b> ✗ ${renderRichText(q.q)}</div>` +
              imageHtml(q) +
              explanationHtml(q) +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }

    quiz.stage.innerHTML =
      '<div class="result-card">' +
      `<h3>${title}</h3>` +
      `<div class="stat-num">${quiz.correctCount} / ${total}</div>` +
      `<p class="muted">Точность: ${pct}% · ошибок: ${wrong} · в разборе: ${mistakePoolSize()}</p>` +
      wrongBlock +
      '<button type="button" class="btn btn-primary" id="practice-restart">Ещё раз</button></div>';
    document.getElementById("practice-restart").addEventListener("click", () => {
      activeQuiz = null;
      clearSavedSession();
      if (quiz.mode === "ticket") $("ticket-start").click();
      else if (quiz.mode === "review") $("review-start").click();
      else $("topic-start").click();
    });
    activeQuiz = null;
    clearSavedSession();
    renderReviewIntro();
  }

  function renderReviewIntro() {
    const el = $("review-intro");
    const badge = $("review-pool-size");
    const n = mistakePoolSize();
    if (badge) badge.textContent = String(n);
    if (el) {
      el.textContent = n
        ? `В очереди ${n} вопросов с ошибками. Чем чаще ошибались — тем выше шанс попасть в сессию.`
        : "Пока нет ошибок. Пройдите билеты или экзамен — неправильные ответы попадут сюда.";
    }
  }

  function onReviewStart() {
    const cv = $("review-count")?.value || "20";
    const n = cv === "all" ? 999 : parseInt(cv, 10);
    const items = pickWeightedMistakes(n);
    if (!items.length) {
      alert("Нет вопросов для разбора. Ошибайтесь в билетах или экзамене — они попадут сюда.");
      return;
    }
    startPracticeQuiz("review", items, $("review-stage"));
  }

  // ---------------------------------------------------------------------------
  // Exam
  // ---------------------------------------------------------------------------

  function buildExamQuestions() {
    const rules = examRules();

    if (region.country === "by") {
      const tickets = ticketNumbers();
      if (tickets.length) {
        const t = tickets[Math.floor(Math.random() * tickets.length)];
        const items = byTicket(t);
        if (items.length) return items.slice(0, rules.count).map(shuffleQuestionOptions);
      }
      return shuffle(bank).slice(0, Math.min(rules.count, bank.length)).map(shuffleQuestionOptions);
    }

    const byT = {};
    for (const q of bank) {
      if (!q.ticket) continue;
      if (!byT[q.ticket]) byT[q.ticket] = [];
      byT[q.ticket].push(q);
    }
    const ticketNums = Object.keys(byT).map(Number);
    if (ticketNums.length >= 4) {
      const picked = shuffle(ticketNums).slice(0, 4);
      const items = [];
      for (let b = 0; b < 4; b++) {
        const qs = byT[picked[b]].sort((a, x) => (a.ticketIndex || 0) - (x.ticketIndex || 0));
        items.push(...qs.slice(b * 5, b * 5 + 5));
      }
      if (items.length === rules.count) return items.map(shuffleQuestionOptions);
    }
    return shuffle(bank).slice(0, Math.min(rules.count, bank.length)).map(shuffleQuestionOptions);
  }

  function startExam() {
    if (!bank.length) return;
    clearSavedSession();
    const rules = examRules();
    const items = buildExamQuestions();
    activeQuiz = {
      mode: "exam",
      items,
      idx: 0,
      answers: new Array(items.length).fill(null),
      flags: new Array(items.length).fill(false),
      stage: $("exam-stage"),
      startedAt: Date.now(),
      timeLimitMs: rules.minutes * 60 * 1000,
      baseCount: rules.count,
      phase: "base",
      extraAppended: false,
    };
    startExamTimer();
    drawExamQuestion();
  }

  function countAnswered(quiz, from, to) {
    let n = 0;
    for (let i = from; i < to; i++) if (quiz.answers[i]) n++;
    return n;
  }

  function countWrong(quiz, from, to) {
    let n = 0;
    for (let i = from; i < to; i++) {
      const a = quiz.answers[i];
      if (a && !a.isCorrect) n++;
    }
    return n;
  }

  function pickExtraQuestions(quiz, count) {
    const used = new Set(quiz.items.map((q) => q.id));
    const pool = bank.filter((q) => !used.has(q.id));
    return shuffle(pool).slice(0, count).map(shuffleQuestionOptions);
  }

  function appendExtraQuestions(quiz, count) {
    if (!count) return false;
    const extras = pickExtraQuestions(quiz, count);
    if (!extras.length) return false;
    quiz.items.push(...extras);
    quiz.answers.push(...new Array(extras.length).fill(null));
    quiz.flags.push(...new Array(extras.length).fill(false));
    quiz.extraAppended = true;
    quiz.phase = "extra";
    quiz.idx = quiz.baseCount;
    return true;
  }

  function tryFinishExam(timeout) {
    const quiz = activeQuiz;
    const rules = examRules();

    if (!timeout && countAnswered(quiz, 0, quiz.baseCount) < quiz.baseCount) {
      alert(`Ответьте на все ${quiz.baseCount} вопросов основного блока.`);
      return;
    }

    const baseWrong = countWrong(quiz, 0, quiz.baseCount);

    if (baseWrong > rules.maxErrors) {
      finishExam(timeout, "fail");
      return;
    }

    if (!quiz.extraAppended && baseWrong > 0) {
      const extraCount = baseWrong === 1 ? rules.extraOn1Error : rules.extraOn2Errors;
      if (extraCount > 0) {
        appendExtraQuestions(quiz, extraCount);
        drawExamQuestion();
        return;
      }
    }

    if (quiz.extraAppended) {
      const extraFrom = quiz.baseCount;
      const extraTo = quiz.items.length;
      if (!timeout && countAnswered(quiz, extraFrom, extraTo) < extraTo - extraFrom) {
        alert("Ответьте на все дополнительные вопросы.");
        return;
      }
      const extraWrong = countWrong(quiz, extraFrom, extraTo);
      finishExam(timeout, extraWrong === 0 ? "pass" : "fail");
      return;
    }

    finishExam(timeout, baseWrong <= rules.maxErrors ? "pass" : "fail");
  }

  function startExamTimer() {
    clearExamTimer();
    examTimer = setInterval(() => {
      if (!activeQuiz || activeQuiz.mode !== "exam") return clearExamTimer();
      if (remainingExamMs() <= 0) tryFinishExam(true);
      else updateExamTimer();
    }, 250);
  }

  function clearExamTimer() {
    if (examTimer) clearInterval(examTimer);
    examTimer = null;
  }

  function remainingExamMs() {
    if (!activeQuiz?.startedAt) return 0;
    return activeQuiz.timeLimitMs - (Date.now() - activeQuiz.startedAt);
  }

  function updateExamTimer() {
    const el = document.getElementById("exam-timer");
    if (el) el.textContent = formatTime(remainingExamMs());
  }

  function drawExamQuestion() {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const pct = Math.round(((quiz.idx + 1) / quiz.items.length) * 100);
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const sel = quiz.answers[quiz.idx];
    const optsHtml = q.options
      .map((opt, i) => {
        const chosen = sel && sel.choiceIdx === i;
        return `<button class="opt${chosen ? " chosen" : ""}" data-i="${i}"><span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt)}</span></button>`;
      })
      .join("");

    const phaseLabel =
      quiz.phase === "extra"
        ? ` · доп. ${quiz.idx + 1 - quiz.baseCount}/${quiz.items.length - quiz.baseCount}`
        : "";

    const nav = quiz.items
      .map((_, i) => {
        const a = quiz.answers[i];
        let cls = "enav";
        if (i === quiz.idx) cls += " current";
        if (quiz.flags[i]) cls += " flagged";
        if (a) cls += " answered";
        if (i >= quiz.baseCount) cls += " extra";
        return `<button type="button" class="${cls}" data-goto="${i}">${i + 1}</button>`;
      })
      .join("");

    quiz.stage.innerHTML =
      `<div class="quiz-progress"><span>Вопрос ${quiz.idx + 1} из ${quiz.items.length}${phaseLabel}</span>` +
      `<span class="bar"><span style="width:${pct}%"></span></span>` +
      `<span class="timer">Осталось: <b id="exam-timer">${formatTime(remainingExamMs())}</b></span></div>` +
      '<div class="exam-workspace"><div class="qcard exam-question-card">' +
      `<div class="fc-head"><span class="fc-topic">${escapeHtml(q.topic)}</span></div>` +
      imageHtml(q) +
      `<div class="q-text">${renderRichText(q.q)}</div>` +
      `<div class="options">${optsHtml}</div>` +
      '<div class="exam-actions">' +
      `<button class="btn" id="exam-prev" ${quiz.idx > 0 ? "" : "disabled"}>Назад</button>` +
      `<button class="btn" id="exam-flag">${quiz.flags[quiz.idx] ? "Снять флажок" : "Флажок"}</button>` +
      `<button class="btn" id="exam-next">Вперёд</button>` +
      '<button class="btn btn-primary" id="exam-finish">Завершить</button></div>' +
      "</div>" +
      `<div class="exam-nav">${nav}</div></div>` +
      mobileActionBarHtml([
        { action: "exam-prev", label: "Назад", disabled: quiz.idx <= 0 },
        { action: "exam-flag", label: quiz.flags[quiz.idx] ? "Снять" : "Флажок" },
        { action: "exam-next", label: "Вперёд" },
        { action: "exam-finish", label: "Завершить", primary: true },
      ]);

    quiz.stage.querySelectorAll(".opt").forEach((b) => {
      b.addEventListener("click", () => answerExam(parseInt(b.dataset.i, 10)));
    });
    quiz.stage.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => {
        quiz.idx = parseInt(b.dataset.goto, 10);
        drawExamQuestion();
      });
    });
    $("exam-prev")?.addEventListener("click", () => { if (quiz.idx > 0) { quiz.idx--; drawExamQuestion(); } });
    $("exam-next")?.addEventListener("click", () => examGoNext());
    $("exam-flag")?.addEventListener("click", () => { quiz.flags[quiz.idx] = !quiz.flags[quiz.idx]; drawExamQuestion(); });
    $("exam-finish")?.addEventListener("click", () => tryFinishExam(false));
    bindMobileActions(quiz.stage);
    updateExamTimer();
    saveActiveSession();
  }

  function answerExam(choiceIdx) {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const isCorrect = q.correct.includes(choiceIdx);
    quiz.answers[quiz.idx] = { q, choiceIdx, isCorrect };
    if (!isCorrect) recordMistake(q);
    examGoNext(true);
  }

  function examGoNext(fromAnswer) {
    const quiz = activeQuiz;
    if (quiz.idx < quiz.items.length - 1) {
      quiz.idx++;
      drawExamQuestion();
      return;
    }
    const u = firstUnanswered(quiz);
    if (u >= 0) {
      quiz.idx = u;
      drawExamQuestion();
      return;
    }
    if (!fromAnswer) tryFinishExam(false);
  }

  function finishExam(timeout, outcome) {
    const quiz = activeQuiz;
    if (!quiz) return;
    clearExamTimer();
    const rules = examRules();
    const answered = quiz.answers.filter(Boolean);
    const wrong = answered.filter((a) => !a.isCorrect).length;
    const correct = answered.filter((a) => a.isCorrect).length;
    const baseWrong = countWrong(quiz, 0, quiz.baseCount);
    const passed = outcome === "pass" && !timeout;

    examHistory.unshift({
      at: Date.now(),
      country: region.country,
      category: region.category,
      total: quiz.items.length,
      baseCount: quiz.baseCount,
      correct,
      wrong,
      baseWrong,
      passed,
      timeout: !!timeout,
      hadExtras: !!quiz.extraAppended,
    });
    saveExamHistory();

    let title = "Не сдано";
    if (timeout) title = "Время вышло";
    else if (passed) title = "Сдано ✓";
    else if (baseWrong > rules.maxErrors) title = "Слишком много ошибок в основном блоке";
    else if (quiz.extraAppended) title = "Ошибки в дополнительных вопросах";

    let html =
      '<div class="result-card">' +
      `<h3>${title}</h3>` +
      `<div class="stat-num">${correct} / ${quiz.items.length}</div>` +
      `<p class="muted">Ошибок всего: ${wrong} · в основном блоке: ${baseWrong}` +
      (quiz.extraAppended ? ` · доп. вопросов: ${quiz.items.length - quiz.baseCount}` : "") +
      "</p>";

    if (!passed) {
      html += '<div class="review-block"><h4>Разбор ошибок</h4>';
      quiz.items.forEach((q, i) => {
        const a = quiz.answers[i];
        if (!a || a.isCorrect) return;
        const tag = i >= quiz.baseCount ? " (доп.)" : "";
        html +=
          '<div class="review-item">' +
          `<div class="review-head"><b>${i + 1}${tag}.</b> ✗ ${renderRichText(q.q)}</div>` +
          `<p class="muted">Ваш ответ: ${renderRichText(q.options[a.choiceIdx] || "—")}</p>` +
          `<p class="muted">Верно: ${a.q.correct.map((c) => renderRichText(q.options[c])).join(", ")}</p>` +
          imageHtml(q) +
          explanationHtml(q) +
          "</div>";
      });
      html += "</div>";
    } else {
      html += '<p class="muted">Экзамен сдан. Подробный разбор доступен только при неудаче — как на реальном экзамене.</p>';
    }

    html += '<button type="button" class="btn btn-primary" id="exam-restart">Новый экзамен</button></div>';
    quiz.stage.innerHTML = html;
    document.getElementById("exam-restart").addEventListener("click", startExam);
    activeQuiz = null;
    clearSavedSession();
    renderReviewIntro();
  }

  // ---------------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------------

  function clearSavedSession() {
    localStorage.removeItem(LS_ACTIVE_SESSION);
  }

  function saveActiveSession() {
    if (!activeQuiz) return;
    try {
      const payload = {
        region,
        mode: activeQuiz.mode,
        idx: activeQuiz.idx,
        correctCount: activeQuiz.correctCount,
        awaitingNext: activeQuiz.awaitingNext,
        itemIds: activeQuiz.items.map((q) => q.id),
        answers: activeQuiz.answers?.map((a) => (a ? { id: a.q.id, choiceIdx: a.choiceIdx, isCorrect: a.isCorrect } : null)),
        flags: activeQuiz.flags,
        startedAt: activeQuiz.startedAt,
        timeLimitMs: activeQuiz.timeLimitMs,
        baseCount: activeQuiz.baseCount,
        phase: activeQuiz.phase,
        extraAppended: activeQuiz.extraAppended,
      };
      localStorage.setItem(LS_ACTIVE_SESSION, JSON.stringify(payload));
    } catch (e) {}
  }

  function restoreSavedSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ACTIVE_SESSION) || "null");
      if (!saved || saved.region?.country !== region.country || saved.region?.category !== region.category) return;
      const items = saved.itemIds.map((id) => bank.find((q) => q.id === id)).filter(Boolean);
      if (!items.length) return;

      const stage =
        saved.mode === "exam"
          ? $("exam-stage")
          : saved.mode === "ticket"
            ? $("ticket-stage")
            : saved.mode === "review"
              ? $("review-stage")
              : $("topic-stage");
      const answersArr = saved.answers?.length
        ? saved.answers.map((a, i) => (a ? { q: items[i], choiceIdx: a.choiceIdx, isCorrect: a.isCorrect } : null))
        : new Array(items.length).fill(null);
      activeQuiz = {
        mode: saved.mode,
        items,
        idx: saved.idx || 0,
        correctCount: saved.correctCount || answersArr.filter((a) => a?.isCorrect).length,
        awaitingNext: !!saved.awaitingNext,
        answers: answersArr,
        flags: saved.flags || [],
        stage,
        startedAt: saved.startedAt,
        timeLimitMs: saved.timeLimitMs,
        baseCount: saved.baseCount,
        phase: saved.phase,
        extraAppended: saved.extraAppended,
      };
      if (saved.mode === "exam") {
        startExamTimer();
        drawExamQuestion();
      } else if (saved.mode === "ticket" || saved.mode === "review") {
        drawNavPracticeQuestion();
      } else {
        drawTopicQuestion();
      }
      const tab =
        saved.mode === "exam"
          ? "exam"
          : saved.mode === "ticket"
            ? "tickets"
            : saved.mode === "review"
              ? "review"
              : "topics";
      switchView(tab);
    } catch (e) {}
  }

  window.addEventListener("beforeunload", saveActiveSession);

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  function renderStats() {
    let attempted = 0, correct = 0, totalAttempts = 0;
    for (const q of bank) {
      const st = progress[q.id];
      if (!st?.attempts) continue;
      attempted++;
      totalAttempts += st.attempts;
      correct += st.correct || 0;
    }
    const accuracy = totalAttempts ? Math.round((correct / totalAttempts) * 100) : 0;
    $("stats-cards").innerHTML = [
      ["Вопросов в банке", bank.length],
      ["Встречались", attempted],
      ["Попыток", totalAttempts],
      ["Точность", accuracy + "%"],
      ["Экзаменов", examHistory.length],
      ["В разборе", mistakePoolSize()],
    ]
      .map(([lbl, num]) => `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`)
      .join("");

    $("exam-history").innerHTML = examHistory.length
      ? examHistory
          .slice(0, 30)
          .map((h) => {
            const d = new Date(h.at).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            return `<div class="history-row"><span class="history-date">${d}</span><span class="history-score">${h.correct}/${h.total}</span><span class="history-status ${h.passed ? "ok" : "bad"}">${h.passed ? "Сдан" : h.timeout ? "Время" : "Не сдан"}</span></div>`;
          })
          .join("")
      : '<div class="empty-hint compact">Пока нет экзаменов.</div>';

    $("topic-table").innerHTML = topics()
      .map((t) => {
        const qs = bank.filter((q) => q.topic === t);
        const done = qs.filter((q) => progress[q.id]?.attempts).length;
        const pct = qs.length ? Math.round((done / qs.length) * 100) : 0;
        return `<div class="topic-row"><div class="name">${escapeHtml(t)}</div><div class="count">${done}/${qs.length}</div><div class="progress-bar"><span style="width:${pct}%"></span></div></div>`;
      })
      .join("");
  }

  // ---------------------------------------------------------------------------
  // Settings / import
  // ---------------------------------------------------------------------------

  function syncUiControls() {
    if (!$("ui-theme")) return;
    $("ui-theme").value = uiSettings.theme;
    $("ui-font").value = uiSettings.font;
    $("ui-font-size").value = uiSettings.fontSize;
    $("ui-font-size-value").textContent = uiSettings.fontSize;
    $("ui-compact").checked = !!uiSettings.compact;
  }

  function updateUiSettings(patch) {
    uiSettings = normalizeUiSettings({ ...uiSettings, ...patch });
    saveUiSettings();
    applyUiSettings();
    syncUiControls();
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    const stage = activeQuiz?.stage;
    if (!stage) return;
    const key = e.key.toLowerCase();
    if (/^[1-4]$/.test(key)) {
      const idx = parseInt(key, 10) - 1;
      const opt = stage.querySelectorAll(".opt:not(:disabled)")[idx];
      if (opt) { opt.click(); e.preventDefault(); }
      return;
    }
    const map = { a: 0, b: 1, c: 2, d: 3, а: 0, б: 1, в: 2, г: 3 };
    if (map[key] !== undefined) {
      const opt = stage.querySelectorAll(".opt:not(:disabled)")[map[key]];
      if (opt) { opt.click(); e.preventDefault(); }
      return;
    }
    if (["Enter", " ", "n"].includes(key)) {
      const next = stage.querySelector("#q-next, #exam-next:not(:disabled), #practice-next:not(:disabled)");
      if (next) { next.click(); e.preventDefault(); }
    }
  });

  // ---------------------------------------------------------------------------
  // Handbook (справочник ПДД)
  // ---------------------------------------------------------------------------

  let handbookData = null;
  let handbookRulesIndex = null;
  const handbookChapterCache = new Map();
  let handbookTab = "rules";
  let handbookChapter = 1;

  async function loadHandbook() {
    if (handbookData) return handbookData;
    const res = await fetch("data/pdd-ref/index.json");
    handbookData = await res.json();
    return handbookData;
  }

  async function loadRulesIndex() {
    if (handbookRulesIndex) return handbookRulesIndex;
    const res = await fetch("data/pdd-ref/rules/index.json");
    handbookRulesIndex = await res.json();
    return handbookRulesIndex;
  }

  async function loadRulesChapter(num) {
    if (handbookChapterCache.has(num)) return handbookChapterCache.get(num);
    const res = await fetch(`data/pdd-ref/rules/chapters/${num}.json`);
    const data = await res.json();
    handbookChapterCache.set(num, data);
    return data;
  }

  function setHandbookTab(tab) {
    handbookTab = tab;
    document.querySelectorAll(".htab").forEach((b) => {
      b.classList.toggle("active", b.dataset.htab === tab);
    });
    $("handbook-toolbar")?.classList.toggle("tab-rules", tab === "rules");
    void renderHandbook();
  }

  function syncHandbookChapterSelect() {
    const sel = $("handbook-chapter");
    if (!sel || !handbookRulesIndex) return;
    if (!sel.options.length) {
      sel.innerHTML = handbookRulesIndex.chapters
        .map((c) => `<option value="${c.num}">${escapeHtml(c.title)}</option>`)
        .join("");
    }
    sel.value = String(handbookChapter);
  }

  function handbookFoot(data) {
    const url = data?.pddRulesUrl || data?.source || "https://avto-russia.ru/pdd/pdd_rf.html";
    return (
      `<p class="muted handbook-foot">Источник: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">ПДД РФ на avto-russia.ru</a> · ` +
      `действуют с 01.01.2026</p>`
    );
  }

  async function renderHandbookRules() {
    const host = $("handbook-content");
    const q = ($("handbook-search")?.value || "").trim().toLowerCase();

    try {
      const index = await loadRulesIndex();
      syncHandbookChapterSelect();

      if (q) {
        const codeM = q.match(/^(\d{1,2})\.(\d+(?:\.\d+)?)/);
        if (codeM) handbookChapter = parseInt(codeM[1], 10);
        else {
          const hit = index.chapters.find(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.codes.some((code) => code.startsWith(q) || code.includes(q))
          );
          if (hit) handbookChapter = hit.num;
        }
        syncHandbookChapterSelect();
      }

      const chapter = await loadRulesChapter(handbookChapter);
      let blocks = chapter.blocks;
      let globalHits = null;

      if (q) {
        blocks = blocks.filter(
          (b) =>
            b.code.includes(q) ||
            b.text.toLowerCase().includes(q) ||
            chapter.title.toLowerCase().includes(q)
        );
        if (!blocks.length) {
          globalHits = [];
          for (const c of index.chapters) {
            const ch = await loadRulesChapter(c.num);
            for (const b of ch.blocks) {
              if (
                b.code.includes(q) ||
                b.text.toLowerCase().includes(q) ||
                ch.title.toLowerCase().includes(q)
              ) {
                globalHits.push({ chapter: ch, block: b });
              }
            }
          }
        }
      }

      const nav = index.chapters
        .map(
          (c) =>
            `<button type="button" class="pdd-chap-link${c.num === handbookChapter ? " active" : ""}" data-chap="${c.num}">${c.num}</button>`
        )
        .join("");

      const body = globalHits
        ? globalHits.length
          ? globalHits
              .slice(0, 40)
              .map(
                ({ chapter: ch, block: b }) =>
                  `<article class="pdd-block pdd-hit">` +
                  `<div class="pdd-hit-meta"><button type="button" class="pdd-hit-link" data-chap="${ch.num}">${escapeHtml(ch.title)}</button>` +
                  (b.code ? ` · <span class="ref-code">${escapeHtml(b.code)}</span>` : "") +
                  `</div><div class="pdd-block-body">${b.html}</div></article>`
              )
              .join("") +
            (globalHits.length > 40 ? `<p class="muted">Показаны первые 40 из ${globalHits.length} совпадений</p>` : "")
          : '<div class="empty-hint compact">Ничего не найдено</div>'
        : blocks.length
          ? blocks
              .map(
                (b) =>
                  `<article class="pdd-block" id="pdd-${escapeHtml(b.code || chapter.num)}">` +
                  `<div class="pdd-block-body">${b.html}</div></article>`
              )
              .join("")
          : '<div class="empty-hint compact">Ничего не найдено в этой главе</div>';

      host.innerHTML =
        (globalHits ? `<p class="muted pdd-search-note">Поиск по всем главам: «${escapeHtml(q)}»</p>` : "") +
        `<div class="pdd-chapter-nav">${nav}</div>` +
        (globalHits ? "" : `<h2 class="pdd-chapter-title">${escapeHtml(chapter.title)}</h2>`) +
        `<div class="pdd-chapter-body">${body}</div>` +
        handbookFoot(index);

      host.querySelectorAll(".pdd-hit-link").forEach((b) => {
        b.addEventListener("click", () => {
          handbookChapter = parseInt(b.dataset.chap, 10);
          $("handbook-chapter").value = String(handbookChapter);
          $("handbook-search").value = q;
          void renderHandbookRules();
        });
      });

      host.querySelectorAll(".pdd-chap-link").forEach((b) => {
        b.addEventListener("click", () => {
          handbookChapter = parseInt(b.dataset.chap, 10);
          $("handbook-chapter").value = String(handbookChapter);
          void renderHandbookRules();
        });
      });
      host.querySelectorAll(".pdd-ref[data-chapter]").forEach((el) => {
        el.addEventListener("click", () => {
          handbookTab = "rules";
          handbookChapter = parseInt(el.dataset.chapter, 10);
          setHandbookTab("rules");
        });
      });

      if (q && blocks[0]?.code) {
        const anchor = host.querySelector(`#pdd-${CSS.escape(blocks[0].code)}`);
        anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      host.innerHTML =
        '<div class="empty-hint">Текст ПДД не загружен. Запустите: <code>node scripts/scrape-pdd-rules.mjs</code></div>';
      console.error(e);
    }
  }

  function refImageHtml(it) {
    const png = `data/pdd-ref/${it.image}`;
    if (it.kind === "sign") {
      const svg = `assets/svg/gost/${it.code}.svg`;
      return (
        `<img src="${escapeHtml(svg)}" alt="${escapeHtml(it.code)}" loading="lazy" ` +
        `data-fallback="${escapeHtml(png)}" class="ref-img" ` +
        `onerror="if(this.dataset.fallback&&!this.dataset.tried){this.dataset.tried=1;this.src=this.dataset.fallback}" />`
      );
    }
    return `<img src="${escapeHtml(png)}" alt="${escapeHtml(it.code)}" loading="lazy" class="ref-img" />`;
  }

  async function renderHandbookRefs(kindFilter) {
    const host = $("handbook-content");
    try {
      const data = await loadHandbook();
      const q = ($("handbook-search")?.value || "").trim().toLowerCase();
      const sections = data.sections
        .filter((sec) => !kindFilter || sec.kind === kindFilter)
        .map((sec) => {
          const items = sec.items.filter((it) => {
            if (!q) return true;
            return (
              it.code.includes(q) ||
              it.name.toLowerCase().includes(q) ||
              (it.desc || "").toLowerCase().includes(q)
            );
          });
          if (!items.length) return "";
          const cards = items
            .map(
              (it) =>
                `<article class="ref-card" id="ref-${escapeHtml(it.id)}">` +
                refImageHtml(it) +
                `<div class="ref-body"><div class="ref-code">${escapeHtml(it.code)}</div>` +
                `<h4>${escapeHtml(it.name)}</h4>` +
                `<p class="muted">${escapeHtml(it.desc || "").replace(/\n/g, "<br>")}</p></div></article>`
            )
            .join("");
          return (
            `<section class="ref-section"><h3 class="section-title">${escapeHtml(sec.title)}</h3>` +
            `<div class="ref-grid">${cards}</div></section>`
          );
        })
        .filter(Boolean)
        .join("");

      host.innerHTML =
        (sections || '<div class="empty-hint compact">Ничего не найдено</div>') +
        handbookFoot(data);
    } catch (e) {
      host.innerHTML =
        '<div class="empty-hint">Справочник не загружен. Запустите: <code>npm run scrape-ref</code></div>';
      console.error(e);
    }
  }

  async function renderHandbook() {
    const host = $("handbook-content");
    if (!host) return;
    host.innerHTML = '<div class="empty-hint compact">Загрузка справочника…</div>';
    if (handbookTab === "rules") await renderHandbookRules();
    else if (handbookTab === "signs") await renderHandbookRefs("sign");
    else await renderHandbookRefs("marking");
  }

  function bindHandbookUi() {
    document.getElementById("handbook-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".htab");
      if (!btn?.dataset.htab) return;
      setHandbookTab(btn.dataset.htab);
    });
    on("handbook-chapter", "change", () => {
      handbookChapter = parseInt($("handbook-chapter")?.value || "1", 10);
      void renderHandbookRules();
    });
    on("handbook-search", "input", () => { void renderHandbook(); });
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  window.PDD = {
    getTopics: () => topics(),
    isReady: () => bank.length > 0,
    remount,
    byTicket: (num) => byTicket(Number(num)),
    getQuestion: (id) => bank.find((q) => q.id === id) || null,
    pickQuestion(topic) {
      const pool = this.pickQuestionForTopic(topic);
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    },
    pickQuestionForTopic(topic) {
      if (!topic) return bank.slice(0, 0);
      let pool = byTopic(topic);
      if (pool.length) return pool;
      const t = String(topic).toLowerCase();
      pool = bank.filter((q) =>
        String(q.topic || "").toLowerCase().includes(t) ||
        (q.topics || []).some((x) => String(x).toLowerCase().includes(t))
      );
      return pool;
    },
    getRegion: () => ({ ...region }),
  };

  function initApp() {
    setupDom();
    syncRegionControls();
    syncUiControls();
    applyUiSettings();
    void loadBank();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
