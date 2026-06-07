// Фарм-Тренажёр — тесты по блокам и контрольный экзамен.
// Работает без сборки, банк и прогресс хранятся локально в браузере.

(function () {
  "use strict";

  const LS_BANK = "farm.bank.v1";
  const LS_PROGRESS = "farm.progress.v2";
  const LS_EXAM_HISTORY = "farm.examHistory.v1";
  const LS_UI = "farm.ui.v1";
  const PASS_THRESHOLD = 0.7;
  const EXAM_COUNT = 80;
  const EXAM_MINUTES = 60;
  const INFINITE_POOL_SIZE = 50;
  const DEFAULT_UI = {
    theme: "dark",
    font: "system",
    fontSize: 16,
    compact: false,
  };

  const hadStoredBank = !!localStorage.getItem(LS_BANK);
  let bank = loadBank();
  let progress = loadProgress(); // { [id]: { attempts, correct, wrong, last, lastMode } }
  let examHistory = loadExamHistory();
  let explanationsMap = {};
  let activeQuiz = null;
  let infiniteSession = null;
  let examTimer = null;
  let uiSettings = loadUiSettings();

  function loadBank() {
    try {
      const raw = localStorage.getItem(LS_BANK);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) {}
    return SEED_BANK.slice();
  }

  function saveBank() {
    localStorage.setItem(LS_BANK, JSON.stringify(bank));
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(LS_PROGRESS) || localStorage.getItem("farm.progress.v1");
      if (raw) return normalizeProgress(JSON.parse(raw) || {});
    } catch (e) {}
    return {};
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
    next.fontSize = Math.min(22, Math.max(14, parseInt(next.fontSize, 10) || DEFAULT_UI.fontSize));
    next.compact = !!next.compact;
    return next;
  }

  function applyUiSettings() {
    uiSettings = normalizeUiSettings(uiSettings);

    document.body.dataset.theme = uiSettings.theme;
    document.body.dataset.font = uiSettings.font;
    document.body.classList.toggle("compact", !!uiSettings.compact);
    document.documentElement.style.fontSize = uiSettings.fontSize + "px";
    document.documentElement.style.setProperty("--font-size-base", "1rem");
    document.documentElement.style.setProperty("--quiz-font-size", "1.12rem");
  }

  applyUiSettings();

  function normalizeProgress(raw) {
    const out = {};
    for (const [id, st] of Object.entries(raw || {})) {
      if (typeof st.attempts === "number") {
        out[id] = ensureProgressState(st);
      } else if (typeof st.seen === "number") {
        // Миграция со старой SRS-структуры: считаем seen как попытки.
        out[id] = ensureProgressState({
          attempts: st.seen || 0,
          correct: Math.max(0, st.reps || 0),
          wrong: st.lapses || 0,
          last: st.due || 0,
          lastMode: "cards",
        });
      }
    }
    return out;
  }

  function ensureProgressState(st) {
    return {
      attempts: st.attempts || 0,
      correct: st.correct || 0,
      wrong: st.wrong || 0,
      last: st.last || 0,
      lastMode: st.lastMode || "",
      correctStreak: st.correctStreak || 0,
      wrongStreak: st.wrongStreak || 0,
    };
  }

  function saveProgress() {
    localStorage.setItem(LS_PROGRESS, JSON.stringify(progress));
  }

  function loadExamHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_EXAM_HISTORY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((item) => item && typeof item.date === "number")
        .map((item) => ({
          id: item.id || "exam-" + item.date,
          date: item.date,
          durationMs: Math.max(0, item.durationMs || 0),
          correct: item.correct || 0,
          total: item.total || EXAM_COUNT,
          score: item.score || 0,
          passed: !!item.passed,
          timeout: !!item.timeout,
        }))
        .sort((a, b) => a.date - b.date);
    } catch (e) {
      return [];
    }
  }

  function saveExamHistory() {
    localStorage.setItem(LS_EXAM_HISTORY, JSON.stringify(examHistory));
  }

  function recordExamAttempt(quiz, timeout, correct, total, ratio, passed) {
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - (quiz.startedAt || finishedAt));
    examHistory.push({
      id: "exam-" + finishedAt,
      date: finishedAt,
      durationMs,
      correct,
      total,
      score: Math.round(ratio * 100),
      passed,
      timeout: !!timeout,
    });
    examHistory = examHistory.slice(-200);
    saveExamHistory();
    return durationMs;
  }

  function recordAttempt(q, isCorrect, mode) {
    const st = ensureProgressState(progress[q.id] || {});
    st.attempts += 1;
    if (isCorrect) {
      st.correct += 1;
      st.correctStreak += 1;
      st.wrongStreak = 0;
    } else {
      st.wrong += 1;
      st.correctStreak = 0;
      st.wrongStreak += 1;
    }
    st.last = Date.now();
    st.lastMode = mode;
    progress[q.id] = st;
    saveProgress();
  }

  function applyExplanations() {
    if (!explanationsMap) return;
    for (const q of bank) {
      if (!q.explanation && explanationsMap[q.id]) q.explanation = explanationsMap[q.id];
    }
  }

  function topics() {
    return Array.from(new Set(bank.map((q) => q.topic))).sort();
  }

  function byTopic(topic, onlyHard) {
    let pool = topic === "__all__" ? bank.slice() : bank.filter((q) => q.topic === topic);
    if (onlyHard) pool = pool.filter((q) => q.hard);
    return pool;
  }

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
    const shuffledOptions = shuffle(q.options.map((text, originalIdx) => ({ text, originalIdx })));

    return {
      ...q,
      options: shuffledOptions.map((item) => item.text),
      correct: shuffledOptions
        .map((item, shuffledIdx) => originalCorrect.has(item.originalIdx) ? shuffledIdx : null)
        .filter((idx) => idx !== null),
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // Лёгкая визуализация LaTeX-подобных фрагментов без внешних библиотек.
  // Поддерживает степени/индексы и частые медицинско-химические символы.
  function renderRichText(s, withLineBreaks) {
    let out = escapeHtml(s)
      .replace(/\\\((.*?)\\\)/g, "$1")
      .replace(/\\\[(.*?)\\\]/g, "$1")
      .replace(/\$([^$]{1,180})\$/g, "$1");

    const commands = {
      "\\degree": "°",
      "\\deg": "°",
      "\\circ": "°",
      "\\times": "×",
      "\\cdot": "·",
      "\\pm": "±",
      "\\le": "≤",
      "\\leq": "≤",
      "\\ge": "≥",
      "\\geq": "≥",
      "\\neq": "≠",
      "\\to": "→",
      "\\rightarrow": "→",
      "\\leftarrow": "←",
      "\\alpha": "α",
      "\\beta": "β",
      "\\gamma": "γ",
      "\\delta": "δ",
      "\\Delta": "Δ",
      "\\mu": "μ",
      "\\lambda": "λ",
      "\\omega": "ω",
      "\\Omega": "Ω",
    };
    for (const [cmd, symbol] of Object.entries(commands)) {
      out = out.split(cmd).join(symbol);
    }

    out = out
      .replace(/\^\{([^{}<>]{1,40})\}/g, "<sup>$1</sup>")
      .replace(/_\{([^{}<>]{1,40})\}/g, "<sub>$1</sub>")
      .replace(/\^([0-9A-Za-z+\-−°])/g, "<sup>$1</sup>")
      .replace(/_([0-9A-Za-z+\-−])/g, "<sub>$1</sub>");

    out = autoFormatChemicalFormulas(out);
    if (withLineBreaks) out = out.replace(/\n/g, "<br>");
    return out;
  }

  function autoFormatChemicalFormulas(html) {
    return html.replace(/(^|[^A-Za-zА-Яа-я0-9_>])([A-Za-zА-Яа-я]{1,3}(?:[0-9]+|[A-Za-zА-Яа-я][0-9]*){1,5})(?=$|[^A-Za-zА-Яа-я0-9_<])/g, (m, prefix, token) => {
      const formatted = formatChemicalFormulaToken(token);
      return formatted ? prefix + formatted : m;
    });
  }

  function formatChemicalFormulaToken(token) {
    const normalized = token
      .replace(/[Сс]/g, "C")
      .replace(/[Нн]/g, "H")
      .replace(/[Оо]/g, "O")
      .replace(/[Рр]/g, "P")
      .replace(/[Кк]/g, "K")
      .replace(/[Аа]/g, "A")
      .replace(/[Вв]/g, "B")
      .replace(/[Ее]/g, "E")
      .replace(/[Мм]/g, "M")
      .replace(/[Тт]/g, "T")
      .replace(/[Хх]/g, "X");
    if (!/[0-9]/.test(normalized) && !/^(zno|cuo|cao|bao|mgo|hcl|hbr|hi|hf|no|co)$/i.test(normalized)) return "";

    const elements = new Set([
      "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
      "K", "Ca", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Br", "I", "Ba", "Hg", "Pb", "Ag", "Au", "Bi"
    ]);
    let i = 0;
    let result = "";
    let elementCount = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (/[0-9]/.test(ch)) {
        let j = i + 1;
        while (j < normalized.length && /[0-9]/.test(normalized[j])) j++;
        result += `<sub>${normalized.slice(i, j)}</sub>`;
        i = j;
        continue;
      }
      if (!/[A-Za-z]/.test(ch)) return "";
      const two = normalized.slice(i, i + 2);
      const one = normalized.slice(i, i + 1);
      const twoCanon = two.charAt(0).toUpperCase() + two.charAt(1).toLowerCase();
      const oneCanon = one.toUpperCase();
      if (two.length === 2 && elements.has(twoCanon)) {
        result += twoCanon;
        i += 2;
        elementCount++;
      } else if (elements.has(oneCanon)) {
        result += oneCanon;
        i += 1;
        elementCount++;
      } else {
        return "";
      }
    }
    return elementCount >= 2 || /<sub>/.test(result) ? `<span class="chem-formula">${result}</span>` : "";
  }

  function escExpl(s) {
    return renderRichText(s, true);
  }

  function answerText(q) {
    return q.correct.map((i) => q.options[i]).filter(Boolean).join("; ");
  }

  function hardBadge(q) {
    return q.hard ? '<span class="hard-badge">Сложный</span>' : "";
  }

  function shortQuestion(q) {
    return String(q).replace(/\s+/g, " ").trim().slice(0, 90);
  }

  function keyboardHintHtml() {
    return '<div class="kbd-hint">Клавиши: 1–6 или A–F — ответ, Enter/Space — дальше</div>';
  }

  function explanationHtml(q, compact) {
    if (q.explanation) {
      return `<div class="q-expl"><span class="lbl">Пояснение:</span>${escExpl(q.explanation)}</div>`;
    }
    const answer = answerText(q);
    const brief = compact
      ? `Правильный ответ: ${answer}.`
      : `Правильный ответ: ${answer}. Для этого вопроса пока нет развернутого разбора.`;
    return `<div class="q-expl brief"><span class="lbl">Кратко:</span>${renderRichText(brief, false)}</div>`;
  }

  function fillTopicSelect(sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="__all__">Все блоки</option>' +
      topics().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function download(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function validateBank(arr) {
    const out = [];
    arr.forEach((q, i) => {
      if (!q || typeof q.q !== "string" || !Array.isArray(q.options) || !Array.isArray(q.correct)) {
        throw new Error(`вопрос #${i + 1} имеет неверный формат`);
      }
      out.push({
        id: q.id != null ? String(q.id) : "imp-" + i + "-" + Math.random().toString(36).slice(2, 7),
        topic: q.topic ? String(q.topic) : "Без темы",
        q: q.q,
        options: q.options.map(String),
        correct: q.correct.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)),
        explanation: q.explanation ? String(q.explanation) : "",
        hard: !!q.hard,
      });
    });
    if (!out.length) throw new Error("банк пуст");
    return out;
  }

  // ====================================================================
  // Навигация
  // ====================================================================
  const tabsEl = document.getElementById("tabs");
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-" + view).classList.remove("hidden");
    if (view === "blocks") renderBlockIntro();
    if (view === "infinite") renderInfiniteIntro();
    if (view === "exam") renderExamIntro();
    if (view === "stats") renderStats();
  });

  // ====================================================================
  // Тест по блокам
  // ====================================================================
  const blockTopic = document.getElementById("block-topic");
  const blockHard = document.getElementById("block-hard");
  const blockCount = document.getElementById("block-count");
  const blockStage = document.getElementById("block-stage");
  document.getElementById("block-start").addEventListener("click", startBlockQuiz);
  blockTopic.addEventListener("change", renderBlockIntro);
  blockHard.addEventListener("change", renderBlockIntro);

  function renderBlockIntro() {
    fillTopicSelect(blockTopic);
    const pool = byTopic(blockTopic.value || "__all__", blockHard.checked);
    document.getElementById("block-total").textContent = `В выбранном блоке: ${pool.length}`;
    if (!activeQuiz || activeQuiz.mode !== "block") {
      blockStage.innerHTML = '<div class="empty-hint">Выберите блок и нажмите «Начать тест». Ответы проверяются сразу, с кратким пояснением.</div>';
    }
  }

  function startBlockQuiz() {
    clearExamTimer();
    infiniteSession = null;
    const pool = byTopic(blockTopic.value || "__all__", blockHard.checked);
    if (!pool.length) {
      blockStage.innerHTML = '<div class="empty-hint">Нет вопросов под выбранные условия.</div>';
      return;
    }
    const countValue = blockCount.value;
    const n = countValue === "all" ? pool.length : Math.min(parseInt(countValue, 10), pool.length);
    activeQuiz = {
      mode: "block",
      items: shuffle(pool).slice(0, n).map(shuffleQuestionOptions),
      idx: 0,
      correctCount: 0,
      answers: [],
      stage: blockStage,
    };
    drawQuestion();
  }

  // ====================================================================
  // Бесконечный режим
  // ====================================================================
  const infiniteTopic = document.getElementById("infinite-topic");
  const infiniteHard = document.getElementById("infinite-hard");
  const infiniteStage = document.getElementById("infinite-stage");
  const infinitePoolBadge = document.getElementById("infinite-pool");
  const infiniteMasteredBadge = document.getElementById("infinite-mastered");
  document.getElementById("infinite-start").addEventListener("click", startInfinite);
  infiniteTopic.addEventListener("change", renderInfiniteIntro);
  infiniteHard.addEventListener("change", renderInfiniteIntro);

  function isMastered(q) {
    const st = ensureProgressState(progress[q.id] || {});
    return st.correctStreak >= 3;
  }

  function infiniteWeight(q) {
    const st = ensureProgressState(progress[q.id] || {});
    if (st.correctStreak >= 3) return 0;

    // Ошибка должна заметно повышать шанс появления, но без бесконечного разгона.
    const wrongBoost = Math.min(12, st.wrongStreak * 4 + st.wrong * 0.35);
    const correctMultiplier = st.correctStreak === 2 ? 0.2 : st.correctStreak === 1 ? 0.55 : 1;
    return Math.max(0, (1 + wrongBoost) * correctMultiplier);
  }

  function infiniteSourcePool() {
    return byTopic(infiniteTopic.value || "__all__", infiniteHard.checked);
  }

  function eligibleInfiniteQuestions() {
    return infiniteSourcePool().filter((q) => infiniteWeight(q) > 0);
  }

  function renderInfiniteIntro() {
    fillTopicSelect(infiniteTopic);
    const source = infiniteSourcePool();
    const mastered = source.filter(isMastered).length;
    const eligible = source.length - mastered;
    infinitePoolBadge.textContent = "Пул: 0/" + Math.min(INFINITE_POOL_SIZE, eligible);
    infiniteMasteredBadge.textContent = "Освоено: " + mastered;
    if (!infiniteSession) {
      infiniteStage.innerHTML =
        '<div class="empty-hint">Будет создан активный пул из 50 вопросов. Ошибки повышают вес появления, 3 правильных ответа подряд дают 0% и убирают вопрос из показа.</div>';
    }
  }

  function startInfinite() {
    clearExamTimer();
    activeQuiz = null;
    const eligible = eligibleInfiniteQuestions();
    if (!eligible.length) {
      infiniteStage.innerHTML = '<div class="empty-hint">Нет доступных вопросов: выбранный блок полностью освоен или пуст.</div>';
      return;
    }
    infiniteSession = {
      poolIds: [],
      current: null,
      answered: 0,
      correct: 0,
    };
    refillInfinitePool();
    drawInfiniteQuestion();
  }

  function refillInfinitePool() {
    if (!infiniteSession) return;
    const existing = new Set(infiniteSession.poolIds);
    const candidates = shuffle(eligibleInfiniteQuestions().filter((q) => !existing.has(q.id)));
    while (infiniteSession.poolIds.length < INFINITE_POOL_SIZE && candidates.length) {
      infiniteSession.poolIds.push(candidates.pop().id);
    }
    updateInfiniteBadges();
  }

  function updateInfiniteBadges() {
    const source = infiniteSourcePool();
    const mastered = source.filter(isMastered).length;
    const maxPool = Math.min(INFINITE_POOL_SIZE, Math.max(0, source.length - mastered));
    infinitePoolBadge.textContent = `Пул: ${infiniteSession ? infiniteSession.poolIds.length : 0}/${maxPool}`;
    infiniteMasteredBadge.textContent = `Освоено: ${mastered}`;
  }

  function weightedPick(items) {
    const weighted = items.map((q) => ({ q, w: infiniteWeight(q) })).filter((x) => x.w > 0);
    const total = weighted.reduce((sum, x) => sum + x.w, 0);
    if (!weighted.length || total <= 0) return null;
    let roll = Math.random() * total;
    for (const item of weighted) {
      roll -= item.w;
      if (roll <= 0) return item.q;
    }
    return weighted[weighted.length - 1].q;
  }

  function drawInfiniteQuestion() {
    refillInfinitePool();
    const pool = infiniteSession.poolIds
      .map((id) => bank.find((q) => q.id === id))
      .filter((q) => q && infiniteWeight(q) > 0);
    infiniteSession.poolIds = pool.map((q) => q.id);
    refillInfinitePool();

    const currentPool = infiniteSession.poolIds
      .map((id) => bank.find((q) => q.id === id))
      .filter((q) => q && infiniteWeight(q) > 0);
    const q = weightedPick(currentPool);
    if (!q) {
      infiniteStage.innerHTML = '<div class="empty-hint">Все вопросы в выбранном блоке освоены: у них 0% вероятности появления.</div>';
      updateInfiniteBadges();
      return;
    }
    infiniteSession.current = shuffleQuestionOptions(q);
    const st = ensureProgressState(progress[q.id] || {});
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const optsHtml = infiniteSession.current.options.map((opt, i) =>
      `<button class="opt" data-i="${i}"><span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt, false)}</span></button>`
    ).join("");
    infiniteStage.innerHTML =
      `<div class="quiz-progress"><span>Бесконечный режим</span>` +
        `<span class="bar"><span style="width:${Math.min(100, (st.correctStreak / 3) * 100)}%"></span></span>` +
        `<span>Вес: ${infiniteWeight(q).toFixed(1)} · подряд: ${st.correctStreak}/3</span></div>` +
      '<div class="qcard">' +
        `<div class="fc-head"><span class="fc-topic">${escapeHtml(infiniteSession.current.topic)}</span>${hardBadge(infiniteSession.current)}</div>` +
        `<div class="q-text">${renderRichText(infiniteSession.current.q, false)}</div>` +
        `<div class="options">${optsHtml}</div>` +
        keyboardHintHtml() +
        '<div id="infinite-feedback"></div>' +
      "</div>";
    infiniteStage.querySelectorAll(".opt").forEach((b) => {
      b.addEventListener("click", () => answerInfinite(parseInt(b.dataset.i, 10)));
    });
    updateInfiniteBadges();
  }

  function answerInfinite(choiceIdx) {
    const q = infiniteSession.current;
    const isCorrect = q.correct.includes(choiceIdx);
    infiniteSession.answered++;
    if (isCorrect) infiniteSession.correct++;
    recordAttempt(q, isCorrect, "infinite");

    const opts = infiniteStage.querySelectorAll(".opt");
    opts.forEach((b, i) => {
      b.disabled = true;
      if (q.correct.includes(i)) b.classList.add("correct");
      if (i === choiceIdx && !isCorrect) b.classList.add("wrong");
    });

    if (isMastered(q)) {
      infiniteSession.poolIds = infiniteSession.poolIds.filter((id) => id !== q.id);
    }
    refillInfinitePool();
    const st = ensureProgressState(progress[q.id] || {});
    document.getElementById("infinite-feedback").innerHTML =
      explanationHtml(q, false) +
      `<div class="quiz-foot"><span class="muted">Ответов: ${infiniteSession.answered} · Верно: ${infiniteSession.correct} · Подряд по этому вопросу: ${st.correctStreak}/3</span>` +
      '<button class="btn btn-primary" id="infinite-next">Следующий вопрос</button></div>';
    document.getElementById("infinite-next").addEventListener("click", drawInfiniteQuestion);
    updateInfiniteBadges();
  }

  // ====================================================================
  // Контрольный экзамен
  // ====================================================================
  const examStage = document.getElementById("exam-stage");
  document.getElementById("exam-start").addEventListener("click", startExam);

  function renderExamIntro() {
    if (!activeQuiz || activeQuiz.mode !== "exam") {
      examStage.innerHTML =
        '<div class="exam-card">' +
          `<div class="stat-num">${EXAM_COUNT}</div>` +
          `<div class="muted">случайных вопросов · ${EXAM_MINUTES} минут · порог ${Math.round(PASS_THRESHOLD * 100)}%</div>` +
          '<p class="muted">В контрольном режиме правильные ответы и пояснения показываются только после завершения экзамена.</p>' +
        "</div>";
    }
  }

  function startExam() {
    clearExamTimer();
    infiniteSession = null;
    const pool = bank.slice();
    if (!pool.length) {
      examStage.innerHTML = '<div class="empty-hint">Банк вопросов пуст.</div>';
      return;
    }
    const n = Math.min(EXAM_COUNT, pool.length);
    activeQuiz = {
      mode: "exam",
      items: shuffle(pool).slice(0, n).map(shuffleQuestionOptions),
      idx: 0,
      correctCount: 0,
      answers: Array(n).fill(null),
      flags: Array(n).fill(false),
      stage: examStage,
      startedAt: Date.now(),
      timeLimitMs: EXAM_MINUTES * 60 * 1000,
    };
    examTimer = setInterval(updateExamTimer, 1000);
    drawQuestion();
  }

  function clearExamTimer() {
    if (examTimer) {
      clearInterval(examTimer);
      examTimer = null;
    }
  }

  function remainingExamMs() {
    if (!activeQuiz || activeQuiz.mode !== "exam") return 0;
    return Math.max(0, activeQuiz.timeLimitMs - (Date.now() - activeQuiz.startedAt));
  }

  function formatTime(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function updateExamTimer() {
    if (!activeQuiz || activeQuiz.mode !== "exam") return clearExamTimer();
    const el = document.getElementById("exam-timer");
    if (el) el.textContent = formatTime(remainingExamMs());
    if (remainingExamMs() <= 0) finishQuiz(true);
  }

  function examAnsweredCount(quiz) {
    return quiz.answers.filter(Boolean).length;
  }

  function renderExamNavigator(quiz) {
    const cells = quiz.items.map((_, i) => {
      const answered = !!quiz.answers[i];
      const flagged = !!quiz.flags[i];
      const classes = [
        "exam-nav-cell",
        i === quiz.idx ? "current" : "",
        answered ? "answered" : "unanswered",
        flagged ? "flagged" : "",
      ].filter(Boolean).join(" ");
      const title = `${i + 1}: ${answered ? "есть ответ" : "нет ответа"}${flagged ? ", флажок" : ""}`;
      return `<button class="${classes}" data-goto="${i}" title="${title}">${i + 1}${flagged ? '<span class="flag-dot">⚑</span>' : ""}</button>`;
    }).join("");
    const answered = examAnsweredCount(quiz);
    const flagged = quiz.flags.filter(Boolean).length;
    return (
      '<aside class="exam-nav-panel">' +
        '<div class="exam-nav-head">' +
          '<b>Вопросы</b>' +
          `<span>${answered}/${quiz.items.length} отвечено · ${flagged} с флажком</span>` +
        "</div>" +
        `<div class="exam-nav-grid">${cells}</div>` +
        '<div class="exam-nav-legend">' +
          '<span><i class="legend-dot answered"></i>есть ответ</span>' +
          '<span><i class="legend-dot unanswered"></i>нет ответа</span>' +
          '<span><i class="legend-dot flagged"></i>флажок</span>' +
        "</div>" +
      "</aside>"
    );
  }

  function drawExamQuestion() {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    const pct = Math.round((examAnsweredCount(quiz) / quiz.items.length) * 100);
    const selected = quiz.answers[quiz.idx]?.choiceIdx;
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const optsHtml = q.options.map((opt, i) => {
      const isSelected = selected === i;
      return `<button class="opt ${isSelected ? "selected" : ""}" data-i="${i}">` +
        `<span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt, false)}</span>` +
      "</button>";
    }).join("");
    const canPrev = quiz.idx > 0;
    const canNext = quiz.idx < quiz.items.length - 1;
    const flagText = quiz.flags[quiz.idx] ? "Снять флажок" : "Отметить флажком";

    quiz.stage.innerHTML =
      `<div class="quiz-progress"><span>Вопрос ${quiz.idx + 1} из ${quiz.items.length}</span>` +
        `<span class="bar"><span style="width:${pct}%"></span></span>` +
        `<span class="timer">Осталось: <b id="exam-timer">${formatTime(remainingExamMs())}</b></span></div>` +
      '<div class="exam-workspace">' +
        '<div class="qcard exam-question-card">' +
          `<div class="fc-head"><span class="fc-topic">${escapeHtml(q.topic)}</span>${hardBadge(q)}</div>` +
          `<div class="q-text">${renderRichText(q.q, false)}</div>` +
          `<div class="options">${optsHtml}</div>` +
          '<div class="exam-actions">' +
            `<button class="btn" id="exam-prev" ${canPrev ? "" : "disabled"}>Назад</button>` +
            `<button class="btn" id="exam-flag">${flagText}</button>` +
            `<button class="btn" id="exam-next" ${canNext ? "" : "disabled"}>Вперёд</button>` +
            '<button class="btn btn-primary" id="exam-finish">Завершить экзамен</button>' +
          "</div>" +
          '<div class="kbd-hint">Клавиши: 1–6 или A–F — ответ, Enter/Space — вперёд. Ответ можно изменить до завершения.</div>' +
        "</div>" +
        renderExamNavigator(quiz) +
      "</div>";

    quiz.stage.querySelectorAll(".opt").forEach((b) => {
      b.addEventListener("click", () => answerExamQuestion(parseInt(b.dataset.i, 10)));
    });
    quiz.stage.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => goExamQuestion(parseInt(b.dataset.goto, 10)));
    });
    document.getElementById("exam-prev").addEventListener("click", () => goExamQuestion(quiz.idx - 1));
    document.getElementById("exam-next").addEventListener("click", () => goExamQuestion(quiz.idx + 1));
    document.getElementById("exam-flag").addEventListener("click", toggleExamFlag);
    document.getElementById("exam-finish").addEventListener("click", () => finishQuiz(false));
    updateExamTimer();
  }

  function answerExamQuestion(choiceIdx) {
    const quiz = activeQuiz;
    const q = quiz.items[quiz.idx];
    quiz.answers[quiz.idx] = { q, choiceIdx, isCorrect: q.correct.includes(choiceIdx) };
    if (quiz.idx < quiz.items.length - 1) {
      quiz.idx++;
    }
    drawExamQuestion();
  }

  function goExamQuestion(idx) {
    const quiz = activeQuiz;
    if (!quiz || quiz.mode !== "exam") return;
    quiz.idx = Math.max(0, Math.min(quiz.items.length - 1, idx));
    drawExamQuestion();
  }

  function toggleExamFlag() {
    const quiz = activeQuiz;
    if (!quiz || quiz.mode !== "exam") return;
    quiz.flags[quiz.idx] = !quiz.flags[quiz.idx];
    drawExamQuestion();
  }

  // ====================================================================
  // Общая логика вопроса
  // ====================================================================
  function drawQuestion() {
    const quiz = activeQuiz;
    if (quiz.mode === "exam") return drawExamQuestion();
    const q = quiz.items[quiz.idx];
    const pct = Math.round((quiz.idx / quiz.items.length) * 100);
    const letters = ["А", "Б", "В", "Г", "Д", "Е"];
    const timerHtml = quiz.mode === "exam"
      ? `<span class="timer">Осталось: <b id="exam-timer">${formatTime(remainingExamMs())}</b></span>`
      : `<span>Верно: ${quiz.correctCount}</span>`;
    const optsHtml = q.options.map((opt, i) =>
      `<button class="opt" data-i="${i}"><span class="marker">${letters[i] || i + 1}</span><span>${renderRichText(opt, false)}</span></button>`
    ).join("");

    quiz.stage.innerHTML =
      `<div class="quiz-progress"><span>Вопрос ${quiz.idx + 1} из ${quiz.items.length}</span>` +
        `<span class="bar"><span style="width:${pct}%"></span></span>${timerHtml}</div>` +
      '<div class="qcard">' +
        `<div class="fc-head"><span class="fc-topic">${escapeHtml(q.topic)}</span>${hardBadge(q)}</div>` +
        `<div class="q-text">${renderRichText(q.q, false)}</div>` +
        `<div class="options">${optsHtml}</div>` +
        keyboardHintHtml() +
        '<div id="q-feedback"></div>' +
      "</div>";

    quiz.stage.querySelectorAll(".opt").forEach((b) => {
      b.addEventListener("click", () => answerQuestion(parseInt(b.dataset.i, 10)));
    });
    updateExamTimer();
  }

  function answerQuestion(choiceIdx) {
    const quiz = activeQuiz;
    if (quiz.mode === "exam") return answerExamQuestion(choiceIdx);
    const q = quiz.items[quiz.idx];
    const isCorrect = q.correct.includes(choiceIdx);
    if (isCorrect) quiz.correctCount++;
    quiz.answers.push({ q, choiceIdx, isCorrect });
    recordAttempt(q, isCorrect, quiz.mode);

    if (quiz.mode === "exam") {
      goNextOrFinish();
      return;
    }

    const opts = quiz.stage.querySelectorAll(".opt");
    opts.forEach((b, i) => {
      b.disabled = true;
      if (q.correct.includes(i)) b.classList.add("correct");
      if (i === choiceIdx && !isCorrect) b.classList.add("wrong");
    });

    const fb = document.getElementById("q-feedback");
    const last = quiz.idx === quiz.items.length - 1;
    fb.innerHTML =
      explanationHtml(q, false) +
      '<div class="quiz-foot"><button class="btn btn-primary" id="q-next">' +
      (last ? "Завершить" : "Дальше") + "</button></div>";
    document.getElementById("q-next").addEventListener("click", goNextOrFinish);
  }

  function goNextOrFinish() {
    const quiz = activeQuiz;
    if (quiz.idx >= quiz.items.length - 1) return finishQuiz(false);
    quiz.idx++;
    drawQuestion();
  }

  function finishQuiz(timeout) {
    const quiz = activeQuiz;
    if (!quiz) return;
    clearExamTimer();
    const total = quiz.items.length;
    const finalAnswers = quiz.mode === "exam"
      ? quiz.items.map((q, idx) => quiz.answers[idx] || { q, choiceIdx: null, isCorrect: false })
      : quiz.answers;
    const correct = quiz.mode === "exam"
      ? finalAnswers.filter((a) => a.isCorrect).length
      : quiz.correctCount;
    const ratio = correct / total;
    const passed = ratio >= PASS_THRESHOLD;
    if (quiz.mode === "exam") {
      finalAnswers.forEach(({ q, isCorrect, choiceIdx }) => {
        if (choiceIdx !== null) recordAttempt(q, isCorrect, quiz.mode);
      });
    }
    const durationMs = quiz.mode === "exam"
      ? recordExamAttempt(quiz, timeout, correct, total, ratio, passed)
      : 0;
    const mistakes = finalAnswers.filter((a) => !a.isCorrect);
    const restartLabel = quiz.mode === "exam" ? "Начать новый экзамен" : "Пройти блок ещё раз";
    const restartId = quiz.mode === "exam" ? "exam-restart" : "block-restart";
    const restartFn = quiz.mode === "exam" ? startExam : startBlockQuiz;

    const mistakesHtml = mistakes.length
      ? '<h3 class="section-title">Ошибки и пояснения</h3>' +
        mistakes.slice(0, 30).map(({ q, choiceIdx }) =>
          '<div class="review-item">' +
            `<div class="fc-head"><span class="fc-topic">${escapeHtml(q.topic)}</span>${hardBadge(q)}</div>` +
            `<div class="q-text small">${renderRichText(q.q, false)}</div>` +
            `<div class="muted">Ваш ответ: ${renderRichText(q.options[choiceIdx] || "нет ответа", false)}</div>` +
            `<div class="fc-answer">Верно: ${renderRichText(answerText(q), false)}</div>` +
            explanationHtml(q, true) +
          "</div>"
        ).join("") +
        (mistakes.length > 30 ? `<div class="muted">Показаны первые 30 ошибок из ${mistakes.length}.</div>` : "")
      : '<div class="empty-hint">Ошибок нет — отличный результат.</div>';

    quiz.stage.innerHTML =
      '<div class="result-card">' +
        `<div class="result-score ${passed ? "pass" : "fail"}">${Math.round(ratio * 100)}%</div>` +
        `<div class="result-sub">${timeout ? "Время вышло · " : ""}Верно ${correct} из ${total} · ` +
          (passed ? "контроль пройден" : "ниже порога 70%") +
          (quiz.mode === "exam" ? ` · длилось ${formatDuration(durationMs)}` : "") + "</div>" +
        `<button class="btn btn-primary" id="${restartId}">${restartLabel}</button>` +
      "</div>" +
      mistakesHtml;
    document.getElementById(restartId).addEventListener("click", restartFn);
    activeQuiz = null;
  }

  // ====================================================================
  // Статистика
  // ====================================================================
  function formatDateTime(ts) {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h) return `${h} ч ${m} мин`;
    if (m) return `${m} мин ${String(s).padStart(2, "0")} сек`;
    return `${s} сек`;
  }

  function renderExamChart(items) {
    const recent = items.slice(-20);
    const width = 680;
    const height = 220;
    const pad = 32;
    const chartW = width - pad * 2;
    const chartH = height - pad * 2;
    const xFor = (idx) => recent.length === 1 ? width / 2 : pad + (idx / (recent.length - 1)) * chartW;
    const yFor = (score) => pad + ((100 - score) / 100) * chartH;
    const points = recent.map((item, idx) => `${xFor(idx)},${yFor(item.score)}`).join(" ");
    const passY = yFor(PASS_THRESHOLD * 100);
    const circles = recent.map((item, idx) =>
      `<circle class="${item.passed ? "pass" : "fail"}" cx="${xFor(idx)}" cy="${yFor(item.score)}" r="5">` +
        `<title>${formatDateTime(item.date)} — ${item.score}% (${item.correct}/${item.total})</title>` +
      "</circle>"
    ).join("");

    return (
      '<div class="exam-chart" aria-label="График результатов экзаменов">' +
        `<svg viewBox="0 0 ${width} ${height}" role="img">` +
          `<line class="axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" />` +
          `<line class="axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" />` +
          `<line class="pass-line" x1="${pad}" y1="${passY}" x2="${width - pad}" y2="${passY}" />` +
          `<text class="chart-label" x="${pad + 4}" y="${passY - 6}">70%</text>` +
          `<text class="chart-label" x="4" y="${pad + 4}">100</text>` +
          `<text class="chart-label" x="10" y="${height - pad}">0</text>` +
          (recent.length > 1 ? `<polyline class="score-line" points="${points}" />` : "") +
          circles +
        "</svg>" +
      "</div>"
    );
  }

  function renderExamHistory() {
    const el = document.getElementById("exam-history");
    if (!el) return;

    if (!examHistory.length) {
      el.innerHTML = '<div class="empty-hint">Экзаменов ещё не было. После завершения контрольного экзамена здесь появятся дата, длительность, баллы и динамика.</div>';
      return;
    }

    const latest = examHistory[examHistory.length - 1];
    const best = examHistory.reduce((max, item) => item.score > max.score ? item : max, examHistory[0]);
    const avg = Math.round(examHistory.reduce((sum, item) => sum + item.score, 0) / examHistory.length);
    const passCount = examHistory.filter((item) => item.passed).length;

    const rows = examHistory.slice(-10).reverse().map((item, idx) =>
      '<div class="exam-row">' +
        `<div class="exam-num">#${examHistory.length - idx}</div>` +
        `<div><b>${formatDateTime(item.date)}</b><span>${item.timeout ? "Время вышло" : "Завершён"}</span></div>` +
        `<div>${formatDuration(item.durationMs)}</div>` +
        `<div><b>${item.score}%</b><span>${item.correct}/${item.total}</span></div>` +
        `<div class="exam-status ${item.passed ? "pass" : "fail"}">${item.passed ? "Пройдено" : "Не пройдено"}</div>` +
      "</div>"
    ).join("");

    el.innerHTML =
      '<div class="exam-history-card">' +
        '<div class="exam-summary">' +
          `<div><span>Экзаменов</span><b>${examHistory.length}</b></div>` +
          `<div><span>Последний</span><b>${latest.score}%</b></div>` +
          `<div><span>Лучший</span><b>${best.score}%</b></div>` +
          `<div><span>Средний</span><b>${avg}%</b></div>` +
          `<div><span>Пройдено</span><b>${passCount}/${examHistory.length}</b></div>` +
        "</div>" +
        renderExamChart(examHistory) +
        '<div class="exam-table">' + rows + "</div>" +
      "</div>";
  }

  function renderStats() {
    let attempted = 0;
    let correct = 0;
    let totalAttempts = 0;
    for (const q of bank) {
      const st = progress[q.id];
      if (!st || !st.attempts) continue;
      attempted++;
      totalAttempts += st.attempts;
      correct += st.correct || 0;
    }
    const accuracy = totalAttempts ? Math.round((correct / totalAttempts) * 100) : 0;
    const statsCards = document.getElementById("stats-cards");
    statsCards.innerHTML = [
      ["Всего вопросов", bank.length],
      ["Встречались", attempted],
      ["Попыток", totalAttempts],
      ["Точность", accuracy + "%"],
      ["Освоено 3 подряд", bank.filter(isMastered).length],
      ["Экзаменов", examHistory.length],
    ].map(([lbl, num]) =>
      `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`
    ).join("");

    renderExamHistory();

    const table = document.getElementById("topic-table");
    table.innerHTML = topics().map((t) => {
      const qs = bank.filter((q) => q.topic === t);
      const done = qs.filter((q) => progress[q.id] && progress[q.id].attempts).length;
      const pct = qs.length ? Math.round((done / qs.length) * 100) : 0;
      return (
        '<div class="topic-row">' +
          `<div class="name">${escapeHtml(t)}</div>` +
          `<div class="count">${done}/${qs.length}</div>` +
          `<div class="progress-bar"><span style="width:${pct}%"></span></div>` +
        "</div>"
      );
    }).join("");
  }

  // ====================================================================
  // Настройки интерфейса
  // ====================================================================
  const uiTheme = document.getElementById("ui-theme");
  const uiFont = document.getElementById("ui-font");
  const uiFontSize = document.getElementById("ui-font-size");
  const uiFontSizeValue = document.getElementById("ui-font-size-value");
  const uiCompact = document.getElementById("ui-compact");
  const uiReset = document.getElementById("ui-reset");

  function syncUiControls() {
    if (!uiTheme) return;
    uiTheme.value = uiSettings.theme;
    uiFont.value = uiSettings.font;
    uiFontSize.value = uiSettings.fontSize;
    uiFontSizeValue.textContent = uiSettings.fontSize;
    uiCompact.checked = !!uiSettings.compact;
  }

  function updateUiSettings(patch) {
    uiSettings = normalizeUiSettings({ ...uiSettings, ...patch });
    saveUiSettings();
    applyUiSettings();
    syncUiControls();
  }

  if (uiTheme) {
    syncUiControls();
    uiTheme.addEventListener("change", () => updateUiSettings({ theme: uiTheme.value }));
    uiFont.addEventListener("change", () => updateUiSettings({ font: uiFont.value }));
    uiFontSize.addEventListener("input", () => updateUiSettings({ fontSize: parseInt(uiFontSize.value, 10) }));
    uiCompact.addEventListener("change", () => updateUiSettings({ compact: uiCompact.checked }));
    uiReset.addEventListener("click", () => updateUiSettings({ ...DEFAULT_UI }));
  }

  // ====================================================================
  // Горячие клавиши
  // ====================================================================
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function visibleStage() {
    if (activeQuiz && activeQuiz.stage) return activeQuiz.stage;
    if (infiniteSession) return infiniteStage;
    return null;
  }

  function clickOptionByIndex(idx) {
    const stage = visibleStage();
    if (!stage) return false;
    const opts = [...stage.querySelectorAll(".opt:not(:disabled)")];
    if (!opts[idx]) return false;
    opts[idx].click();
    return true;
  }

  function clickNextButton() {
    const stage = visibleStage();
    if (!stage) return false;
    const btn = stage.querySelector("#exam-next:not(:disabled), #q-next, #infinite-next, #block-restart, #exam-restart");
    if (!btn) return false;
    btn.click();
    return true;
  }

  function shortcutOptionIndex(key) {
    const lower = key.toLowerCase();
    if (/^[1-6]$/.test(lower)) return parseInt(lower, 10) - 1;
    const latin = ["a", "b", "c", "d", "e", "f"].indexOf(lower);
    if (latin >= 0) return latin;
    return ["а", "б", "в", "г", "д", "е"].indexOf(lower);
  }

  document.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) {
      if (e.key === "Escape") e.target.blur();
      return;
    }

    const optionIdx = shortcutOptionIndex(e.key);
    if (optionIdx >= 0 && clickOptionByIndex(optionIdx)) {
      e.preventDefault();
      return;
    }

    if (["Enter", " ", "n", "N", "т", "Т"].includes(e.key) && clickNextButton()) {
      e.preventDefault();
    }
  });

  // ====================================================================
  // Импорт / экспорт / сброс
  // ====================================================================
  const importFile = document.getElementById("import-file");
  const importStatus = document.getElementById("import-status");
  let importMerge = false;

  document.getElementById("import-merge").addEventListener("click", () => {
    importMerge = true;
    importFile.click();
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const arr = Array.isArray(data) ? data : data.bank;
        if (!Array.isArray(arr)) throw new Error("Ожидался массив вопросов");
        const cleaned = validateBank(arr);
        if (importMerge) {
          const ids = new Set(bank.map((q) => q.id));
          let added = 0;
          for (const q of cleaned) {
            if (!ids.has(q.id)) {
              bank.push(q);
              added++;
            }
          }
          setStatus(importStatus, "ok", `Добавлено новых вопросов: ${added}. Всего: ${bank.length}.`);
        } else {
          bank = cleaned;
          setStatus(importStatus, "ok", `Банк заменён. Загружено вопросов: ${bank.length}.`);
        }
        applyExplanations();
        saveBank();
        refreshTopicSelects();
        renderBlockIntro();
        renderInfiniteIntro();
      } catch (err) {
        setStatus(importStatus, "err", "Ошибка импорта: " + err.message);
      } finally {
        importMerge = false;
        importFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  function setStatus(el, cls, msg) {
    el.className = "status " + cls;
    el.textContent = msg;
  }

  document.getElementById("export-bank").addEventListener("click", () => download("farm-bank.json", bank));
  document.getElementById("export-progress").addEventListener("click", () => download("farm-progress.json", progress));

  document.getElementById("reset-progress").addEventListener("click", () => {
    if (!confirm("Удалить всю статистику тестов и историю экзаменов? Банк вопросов останется.")) return;
    progress = {};
    examHistory = [];
    saveProgress();
    saveExamHistory();
    setStatus(importStatus, "ok", "Статистика и история экзаменов сброшены.");
    renderStats();
  });

  document.getElementById("reset-bank").addEventListener("click", () => {
    if (!confirm("Вернуть банк-пример? Импортированные вопросы будут потеряны.")) return;
    bank = SEED_BANK.slice();
    applyExplanations();
    saveBank();
    refreshTopicSelects();
    renderBlockIntro();
    renderInfiniteIntro();
    setStatus(importStatus, "ok", "Банк-пример восстановлен.");
  });

  function refreshTopicSelects() {
    fillTopicSelect(blockTopic);
    fillTopicSelect(infiniteTopic);
  }

  function refreshVisibleView() {
    if (!document.getElementById("view-blocks").classList.contains("hidden")) renderBlockIntro();
    if (!document.getElementById("view-infinite").classList.contains("hidden")) renderInfiniteIntro();
    if (!document.getElementById("view-exam").classList.contains("hidden")) renderExamIntro();
    if (!document.getElementById("view-stats").classList.contains("hidden")) renderStats();
  }

  // ====================================================================
  // Инициализация
  // ====================================================================
  refreshTopicSelects();
  renderBlockIntro();
  renderInfiniteIntro();
  renderExamIntro();

  if (typeof fetch === "function") {
    fetch("explanations.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((map) => {
        if (map && typeof map === "object") {
          explanationsMap = map;
          applyExplanations();
          refreshVisibleView();
        }
      })
      .catch(() => {});
  }

  if (typeof fetch === "function") {
    fetch("farm-bank.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const arr = Array.isArray(data) ? data : data && data.bank;
        if (!Array.isArray(arr) || !arr.length) return;
        if (hadStoredBank && arr.length <= bank.length) return;
        bank = validateBank(arr);
        applyExplanations();
        saveBank();
        refreshTopicSelects();
        refreshVisibleView();
      })
      .catch(() => {});
  }
})();
