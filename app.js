"use strict";

/* ---------------------------------------------------------------- constants */

const LS_STATS = "medtrainer.stats.v1";
const LS_SETTINGS = "medtrainer.settings.v1";

const CAT_EMOJI = {
  lekarstva: "💊",
  bad: "🌿",
  imn: "🩹",
  "lechebnoe-pitanie": "🥣",
  tonometry: "🩺",
  glyukometry: "🩸",
  "test-poloski": "🧪",
  "testy-beremennost": "🤰",
  linzy: "👁️",
  aptechki: "🧰",
};

const MODES = [
  { id: "choice", emoji: "🔤", title: "Выбор названия", desc: "Смотришь на фото упаковки — выбираешь верное название из 4 вариантов.", minCats: 1 },
  { id: "reverse", emoji: "📦", title: "Найди упаковку", desc: "Дано название — выбери нужную упаковку среди 4 фото.", minCats: 1 },
  { id: "typing", emoji: "⌨️", title: "Введи название", desc: "Смотришь на фото — печатаешь название сам, без вариантов.", minCats: 1 },
  { id: "matching", emoji: "🔗", title: "Сопоставление", desc: "Соедини фото упаковок с названиями — по 6 пар за раунд.", minCats: 1 },
  { id: "categorize", emoji: "🗂️", title: "Определи категорию", desc: "Дано фото товара — выбери, к какой категории он относится.", minCats: 2 },
  { id: "flashcards", emoji: "🃏", title: "Карточки", desc: "Смотришь на фото, вспоминаешь название, сам себя оцениваешь.", minCats: 1 },
];

const ROUND_SIZE = 6;

/* ---------------------------------------------------------------- state */

const state = {
  categoriesIndex: [],
  itemsCache: {},
  selectedCategories: new Set(),
  mode: "choice",
  hideLabels: true,
  weighted: true,
  questionCount: 20,
  stats: loadStats(),
  session: null,
};

/* ---------------------------------------------------------------- storage helpers */

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(LS_STATS)) || {};
  } catch {
    return {};
  }
}
function saveStats() {
  localStorage.setItem(LS_STATS, JSON.stringify(state.stats));
}
function recordStat(itemId, correct) {
  const s = state.stats[itemId] || { seen: 0, correct: 0, wrong: 0 };
  s.seen++;
  if (correct) s.correct++;
  else s.wrong++;
  state.stats[itemId] = s;
  saveStats();
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
    if (!s) return;
    if (Array.isArray(s.selectedCategories)) state.selectedCategories = new Set(s.selectedCategories);
    if (s.mode) state.mode = s.mode;
    if (typeof s.hideLabels === "boolean") state.hideLabels = s.hideLabels;
    if (typeof s.weighted === "boolean") state.weighted = s.weighted;
    if (s.questionCount) state.questionCount = s.questionCount;
  } catch {}
}
function saveSettings() {
  localStorage.setItem(
    LS_SETTINGS,
    JSON.stringify({
      selectedCategories: [...state.selectedCategories],
      mode: state.mode,
      hideLabels: state.hideLabels,
      weighted: state.weighted,
      questionCount: state.questionCount,
    })
  );
}

/* ---------------------------------------------------------------- text utils */

function imgSrc(item) {
  return `data/meds/${item.image}`;
}

function shortName(full) {
  // отрезаем хвост с дозировкой/фасовкой ("500 мг", "30 шт", "22-42 см"),
  // но не режем цифры внутри модели/бренда ("PA2", "BP W10");
  // \b не годится тут — в JS он не видит границы слов на кириллице
  const DOSE_CUT = /\s+\d[\d.,]*\s*(мг|мкг|г|мл|л|%|шт|см|мм|капс|таб|пар|доз)(?![а-яёa-z])/i;
  let s = full;
  const cut = s.match(DOSE_CUT);
  if (cut) s = s.slice(0, cut.index);
  s = s.trim();

  const FORM_WORD =
    /(таблетки?|капсулы?|раствор[а-я]*|суппозитории|мазь|крем|гель|сироп|порошок|спрей|капли|драже|пастилки?|суспензия|эмульсия|паста|шампунь|бальзам|пластырь|набор|комплект|для|наружного|наружн[а-я]*|внутреннего|внутр[а-я]*|местного|приготовления|приёма|приема|внутрь|шипучие|жевательные|пролонгированного|действия|покрытые|плёночной|пленочной|оболочкой|пероральн[а-я]*|ректальные|вагинальные|глазные|назальные|ушные|детск[а-я]*)$/i;
  let prev;
  do {
    prev = s;
    s = s.replace(/[^a-zа-яё0-9)\]]+$/i, "").trim();
    s = s.replace(FORM_WORD, "").trim();
  } while (s !== prev && s.length > 0);
  return s || full.split(",")[0].trim();
}

