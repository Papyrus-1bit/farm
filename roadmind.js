// RoadMind — сценарии дорожных ситуаций (PixiJS)

(function () {
  "use strict";

  const LS_RM = "roadmind.progress.v1";
  const TILE = 48;
  const MAP_W = 16;
  const MAP_H = 16;

  const C = {
    grass: 0xd8ead5,
    grassDark: 0xc8dfc4,
    grassShadow: 0xb8d4b4,
    asphalt: 0x6b7280,
    asphaltDark: 0x5b6370,
    asphaltLight: 0x787f8d,
    curb: 0xf1f5f9,
    sidewalk: 0xe2e8f0,
    marking: 0xffffff,
    yellow: 0xfbbf24,
    building: 0xf8fafc,
    buildingEdge: 0xdbe3ec,
    buildingWindow: 0xc7d2de,
    tree: 0x4ade80,
    treeDark: 0x22c55e,
    treeTrunk: 0x78716c,
  };

  const ROAD = { x0: 5, x1: 9, y0: 5, y1: 9 };

  const $ = (id) => document.getElementById(id);

  let index = null;
  let scenarioCache = {};
  let progress = loadProgress();
  let currentTopic = null;
  let currentScenario = null;
  let pixiApp = null;
  let world = null;
  let sprites = new Map();
  let screen = "hub";
  let hubMode = "scenarios";
  let driveSeed = Math.floor(Math.random() * 1e6);
  let drivePixiApp = null;
  let driveWorld = null;
  let mode = "scenario"; // scenario | drive
  let resizeBound = false;

  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener("resize", resizePixi);
  }

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(LS_RM) || "{}");
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(LS_RM, JSON.stringify(progress));
  }

  function topicProgress(topicId) {
    const p = progress[topicId] || { done: 0, ok: 0, best: 0 };
    return p;
  }

  function scenarioProgress(id) {
    return progress["s:" + id] || null;
  }

  async function loadIndex() {
    if (index) return index;
    const res = await fetch("scenarios/index.json");
    index = await res.json();
    return index;
  }

  async function loadScenario(id) {
    if (scenarioCache[id]) return scenarioCache[id];
    const res = await fetch(`scenarios/${id}.json`);
    scenarioCache[id] = await res.json();
    return scenarioCache[id];
  }

  function showScreen(name) {
    screen = name;
    ["hub", "list", "play", "debrief", "drive"].forEach((s) => {
      const el = $("rm-" + s);
      if (el) el.classList.toggle("hidden", s !== name);
    });
    if (name === "drive") {
      mode = "drive";
      if (drivePixiApp) drivePixiApp.ticker.start();
      else if (pixiApp) pixiApp.ticker.stop();
    } else if (name === "play") {
      mode = "scenario";
      if (drivePixiApp) RoadMindDrive?.stop();
      if (pixiApp) pixiApp.ticker.start();
    } else {
      if (pixiApp) pixiApp.ticker.stop();
      if (drivePixiApp) RoadMindDrive?.stop();
    }
  }

  function stars(difficulty) {
    return "★".repeat(difficulty) + "☆".repeat(5 - difficulty);
  }

  async function renderHub() {
    await loadIndex();
    renderDriveSetup();
    const grid = $("rm-topic-grid");
    grid.innerHTML = index.topics
      .map((t) => {
        const p = topicProgress(t.id);
        const total = t.scenarios.length;
        const pct = total ? Math.round((p.done / total) * 100) : 0;
        return (
          `<button type="button" class="rm-topic-card" data-topic="${t.id}">` +
          `<div class="rm-topic-icon">${iconFor(t.icon)}</div>` +
          `<div class="rm-topic-body">` +
          `<div class="rm-topic-name">${escapeHtml(t.title)}</div>` +
          `<div class="rm-topic-meta muted">${total} сценариев · ${stars(2)}</div>` +
          `<div class="progress-bar"><span style="width:${pct}%"></span></div>` +
          `</div></button>`
        );
      })
      .join("");
    grid.querySelectorAll("[data-topic]").forEach((btn) => {
      btn.addEventListener("click", () => openTopic(btn.dataset.topic));
    });
    showScreen("hub");
    syncHubMode();
  }

  function syncHubMode() {
    $("rm-hub-scenarios")?.classList.toggle("hidden", hubMode !== "scenarios");
    $("rm-hub-drive")?.classList.toggle("hidden", hubMode !== "drive");
    document.querySelectorAll(".rm-mode-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === hubMode);
    });
  }

  function renderDriveSetup() {
    const sel = $("rm-drive-theme");
    if (!sel || typeof CityGen === "undefined") return;
    sel.innerHTML = Object.entries(CityGen.THEME_MAP)
      .map(([id, t]) => `<option value="${id}">${escapeHtml(t.title)}</option>`)
      .join("");
    $("rm-drive-seed").textContent = String(driveSeed);

    const ticketSel = $("rm-drive-ticket");
    if (ticketSel) {
      const tickets = [];
      for (let i = 1; i <= 40; i++) {
        const qs = window.PDD?.byTicket?.(i) || [];
        if (qs.length) tickets.push(i);
      }
      ticketSel.innerHTML = tickets.length
        ? tickets.map((n) => `<option value="${n}">Билет ${n} (${window.PDD.byTicket(n).length} вопр.)</option>`).join("")
        : '<option value="1">Билет 1</option>';
    }
    syncDriveSourceUI();
  }

  function syncDriveSourceUI() {
    const src = $("rm-drive-source")?.value || "theme";
    $("rm-drive-theme-wrap")?.classList.toggle("hidden", src !== "theme");
    $("rm-drive-ticket-wrap")?.classList.toggle("hidden", src !== "ticket");
  }

  function ensureDrivePixi() {
    if (typeof PIXI === "undefined") throw new Error("PixiJS не загружен");
    const host = $("rm-drive-canvas-host");
    if (drivePixiApp) {
      host.innerHTML = "";
      host.appendChild(drivePixiApp.view);
      resizeDrivePixi();
      return;
    }
    drivePixiApp = new PIXI.Application({
      width: host.clientWidth || 640,
      height: host.clientHeight || 400,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(drivePixiApp.view);
    driveWorld = new PIXI.Container();
    drivePixiApp.stage.addChild(driveWorld);
    bindResize();
  }

  function resizeDrivePixi() {
    if (!drivePixiApp) return;
    const host = $("rm-drive-canvas-host");
    if (!host) return;
    drivePixiApp.renderer.resize(host.clientWidth || 640, host.clientHeight || 400);
    RoadMindDrive?.resize();
  }

  function showDriveQuiz(cp, resume) {
    const overlay = $("rm-drive-quiz");
    const card = $("rm-drive-quiz-card");
    const q = cp.questionId ? window.PDD?.getQuestion?.(cp.questionId) : window.PDD?.pickQuestion(cp.bankTopic);
    if (!q) {
      card.innerHTML = `<p><strong>${escapeHtml(RoadMindDrive.signLabel(cp.sign))}</strong></p><p class="muted">${escapeHtml(cp.label || "Чекпоинт пройден.")}</p><button type="button" class="btn btn-primary" id="rm-quiz-ok">Продолжить</button>`;
      overlay.classList.remove("hidden");
      $("rm-quiz-ok").onclick = () => { overlay.classList.add("hidden"); resume(); };
      return;
    }
    card.innerHTML =
      `<div class="rm-quiz-tag muted">${escapeHtml(cp.bankTopic)}</div>` +
      `<p class="rm-quiz-q">${escapeHtml(q.q)}</p>` +
      `<div class="rm-quiz-opts">` +
      q.options.map((opt, i) =>
        `<button type="button" class="btn rm-quiz-opt" data-i="${i}">${escapeHtml(opt)}</button>`
      ).join("") +
      `</div>` +
      `<div class="rm-quiz-feedback hidden" id="rm-quiz-feedback"></div>`;
    overlay.classList.remove("hidden");
    card.querySelectorAll(".rm-quiz-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.i, 10);
        const ok = q.correct.includes(i);
        card.querySelectorAll(".rm-quiz-opt").forEach((b) => (b.disabled = true));
        const fb = $("rm-quiz-feedback");
        fb.classList.remove("hidden");
        fb.innerHTML = ok
          ? `<span class="ok">✓ Верно</span> · ${escapeHtml((q.explanation || "").slice(0, 220))}${(q.explanation || "").length > 220 ? "…" : ""}`
          : `<span class="bad">✗ Неверно</span> · Правильно: ${q.correct.map((c) => escapeHtml(q.options[c])).join(", ")}`;
        setTimeout(() => { overlay.classList.add("hidden"); resume(); }, ok ? 1200 : 2200);
      });
    });
  }

  async function startDrive() {
    try {
      if (!window.PDD?.isReady?.()) {
        alert("Банк вопросов ещё загружается — подождите пару секунд.");
        return;
      }
      ensureDrivePixi();
      resizeDrivePixi();
      const src = $("rm-drive-source")?.value || "theme";
      let opts = { seed: driveSeed };
      if (src === "ticket" && window.ScenarioGen) {
        const ticket = Number($("rm-drive-ticket")?.value || 1);
        const plan = ScenarioGen.buildDrivePlan({ ticket, seed: driveSeed });
        opts = { theme: plan.theme, seed: plan.seed, checkpointDefs: plan.checkpoints };
        $("rm-drive-seed").textContent = String(plan.seed);
      } else {
        opts.theme = $("rm-drive-theme")?.value || "crossroads";
      }
      await RoadMindDrive.start(drivePixiApp, driveWorld, opts, {
        onCheckpoint: showDriveQuiz,
      });
      showScreen("drive");
    } catch (err) {
      console.error(err);
      alert(err.message || "Не удалось запустить поездку");
    }
  }

  function iconFor(name) {
    const map = {
      crossroads: "✛",
      pedestrian: "🚶",
      priority: "⬆",
      parking: "P",
    };
    return map[name] || "◉";
  }

  async function openTopic(topicId) {
    await loadIndex();
    currentTopic = index.topics.find((t) => t.id === topicId);
    if (!currentTopic) return;
    $("rm-list-title").textContent = currentTopic.title;
    const list = $("rm-scenario-list");
    const items = await Promise.all(currentTopic.scenarios.map(loadScenario));
    let extra = "";
    if (window.ScenarioGen && window.PDD?.isReady?.()) {
      extra =
        `<div class="rm-ticket-gen">` +
        `<label class="field stack">Сгенерировать из билета` +
        `<select id="rm-gen-ticket">${Array.from({ length: 40 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select></label>` +
        `<button type="button" class="btn btn-sm" id="rm-gen-scenario">▶ Сценарий из билета</button></div>`;
    }
    list.innerHTML = extra + items
      .map((s) => {
        const sp = scenarioProgress(s.id);
        const badge = sp ? (sp.success ? '<span class="rm-badge ok">✓</span>' : '<span class="rm-badge bad">✗</span>') : "";
        return (
          `<button type="button" class="rm-scenario-card" data-id="${s.id}">` +
          `<div class="rm-scenario-title">${badge}${escapeHtml(s.title)}</div>` +
          `<div class="muted rm-scenario-sub">${s.duration} сек · ${stars(s.difficulty)}</div>` +
          `</button>`
        );
      })
      .join("");
    list.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => startScenario(btn.dataset.id));
    });
    $("rm-gen-scenario")?.addEventListener("click", () => {
      const ticket = Number($("rm-gen-ticket")?.value || 1);
      const sc = ScenarioGen.generateScenarioFromTicket(ticket);
      if (!sc) { alert("Не удалось сгенерировать сценарий"); return; }
      startGeneratedScenario(sc);
    });
    showScreen("list");
  }

  function startGeneratedScenario(scenario) {
    currentScenario = scenario;
    $("rm-brief").textContent = scenario.brief;
    ensurePixi();
    resizePixi();
    drawScene(currentScenario);
    const actions = $("rm-actions");
    actions.innerHTML = scenario.decisions
      .map((d) => `<button type="button" class="btn rm-action-btn" data-decision="${d.id}">${escapeHtml(d.label)}</button>`)
      .join("");
    actions.querySelectorAll("[data-decision]").forEach((btn) => {
      btn.addEventListener("click", () => applyGeneratedDecision(btn.dataset.decision));
    });
    showScreen("play");
  }

  function applyGeneratedDecision(decisionId) {
    const scenario = currentScenario;
    const outcome = scenario.outcomes[decisionId];
    if (!outcome) return;
    $("rm-actions").querySelectorAll("button").forEach((b) => (b.disabled = true));
    playEvents(outcome.events, () => {
      setTimeout(() => showGeneratedDebrief(decisionId, outcome), 600);
    });
  }

  function showGeneratedDebrief(decisionId, outcome) {
    const scenario = currentScenario;
    const ok = !!outcome.success;
    const card = $("rm-debrief-card");
    card.innerHTML =
      `<div class="rm-debrief-result ${ok ? "ok" : "bad"}">${escapeHtml(outcome.title)}</div>` +
      `<p>${escapeHtml(outcome.detail)}</p>` +
      (scenario.explanation ? `<p class="muted">${escapeHtml(scenario.explanation)}</p>` : "") +
      `<div class="rm-debrief-actions">` +
      `<button type="button" class="btn" id="rm-retry">Ещё раз</button>` +
      `<button type="button" class="btn btn-primary" id="rm-next">К теме</button>` +
      `</div>`;
    $("rm-retry").addEventListener("click", () => startGeneratedScenario(scenario));
    $("rm-next").addEventListener("click", () => openTopic(currentTopic?.id || scenario.topic));
    showScreen("debrief");
  }

  function ensurePixi() {
    if (typeof PIXI === "undefined") {
      throw new Error("PixiJS не загружен. Обновите страницу (Ctrl+Shift+R).");
    }
    const host = $("rm-canvas-host");
    if (pixiApp) {
      host.innerHTML = "";
      host.appendChild(pixiApp.view);
      return;
    }
    pixiApp = new PIXI.Application({
      width: host.clientWidth || 640,
      height: host.clientHeight || 360,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(pixiApp.view);
    world = new PIXI.Container();
    pixiApp.stage.addChild(world);
    bindResize();
  }

  function resizePixi() {
    if (mode === "drive") {
      resizeDrivePixi();
      return;
    }
    if (!pixiApp) return;
    const host = $("rm-canvas-host");
    if (!host) return;
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 360;
    pixiApp.renderer.resize(w, h);
    if (currentScenario) {
      drawScene(currentScenario);
      centerCamera();
    }
  }

  function hexColor(c) {
    if (typeof c === "number") return c;
    return parseInt(String(c || "#3b82f6").replace("#", ""), 16) || 0x3b82f6;
  }

  function isRoadTile(x, y) {
    return (x >= ROAD.x0 && x < ROAD.x1) || (y >= ROAD.y0 && y < ROAD.y1);
  }

  function roadRect() {
    return {
      x0: ROAD.x0 * TILE,
      y0: ROAD.y0 * TILE,
      w: (ROAD.x1 - ROAD.x0) * TILE,
      h: (ROAD.y1 - ROAD.y0) * TILE,
      cx: ((ROAD.x0 + ROAD.x1) / 2) * TILE,
      cy: ((ROAD.y0 + ROAD.y1) / 2) * TILE,
    };
  }

  function drawGrassAndBlocks(g) {
    g.clear();
    const W = MAP_W * TILE;
    const H = MAP_H * TILE;
    const r = roadRect();

    g.beginFill(C.grass);
    g.drawRect(0, 0, W, H);
    g.endFill();

    for (let i = 0; i < 24; i++) {
      const px = ((i * 97) % 13) * TILE * 0.85;
      const py = ((i * 53) % 11) * TILE * 0.9;
      if (px > r.x0 - TILE && px < r.x0 + r.w + TILE && py > r.y0 - TILE && py < r.y0 + r.h + TILE) continue;
      g.beginFill(C.grassDark, 0.35);
      g.drawCircle(px + 18, py + 14, 22 + (i % 5) * 4);
      g.endFill();
    }

    const blocks = [
      { x: 0.6, y: 0.6, w: 3.8, h: 3.6 },
      { x: 10.6, y: 0.5, w: 4.2, h: 3.8 },
      { x: 0.5, y: 10.4, w: 3.9, h: 4.5 },
      { x: 10.5, y: 10.2, w: 4.5, h: 4.8 },
      { x: 0.7, y: 5.2, w: 3.6, h: 2.8 },
      { x: 10.8, y: 5.1, w: 3.8, h: 2.9 },
      { x: 5.1, y: 0.6, w: 2.8, h: 3.5 },
      { x: 5.0, y: 10.7, w: 2.9, h: 4.3 },
    ];

    blocks.forEach((b, i) => {
      const px = b.x * TILE;
      const py = b.y * TILE;
      const bw = b.w * TILE;
      const bh = b.h * TILE;
      g.lineStyle(0);
      g.beginFill(C.buildingEdge, 0.55);
      g.drawRoundedRect(px + 3, py + 5, bw - 4, bh - 4, 10);
      g.endFill();
      g.beginFill(C.building);
      g.drawRoundedRect(px, py, bw - 6, bh - 6, 10);
      g.endFill();

      const cols = Math.max(2, Math.floor(bw / 28));
      const rows = Math.max(2, Math.floor(bh / 28));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if ((row + col + i) % 3 === 0) continue;
          g.beginFill(C.buildingWindow, 0.85);
          g.drawRoundedRect(
            px + 10 + col * (bw / cols),
            py + 10 + row * (bh / rows),
            Math.min(14, bw / cols - 10),
            Math.min(10, bh / rows - 8),
            2
          );
          g.endFill();
        }
      }
    });

    const trees = [
      [1.2, 1.4], [2.8, 2.1], [12.1, 1.8], [13.4, 3.2],
      [1.5, 12.5], [3.1, 13.8], [11.9, 12.2], [13.2, 14.1],
      [2.2, 6.8], [12.8, 6.5], [6.8, 1.3], [7.2, 13.5],
    ];
    trees.forEach(([tx, ty]) => {
      if (isRoadTile(Math.floor(tx), Math.floor(ty))) return;
      drawTree(g, tx * TILE, ty * TILE);
    });
  }

  function drawTree(g, x, y) {
    g.lineStyle(0);
    g.beginFill(C.grassShadow, 0.4);
    g.drawEllipse(x, y + 8, 11, 5);
    g.endFill();
    g.beginFill(C.treeTrunk);
    g.drawRoundedRect(x - 2, y + 2, 4, 8, 2);
    g.endFill();
    g.beginFill(C.treeDark);
    g.drawCircle(x - 4, y - 2, 9);
    g.drawCircle(x + 5, y - 3, 8);
    g.endFill();
    g.beginFill(C.tree);
    g.drawCircle(x, y - 6, 10);
    g.endFill();
  }

  function drawRoadSurface(g) {
    const r = roadRect();
    const curb = 5;
    const sw = 7;

    g.lineStyle(0);
    g.beginFill(C.sidewalk);
    g.drawRect(r.x0 - sw, 0, r.w + sw * 2, MAP_H * TILE);
    g.drawRect(0, r.y0 - sw, MAP_W * TILE, r.h + sw * 2);
    g.endFill();

    g.beginFill(C.asphalt);
    g.drawRect(r.x0, 0, r.w, MAP_H * TILE);
    g.drawRect(0, r.y0, MAP_W * TILE, r.h);
    g.endFill();

    g.beginFill(C.asphaltLight, 0.45);
    g.drawRect(r.x0 + 4, r.y0 + 4, r.w - 8, r.h - 8);
    g.endFill();

    g.lineStyle(curb, C.curb, 1);
    g.drawRect(r.x0 - curb / 2, 0, r.w + curb, MAP_H * TILE);
    g.drawRect(0, r.y0 - curb / 2, MAP_W * TILE, r.h + curb);
  }

  function dashedLine(g, x1, y1, x2, y2, dash, gap) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    let dist = 0;
    while (dist < len) {
      const seg = Math.min(dash, len - dist);
      g.moveTo(x1 + ux * dist, y1 + uy * dist);
      g.lineTo(x1 + ux * (dist + seg), y1 + uy * (dist + seg));
      dist += dash + gap;
    }
  }

  function drawLaneMarkings(g) {
    const r = roadRect();
    const dash = 16;
    const gap = 12;
    const laneX1 = (ROAD.x0 + 1) * TILE;
    const laneX2 = (ROAD.x1 - 1) * TILE;
    const laneY1 = (ROAD.y0 + 1) * TILE;
    const laneY2 = (ROAD.y1 - 1) * TILE;

    g.lineStyle(2.5, C.marking, 0.9);

    for (let y = 0; y < MAP_H * TILE; y += dash + gap) {
      if (y > r.y0 - 8 && y < r.y0 + r.h + 8) continue;
      dashedLine(g, laneX1, y, laneX1, y + dash, dash, gap);
      dashedLine(g, laneX2, y, laneX2, y + dash, dash, gap);
    }
    for (let x = 0; x < MAP_W * TILE; x += dash + gap) {
      if (x > r.x0 - 8 && x < r.x0 + r.w + 8) continue;
      dashedLine(g, x, laneY1, x + dash, laneY1, dash, gap);
      dashedLine(g, x, laneY2, x + dash, laneY2, dash, gap);
    }

    g.lineStyle(3.5, C.yellow, 0.92);
    dashedLine(g, r.cx, 0, r.cx, r.y0 - 6, dash, gap);
    dashedLine(g, r.cx, r.y0 + r.h + 6, r.cx, MAP_H * TILE, dash, gap);
    dashedLine(g, 0, r.cy, r.x0 - 6, r.cy, dash, gap);
    dashedLine(g, r.x0 + r.w + 6, r.cy, MAP_W * TILE, r.cy, dash, gap);

    g.lineStyle(5, C.marking, 0.98);
    const stopY = 11 * TILE;
    g.moveTo((ROAD.x0 + 0.15) * TILE, stopY);
    g.lineTo((ROAD.x1 - 0.15) * TILE, stopY);
    g.moveTo((ROAD.x0 + 0.15) * TILE, r.y0 + r.h - 8);
    g.lineTo((ROAD.x1 - 0.15) * TILE, r.y0 + r.h - 8);
    g.moveTo(r.x0 + 8, (ROAD.y0 + 0.15) * TILE);
    g.lineTo(r.x0 + 8, (ROAD.y1 - 0.15) * TILE);
    g.moveTo(r.x0 + r.w - 8, (ROAD.y0 + 0.15) * TILE);
    g.lineTo(r.x0 + r.w - 8, (ROAD.y1 - 0.15) * TILE);
  }

  function drawCrosswalk(g, atY) {
    const y = (atY ?? 7.5) * TILE;
    const x0 = 6.2 * TILE;
    const x1 = 8.8 * TILE;
    g.lineStyle(0);
    g.beginFill(C.marking, 0.92);
    for (let x = x0; x < x1; x += 10) {
      g.drawRect(x, y - TILE * 0.35, 6, TILE * 0.7);
    }
    g.endFill();
  }

  function drawTrafficLight(g, state) {
    const x = 9.2 * TILE;
    const y = 5.8 * TILE;
    g.lineStyle(0);
    g.beginFill(0x64748b);
    g.drawRect(x - 3, y, 6, 28);
    g.endFill();
    g.beginFill(0x1e293b);
    g.drawRoundedRect(x - 10, y - 4, 20, 52, 6);
    g.endFill();
    const colors = state === "green"
      ? [0x334155, 0x334155, 0x22c55e]
      : [0xef4444, 0xfacc15, 0x334155];
    [0, 1, 2].forEach((i) => {
      g.beginFill(colors[i]);
      g.drawCircle(x, y + 8 + i * 16, 6);
      g.endFill();
    });
  }

  function drawStopSign(g) {
    const x = 4.3 * TILE;
    const y = 10.8 * TILE;
    g.lineStyle(0);
    g.beginFill(0xdc2626);
    const r = 14;
    g.drawPolygon([
      x, y - r, x + r * 0.7, y - r * 0.7, x + r, y,
      x + r * 0.7, y + r * 0.7, x, y + r,
      x - r * 0.7, y + r * 0.7, x - r, y,
      x - r * 0.7, y - r * 0.7,
    ]);
    g.endFill();
    g.beginFill(C.marking);
    g.drawRect(x - 1, y - 10, 2, 20);
    g.endFill();
  }

  function drawCityBase(g) {
    drawGrassAndBlocks(g);
    drawRoadSurface(g);
    drawLaneMarkings(g);
  }

  function drawMapExtras(g, map) {
    if (!map) return;
    if (map.type === "crosswalk") drawCrosswalk(g, 7.5);
    if (map.type === "stopline" || map.signs?.includes("stop")) drawStopSign(g);
    if (map.signs?.includes("yield")) {
      g.lineStyle(0);
      g.beginFill(C.yellow);
      g.moveTo(4.4 * TILE, 8.2 * TILE);
      g.lineTo(4.4 * TILE, 9.2 * TILE);
      g.lineTo(4.9 * TILE, 8.7 * TILE);
      g.closePath();
      g.endFill();
    }
    if (map.trafficLight) drawTrafficLight(g, map.trafficLight);
  }

  function makeCar(color, isPlayer) {
    const c = new PIXI.Container();
    const col = hexColor(color);

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0f172a, 0.18);
    shadow.drawEllipse(0, 5, 18, 10);
    shadow.endFill();
    c.addChild(shadow);

    const body = new PIXI.Graphics();
    body.beginFill(col);
    body.drawRoundedRect(-11, -18, 22, 36, 6);
    body.endFill();

    body.beginFill(0xffffff, 0.22);
    body.drawRoundedRect(-9, -15, 18, 8, 3);
    body.endFill();

    body.beginFill(0x1e293b, 0.65);
    body.drawRoundedRect(-9, 6, 18, 6, 2);
    body.endFill();

    const wheel = 0x111827;
    [[-10, -10], [10, -10], [-10, 10], [10, 10]].forEach(([wx, wy]) => {
      body.beginFill(wheel);
      body.drawRoundedRect(wx - 2, wy - 3.5, 4, 7, 1.5);
      body.endFill();
    });

    body.beginFill(0xfef08a, 0.85);
    body.drawRoundedRect(-8, -17, 5, 3, 1);
    body.drawRoundedRect(3, -17, 5, 3, 1);
    body.endFill();

    body.beginFill(0xf87171, 0.85);
    body.drawRoundedRect(-8, 14, 5, 2.5, 1);
    body.drawRoundedRect(3, 14, 5, 2.5, 1);
    body.endFill();

    c.addChild(body);

    if (isPlayer) {
      const ring = new PIXI.Graphics();
      ring.lineStyle(3, 0x2563eb, 0.55);
      ring.drawRoundedRect(-15, -22, 30, 44, 8);
      ring.lineStyle(1.5, 0xffffff, 0.35);
      ring.drawRoundedRect(-15, -22, 30, 44, 8);
      c.addChild(ring);
    }
    return c;
  }

  function makePed(color) {
    const c = new PIXI.Container();
    const col = hexColor(color || "#22c55e");
    const g = new PIXI.Graphics();
    g.beginFill(0x000000, 0.15);
    g.drawEllipse(0, 6, 8, 4);
    g.endFill();
    g.beginFill(col);
    g.drawCircle(0, -6, 5);
    g.drawRoundedRect(-4, 0, 8, 12, 3);
    g.endFill();
    g.beginFill(0x1e293b);
    g.drawRect(-5, 10, 4, 5);
    g.drawRect(1, 10, 4, 5);
    g.endFill();
    c.addChild(g);
    return c;
  }

  function drawScene(scenario) {
    if (!world) return;
    world.removeChildren();
    sprites.clear();

    const mapLayer = new PIXI.Container();
    const base = new PIXI.Graphics();
    drawCityBase(base);
    drawMapExtras(base, scenario.map);
    mapLayer.addChild(base);

    const vignette = new PIXI.Graphics();
    const W = MAP_W * TILE;
    const H = MAP_H * TILE;
    vignette.beginFill(0x0f172a, 0.06);
    vignette.drawRect(0, 0, W, 8);
    vignette.drawRect(0, H - 8, W, 8);
    vignette.drawRect(0, 0, 8, H);
    vignette.drawRect(W - 8, 0, 8, H);
    vignette.endFill();
    mapLayer.addChild(vignette);

    const objectsLayer = new PIXI.Container();
    for (const obj of scenario.objects) {
      const isPlayer = obj.role === "player";
      const sp = obj.type === "pedestrian" ? makePed(obj.color) : makeCar(obj.color, isPlayer);
      sp.x = obj.x * TILE;
      sp.y = obj.y * TILE;
      sp.rotation = obj.heading || 0;
      objectsLayer.addChild(sp);
      sprites.set(obj.id, { sprite: sp, obj });
    }

    world.addChild(mapLayer);
    world.addChild(objectsLayer);
    centerCamera();
  }

  function centerCamera() {
    if (!pixiApp || !world) return;
    const r = roadRect();
    const cx = r.cx;
    const cy = r.cy + TILE * 0.5;
    const mapSize = MAP_W * TILE;
    const scale = Math.min(
      pixiApp.screen.width / (mapSize * 0.68),
      pixiApp.screen.height / (mapSize * 0.68),
      2.4
    );
    world.scale.set(scale);
    world.x = pixiApp.screen.width / 2 - cx * scale;
    world.y = pixiApp.screen.height / 2 - cy * scale;
  }

  async function startScenario(id) {
    try {
      currentScenario = await loadScenario(id);
      $("rm-brief").textContent = currentScenario.brief;
      ensurePixi();
      resizePixi();
      drawScene(currentScenario);

      const actions = $("rm-actions");
      actions.innerHTML = currentScenario.decisions
        .map(
          (d) =>
            `<button type="button" class="btn rm-action-btn" data-decision="${d.id}">${escapeHtml(d.label)}</button>`
        )
        .join("");
      actions.querySelectorAll("[data-decision]").forEach((btn) => {
        btn.addEventListener("click", () => applyDecision(btn.dataset.decision));
      });
      showScreen("play");
    } catch (err) {
      console.error(err);
      alert(err.message || "Не удалось запустить сценарий");
    }
  }

  function tweenSprite(id, to, duration, onDone) {
    const entry = sprites.get(id);
    if (!entry) {
      onDone?.();
      return;
    }
    const sp = entry.sprite;
    const fromX = sp.x;
    const fromY = sp.y;
    const toX = to.x * TILE;
    const toY = to.y * TILE;
    let t = 0;
    const tick = () => {
      t += pixiApp.ticker.deltaMS;
      const p = Math.min(1, t / duration);
      const e = 1 - Math.pow(1 - p, 3);
      sp.x = fromX + (toX - fromX) * e;
      sp.y = fromY + (toY - fromY) * e;
      if (p >= 1) {
        pixiApp.ticker.remove(tick);
        onDone?.();
      }
    };
    pixiApp.ticker.add(tick);
  }

  function flashCrash() {
    const flash = new PIXI.Graphics();
    flash.beginFill(0xef4444, 0.45);
    flash.drawRect(-5000, -5000, 10000, 10000);
    flash.endFill();
    world.addChild(flash);
    setTimeout(() => world.removeChild(flash), 400);
  }

  function playEvents(events, done) {
    if (!events?.length) {
      done();
      return;
    }
    let i = 0;
    const next = () => {
      const ev = events[i++];
      if (!ev) return done();
      if (ev.type === "move") {
        tweenSprite(ev.id, ev.to, 800, next);
      } else if (ev.type === "crash") {
        flashCrash();
        setTimeout(next, 500);
      } else if (ev.type === "near_miss") {
        const entry = sprites.get(ev.id);
        if (entry) {
          entry.sprite.alpha = 0.5;
          setTimeout(() => { entry.sprite.alpha = 1; next(); }, 400);
        } else next();
      } else next();
    };
    next();
  }

  function applyDecision(decisionId) {
    const scenario = currentScenario;
    const outcome = scenario.outcomes[decisionId];
    if (!outcome) return;

    $("rm-actions").querySelectorAll("button").forEach((b) => (b.disabled = true));

    playEvents(outcome.events, () => {
      setTimeout(() => showDebrief(decisionId, outcome), 600);
    });
  }

  function showDebrief(decisionId, outcome) {
    const scenario = currentScenario;
    const ok = !!outcome.success;
    const rec = progress["s:" + scenario.id] || { tries: 0, success: false };
    rec.tries++;
    if (ok) rec.success = true;
    progress["s:" + scenario.id] = rec;

    const tp = topicProgress(scenario.topic);
    if (!tp.ids) tp.ids = {};
    if (!tp.ids[scenario.id]) {
      tp.ids[scenario.id] = true;
      tp.done = Object.keys(tp.ids).length;
    }
    if (ok) tp.ok = (tp.ok || 0) + 1;
    tp.best = Math.max(tp.best || 0, ok ? 100 : 0);
    progress[scenario.topic] = tp;
    saveProgress();

    const card = $("rm-debrief-card");
    card.innerHTML =
      `<div class="rm-debrief-result ${ok ? "ok" : "bad"}">${escapeHtml(outcome.title)}</div>` +
      `<p>${escapeHtml(outcome.detail)}</p>` +
      `<div class="rm-debrief-rule"><strong>ПДД п. ${escapeHtml(scenario.rule)}</strong></div>` +
      `<p class="muted">${escapeHtml(scenario.explanation)}</p>` +
      `<div class="rm-debrief-actions">` +
      `<button type="button" class="btn" id="rm-retry">Ещё раз</button>` +
      `<button type="button" class="btn btn-primary" id="rm-next">К теме</button>` +
      `</div>`;

    $("rm-retry").addEventListener("click", () => startScenario(scenario.id));
    $("rm-next").addEventListener("click", () => openTopic(scenario.topic));
    showScreen("debrief");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  $("rm-back-topics")?.addEventListener("click", renderHub);

  $("rm-mode-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".rm-mode-tab");
    if (!tab) return;
    hubMode = tab.dataset.mode || "scenarios";
    syncHubMode();
  });

  $("rm-drive-reroll")?.addEventListener("click", () => {
    driveSeed = Math.floor(Math.random() * 1e6);
    renderDriveSetup();
  });

  $("rm-drive-source")?.addEventListener("change", syncDriveSourceUI);

  $("rm-drive-start")?.addEventListener("click", () => startDrive());

  $("rm-drive-exit")?.addEventListener("click", () => {
    RoadMindDrive?.stop();
    renderHub();
  });

  window.RoadMind = {
    init: renderHub,
    resize: resizePixi,
    onShow: () => {
      if (screen === "hub") renderHub();
      else resizePixi();
    },
  };
})();