function normalizeForCompare(s) {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

function isTypedAnswerCorrect(userInput, correctShort) {
  const u = normalizeForCompare(userInput);
  const c = normalizeForCompare(correctShort);
  if (!u) return false;
  if (u === c) return true;
  const maxDist = c.length > 9 ? 2 : c.length > 4 ? 1 : 0;
  return levenshtein(u, c) <= maxDist;
}

/* ---------------------------------------------------------------- array utils */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}
function weightOf(item) {
  const s = state.stats[item.id];
  if (!s) return 1;
  return 1 + Math.max(0, s.wrong - s.correct) * 1.6;
}
function weightedSample(pool, n) {
  if (!state.weighted) return sample(pool, n);
  const scored = pool.map((it) => ({ it, w: weightOf(it) * (0.4 + Math.random()) }));
  scored.sort((a, b) => b.w - a.w);
  return shuffle(scored.slice(0, n).map((x) => x.it));
}

function pickDistractors(pool, correct, n) {
  const correctShort = shortName(correct.name);
  const others = pool.filter((it) => it.id !== correct.id);
  const distinctShort = others.filter((it) => shortName(it.name) !== correctShort);
  const source = distinctShort.length >= n ? distinctShort : others;
  return sample(source, Math.min(n, source.length));
}

/* ---------------------------------------------------------------- data loading */

async function loadCategoriesIndex() {
  const res = await fetch("data/meds/index.json");
  const data = await res.json();
  state.categoriesIndex = data.categories.filter((c) => c.count > 0);
}

async function ensureItemsLoaded(categoryIds) {
  const toLoad = categoryIds.filter((id) => !state.itemsCache[id]);
  await Promise.all(
    toLoad.map(async (id) => {
      const res = await fetch(`data/meds/${id}.json`);
      const data = await res.json();
      state.itemsCache[id] = data.items;
    })
  );
}

function buildPool() {
  const pool = [];
  for (const catId of state.selectedCategories) {
    const catMeta = state.categoriesIndex.find((c) => c.id === catId);
    const items = state.itemsCache[catId] || [];
    for (const it of items) pool.push({ ...it, categoryId: catId, categoryTitle: catMeta ? catMeta.title : catId });
  }
  return pool;
}

/* ---------------------------------------------------------------- DOM refs */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const views = {
  home: $("#view-home"),
  quiz: $("#view-quiz"),
  result: $("#view-result"),
  stats: $("#view-stats"),
};

function showView(name) {
  for (const k in views) views[k].classList.toggle("hidden", k !== name);
  document.querySelectorAll(".tnav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

/* ---------------------------------------------------------------- home view */

function renderCategoryGrid() {
  const grid = $("#cat-grid");
  grid.innerHTML = "";
  for (const cat of state.categoriesIndex) {
    const card = el(
      "div",
      "cat-card" + (state.selectedCategories.has(cat.id) ? " on" : ""),
      `<div class="cat-emoji">${CAT_EMOJI[cat.id] || "📦"}</div>
       <div>
         <div class="cat-name">${cat.title}</div>
         <div class="cat-count">${cat.count} шт.</div>
       </div>`
    );
    card.addEventListener("click", () => {
      if (state.selectedCategories.has(cat.id)) state.selectedCategories.delete(cat.id);
      else state.selectedCategories.add(cat.id);
      card.classList.toggle("on");
      updateSetupSummary();
      saveSettings();
    });
    grid.appendChild(card);
  }
}

function renderModeGrid() {
  const grid = $("#mode-grid");
  grid.innerHTML = "";
  for (const mode of MODES) {
    const card = el(
      "div",
      "mode-card" + (state.mode === mode.id ? " on" : ""),
      `<div class="mode-emoji">${mode.emoji}</div>
       <div class="mode-title">${mode.title}</div>
       <div class="mode-desc">${mode.desc}</div>`
    );
    card.dataset.mode = mode.id;
    card.addEventListener("click", () => {
      if (card.classList.contains("disabled")) return;
      state.mode = mode.id;
      document.querySelectorAll(".mode-card").forEach((c) => c.classList.remove("on"));
      card.classList.add("on");
      updateSetupSummary();
      saveSettings();
    });
    grid.appendChild(card);
  }
  refreshModeAvailability();
}

function refreshModeAvailability() {
  document.querySelectorAll(".mode-card").forEach((card) => {
    const mode = MODES.find((m) => m.id === card.dataset.mode);
    const disabled = state.selectedCategories.size < mode.minCats;
    card.classList.toggle("disabled", disabled);
    if (disabled && state.mode === mode.id) {
      // авто-переключение, если текущий режим стал недоступен
      const fallback = MODES.find((m) => state.selectedCategories.size >= m.minCats);
      if (fallback) {
        state.mode = fallback.id;
        document.querySelectorAll(".mode-card").forEach((c) => c.classList.toggle("on", c.dataset.mode === fallback.id));
      }
    }
  });
}

function updateSetupSummary() {
  refreshModeAvailability();
  const n = state.selectedCategories.size;
  const total = [...state.selectedCategories].reduce((sum, id) => {
    const c = state.categoriesIndex.find((x) => x.id === id);
    return sum + (c ? c.count : 0);
  }, 0);
  const summary = $("#setup-summary");
  const startBtn = $("#start-btn");
  if (n === 0) {
    summary.textContent = "Выберите хотя бы одну категорию";
    startBtn.disabled = true;
  } else {
    summary.textContent = `Выбрано категорий: ${n} · товаров в пуле: ${total}`;
    startBtn.disabled = false;
  }
}

function bindHomeUi() {
  $("#cat-all").addEventListener("click", () => {
    state.categoriesIndex.forEach((c) => state.selectedCategories.add(c.id));
    renderCategoryGrid();
    updateSetupSummary();
    saveSettings();
  });
  $("#cat-none").addEventListener("click", () => {
    state.selectedCategories.clear();
    renderCategoryGrid();
    updateSetupSummary();
    saveSettings();
  });
  $("#opt-count").value = String(state.questionCount);
  $("#opt-count").addEventListener("change", (e) => {
    state.questionCount = parseInt(e.target.value, 10);
    saveSettings();
  });
  $("#opt-hide").checked = state.hideLabels;
  $("#opt-hide").addEventListener("change", (e) => {
    state.hideLabels = e.target.checked;
    saveSettings();
  });
  $("#opt-weighted").checked = state.weighted;
  $("#opt-weighted").addEventListener("change", (e) => {
    state.weighted = e.target.checked;
    saveSettings();
  });
  $("#start-btn").addEventListener("click", startSession);

  document.querySelectorAll(".tnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === "stats") renderStatsView();
      showView(btn.dataset.view);
    });
  });
}

/* ---------------------------------------------------------------- session engine */

async function startSession() {
  await ensureItemsLoaded([...state.selectedCategories]);
  const pool = buildPool();
  if (pool.length < 2) {
    alert("В выбранных категориях слишком мало товаров для этого режима.");
    return;
  }
  const count = state.questionCount === 0 ? pool.length : Math.min(state.questionCount, pool.length);
  const queue = weightedSample(pool, count);

  state.session = {
    mode: state.mode,
    hideLabels: state.hideLabels,
    pool,
    queue,
    idx: 0,
    total: queue.length,
    score: { correct: 0, wrong: 0 },
    mistakes: [],
    match: null,
  };

  showView("quiz");
  $("#quiz-mode-title").textContent = MODES.find((m) => m.id === state.session.mode).title;
  renderQuizStep();
}

$("#quiz-quit").addEventListener("click", () => {
  if (confirm("Прервать тренировку и выйти в меню?")) {
    state.session = null;
    showView("home");
  }
});

function updateQuizHeader() {
  const s = state.session;
  const doneCount = s.mode === "matching" ? s.idx : s.idx;
  $("#quiz-progress-fill").style.width = `${Math.min(100, (doneCount / s.total) * 100)}%`;
  $("#quiz-progress-text").textContent = `${Math.min(doneCount, s.total)} / ${s.total}`;
  $("#quiz-score").textContent = `✔ ${s.score.correct} · ✘ ${s.score.wrong}`;
}

function renderQuizStep() {
  const s = state.session;
  updateQuizHeader();
  if (s.idx >= s.total) {
    finishSession();
    return;
  }
  const body = $("#quiz-body");
  body.innerHTML = "";
  switch (s.mode) {
    case "choice":
      renderChoiceQuestion(body, false);
      break;
    case "reverse":
      renderChoiceQuestion(body, true);
      break;
    case "typing":
      renderTypingQuestion(body);
      break;
    case "categorize":
      renderCategorizeQuestion(body);
      break;
    case "flashcards":
      renderFlashcard(body);
      break;
    case "matching":
      renderMatchingRound(body);
      break;
  }
}

function photoBlock(item, { small } = {}) {
  const wrap = el("div", "q-photo-wrap");
  const box = el("div", "q-photo");
  const img = el("img");
  img.src = imgSrc(item);
  img.alt = "";
  if (state.session.hideLabels) img.classList.add("blurred");
  box.appendChild(img);
  if (state.session.hideLabels) {
    const peek = el("button", "q-peek-btn", "👁");
    peek.type = "button";
    peek.addEventListener("pointerdown", () => img.classList.remove("blurred"));
    peek.addEventListener("pointerup", () => img.classList.add("blurred"));
    peek.addEventListener("pointerleave", () => img.classList.add("blurred"));
    box.appendChild(peek);
  }
  wrap.appendChild(box);
  return wrap;
}

function peekAllButton(container) {
  const btn = el("button", "btn-ghost", "👁 Подсмотреть (удерживать)");
  btn.type = "button";
  btn.style.marginBottom = "12px";
  const toggle = (on) => container.querySelectorAll("img.blurred").forEach((img) => img.classList.toggle("blurred-off", on));
  btn.addEventListener("pointerdown", () => toggle(true));
  btn.addEventListener("pointerup", () => toggle(false));
  btn.addEventListener("pointerleave", () => toggle(false));
  return btn;
}

function advanceAfterAnswer(delayMs = 900) {
  const s = state.session;
  setTimeout(() => {
    s.idx++;
    renderQuizStep();
  }, delayMs);
}

/* ---- choice / reverse ---- */

function renderChoiceQuestion(body, reverse) {
  const s = state.session;
  const correct = s.queue[s.idx];
  const distractors = pickDistractors(s.pool, correct, 3);
  const options = shuffle([correct, ...distractors]);

  if (!reverse) {
    body.appendChild(photoBlock(correct));
    body.appendChild(el("div", "q-prompt", "Как называется этот препарат?"));
    const grid = el("div", "opt-grid");
    for (const opt of options) {
      const btn = el("button", "opt-btn", shortName(opt.name));
      btn._itemId = opt.id;
      btn.addEventListener("click", () => handleChoiceAnswer(btn, grid, opt, correct));
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  } else {
    body.appendChild(el("div", "q-prompt", "Найди упаковку:"));
    body.appendChild(el("div", "q-name-big", shortName(correct.name)));
    const grid = el("div", "opt-grid opt-images");
    if (s.hideLabels) body.appendChild(peekAllButton(grid));
    for (const opt of options) {
      const btn = el("button", "opt-btn opt-image");
      btn._itemId = opt.id;
      const img = el("img");
      img.src = imgSrc(opt);
      if (s.hideLabels) img.classList.add("blurred");
      btn.appendChild(img);
      btn.addEventListener("click", () => handleChoiceAnswer(btn, grid, opt, correct));
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  }
  body.appendChild(feedbackEl());
}

function handleChoiceAnswer(btn, grid, opt, correct) {
  grid.querySelectorAll(".opt-btn").forEach((b) => (b.disabled = true));
  document.querySelectorAll("img.blurred").forEach((img) => img.classList.remove("blurred"));
  const isCorrect = opt.id === correct.id;
  btn.classList.add(isCorrect ? "correct" : "wrong");
  for (const b of grid.querySelectorAll(".opt-btn")) {
    if (b._itemId === correct.id) b.classList.add("correct");
  }
  markScore(isCorrect, correct);
  showFeedback(isCorrect, correct);
  advanceAfterAnswer();
}

function feedbackEl() {
  const fb = el("div", "feedback");
  fb.id = "quiz-feedback";
  return fb;
}
function showFeedback(isCorrect, correct) {
  const fb = $("#quiz-feedback");
  if (!fb) return;
  fb.classList.add("show", isCorrect ? "ok" : "no");
  fb.innerHTML = isCorrect
    ? `Верно! <span class="fb-manuf">${shortName(correct.name)} — ${correct.manufacturer || ""}</span>`
    : `Правильный ответ: <b>${shortName(correct.name)}</b> <span class="fb-manuf">${correct.manufacturer || ""}</span>`;
}

function markScore(isCorrect, correct) {
  const s = state.session;
  if (isCorrect) s.score.correct++;
  else {
    s.score.wrong++;
    s.mistakes.push({ item: correct, userAnswer: null });
  }
  recordStat(correct.id, isCorrect);
}

/* ---- typing ---- */

function renderTypingQuestion(body) {
  const s = state.session;
  const correct = s.queue[s.idx];
  body.appendChild(photoBlock(correct));
  body.appendChild(el("div", "q-prompt", "Напиши название препарата:"));
  const row = el("div", "q-type-row");
  const input = el("input");
  input.type = "text";
  input.placeholder = "Название...";
  input.autocomplete = "off";
  const submit = el("button", "btn-primary", "Ответить");
  submit.style.width = "auto";
  row.appendChild(input);
  row.appendChild(submit);
  body.appendChild(row);
  body.appendChild(feedbackEl());

  let answered = false;
  function submitAnswer() {
    if (answered) return;
    answered = true;
    input.disabled = true;
    submit.disabled = true;
    document.querySelectorAll(".q-photo img").forEach((img) => img.classList.remove("blurred"));
    const isCorrect = isTypedAnswerCorrect(input.value, shortName(correct.name));
    input.style.borderColor = isCorrect ? "var(--good)" : "var(--bad)";
    markScore(isCorrect, correct);
    showFeedback(isCorrect, correct);
    advanceAfterAnswer(1300);
  }
  submit.addEventListener("click", submitAnswer);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnswer();
  });
  setTimeout(() => input.focus(), 50);
}

/* ---- categorize ---- */

function renderCategorizeQuestion(body) {
  const s = state.session;
  const correct = s.queue[s.idx];
  const cats = [...state.selectedCategories]
    .map((id) => state.categoriesIndex.find((c) => c.id === id))
    .filter(Boolean);

  body.appendChild(photoBlock(correct));
  body.appendChild(el("div", "q-prompt", `«${shortName(correct.name)}» — к какой категории относится?`));
  const grid = el("div", "opt-grid");
  for (const cat of shuffle(cats)) {
    const btn = el("button", "opt-btn", `${CAT_EMOJI[cat.id] || ""} ${cat.title}`);
    btn._catId = cat.id;
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".opt-btn").forEach((b) => (b.disabled = true));
      const isCorrect = cat.id === correct.categoryId;
      btn.classList.add(isCorrect ? "correct" : "wrong");
      if (!isCorrect) {
        for (const b of grid.querySelectorAll(".opt-btn")) if (b._catId === correct.categoryId) b.classList.add("correct");
      }
      markScore(isCorrect, correct);
      showFeedback(isCorrect, correct);
      advanceAfterAnswer();
    });
    grid.appendChild(btn);
  }
  body.appendChild(grid);
  body.appendChild(feedbackEl());
}

/* ---- flashcards ---- */

function renderFlashcard(body) {
  const s = state.session;
  const item = s.queue[s.idx];
  const card = el("div", "flash-card");
  card.appendChild(photoBlock(item));
  const nameEl = el("div", "flash-name-reveal", "");
  const manufEl = el("div", "flash-manuf", "");
  card.appendChild(nameEl);
  card.appendChild(manufEl);

  const actions = el("div", "flash-actions");
  const showBtn = el("button", "flash-show", "Показать название");
  actions.appendChild(showBtn);
  card.appendChild(actions);
  body.appendChild(card);

  showBtn.addEventListener("click", () => {
    document.querySelectorAll(".q-photo img").forEach((img) => img.classList.remove("blurred"));
    nameEl.textContent = shortName(item.name);
    manufEl.textContent = item.manufacturer || "";
    actions.innerHTML = "";
    const dontKnow = el("button", "flash-dontknow", "Не знал 🙈");
    const know = el("button", "flash-know", "Знал ✅");
    dontKnow.addEventListener("click", () => {
      markScore(false, item);
      advanceAfterAnswer(200);
    });
    know.addEventListener("click", () => {
      markScore(true, item);
      advanceAfterAnswer(200);
    });
    actions.appendChild(dontKnow);
    actions.appendChild(know);
  });
}

/* ---- matching ---- */

function renderMatchingRound(body) {
  const s = state.session;
  const remaining = s.total - s.idx;
  const roundSize = Math.min(ROUND_SIZE, remaining);
  const roundItems = s.queue.slice(s.idx, s.idx + roundSize);

  const images = shuffle(roundItems);
  const names = shuffle(roundItems);

  const wrongAttempts = {};
  const lockedIds = new Set();
  let selectedImageId = null;
  let selectedNameId = null;

  body.appendChild(el("div", "q-prompt", "Соедини фото упаковки с названием — сначала кликни фото, затем название."));
  const wrap = el("div", "match-wrap");
  if (s.hideLabels) body.appendChild(peekAllButton(wrap));

  const colImg = el("div");
  colImg.appendChild(el("div", "match-col-title", "Фото"));
  const imgGrid = el("div", "match-images");
  images.forEach((item, i) => {
    const cell = el("div", "match-img-cell");
    cell.dataset.id = item.id;
    const img = el("img");
    img.src = imgSrc(item);
    if (s.hideLabels) img.classList.add("blurred");
    cell.appendChild(img);
    cell.appendChild(el("div", "match-num", String(i + 1)));
    cell.addEventListener("click", () => {
      if (lockedIds.has(item.id)) return;
      imgGrid.querySelectorAll(".match-img-cell").forEach((c) => c.classList.remove("selected"));
      cell.classList.add("selected");
      selectedImageId = item.id;
      tryMatch();
    });
    imgGrid.appendChild(cell);
  });
  colImg.appendChild(imgGrid);

  const colName = el("div");
  colName.appendChild(el("div", "match-col-title", "Название"));
  const nameList = el("div", "match-names");
  names.forEach((item) => {
    const btn = el("button", "match-name-btn", shortName(item.name));
    btn.dataset.id = item.id;
    btn.addEventListener("click", () => {
      if (lockedIds.has(item.id)) return;
      nameList.querySelectorAll(".match-name-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedNameId = item.id;
      tryMatch();
    });
    nameList.appendChild(btn);
  });
  colName.appendChild(nameList);

  wrap.appendChild(colImg);
  wrap.appendChild(colName);
  body.appendChild(wrap);
  body.appendChild(feedbackEl());

  function tryMatch() {
    if (!selectedImageId || !selectedNameId) return;
    const imgCell = imgGrid.querySelector(`.match-img-cell[data-id="${CSS.escape(selectedImageId)}"]`);
    const nameBtn = nameList.querySelector(`.match-name-btn[data-id="${CSS.escape(selectedNameId)}"]`);
    if (selectedImageId === selectedNameId) {
      imgCell.querySelector("img").classList.remove("blurred");
      imgCell.classList.remove("selected");
      imgCell.classList.add("locked");
      nameBtn.classList.remove("selected");
      nameBtn.classList.add("locked");
      lockedIds.add(selectedImageId);
      recordStat(selectedImageId, !wrongAttempts[selectedImageId]);
      s.score.correct++;
      updateQuizHeader();
      if (lockedIds.size === roundItems.length) {
        setTimeout(() => {
          s.idx += roundSize;
          renderQuizStep();
        }, 500);
      }
    } else {
      wrongAttempts[selectedImageId] = true;
      wrongAttempts[selectedNameId] = true;
      s.score.wrong++;
      updateQuizHeader();
      imgCell.classList.add("wrong-flash");
      nameBtn.classList.add("wrong-flash");
      setTimeout(() => {
        imgCell.classList.remove("wrong-flash", "selected");
        nameBtn.classList.remove("wrong-flash", "selected");
      }, 450);
    }
    selectedImageId = null;
    selectedNameId = null;
  }
}

/* ---------------------------------------------------------------- results */

function finishSession() {
  const s = state.session;
  showView("result");
  const total = s.score.correct + s.score.wrong;
  const pct = total ? Math.round((s.score.correct / total) * 100) : 0;
  $("#result-title").textContent = pct >= 80 ? "Отличный результат! 🎉" : pct >= 50 ? "Неплохо, есть куда расти" : "Стоит повторить";
  $("#result-score").textContent = `✔ ${s.score.correct} · ✘ ${s.score.wrong} (${pct}%)`;

  const mistakesBox = $("#result-mistakes");
  mistakesBox.innerHTML = "";
  const uniqMistakes = [];
  const seen = new Set();
  for (const m of s.mistakes) {
    if (seen.has(m.item.id)) continue;
    seen.add(m.item.id);
    uniqMistakes.push(m);
  }
  if (uniqMistakes.length) {
    mistakesBox.appendChild(el("div", "q-prompt", "Разбор ошибок:"));
    for (const m of uniqMistakes) {
      const row = el(
        "div",
        "mistake-row",
        `<img src="${imgSrc(m.item)}" alt=""/>
         <div><div class="mistake-name">${shortName(m.item.name)}</div>
         <div class="mistake-you">${m.item.categoryTitle || ""}</div></div>`
      );
      mistakesBox.appendChild(row);
    }
  }

  const retryBtn = $("#result-retry-mistakes");
  if (uniqMistakes.length) {
    retryBtn.classList.remove("hidden");
    retryBtn.onclick = () => {
      const pool = s.pool;
      const queue = uniqMistakes.map((m) => m.item);
      state.session = { mode: s.mode, hideLabels: s.hideLabels, pool, queue, idx: 0, total: queue.length, score: { correct: 0, wrong: 0 }, mistakes: [], match: null };
      showView("quiz");
      $("#quiz-mode-title").textContent = MODES.find((m) => m.id === s.mode).title + " · повтор ошибок";
      renderQuizStep();
    };
  } else {
    retryBtn.classList.add("hidden");
  }
}

$("#result-again").addEventListener("click", startSession);
$("#result-home").addEventListener("click", () => showView("home"));

/* ---------------------------------------------------------------- stats view */

function renderStatsView() {
  const body = $("#stats-body");
  body.innerHTML = "";
  if (!state.categoriesIndex.length) return;
  for (const cat of state.categoriesIndex) {
    const items = state.itemsCache[cat.id];
    let seenCount = 0,
      correctCount = 0,
      wrongCount = 0;
    for (const key in state.stats) {
      if (key.startsWith(cat.id + "-")) {
        seenCount += state.stats[key].seen;
        correctCount += state.stats[key].correct;
        wrongCount += state.stats[key].wrong;
      }
    }
    const total = correctCount + wrongCount;
    const pct = total ? Math.round((correctCount / total) * 100) : 0;
    const row = el(
      "div",
      "stats-row",
      `<div class="stats-name">${CAT_EMOJI[cat.id] || ""} ${cat.title}</div>
       <div class="stats-bar-wrap"><div class="stats-bar" style="width:${pct}%"></div></div>
       <div class="stats-pct">${total ? pct + "%" : "—"}</div>`
    );
    body.appendChild(row);
  }
}

$("#stats-reset").addEventListener("click", () => {
  if (confirm("Сбросить всю статистику и историю ошибок?")) {
    state.stats = {};
    saveStats();
    renderStatsView();
  }
});

/* ---------------------------------------------------------------- init */

async function init() {
  loadSettings();
  await loadCategoriesIndex();
  renderCategoryGrid();
  renderModeGrid();
  bindHomeUi();
  updateSetupSummary();
}

init();
