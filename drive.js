// RoadMind — режим поездки по процедурному городу

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const INPUT = { up: false, down: false, left: false, right: false, brake: false };

  let pixiApp = null;
  let world = null;
  let city = null;
  let player = null;
  let playerSprite = null;
  let aiSprites = [];
  let running = false;
  let zoom = 1.35;
  let checkpointIdx = 0;
  let paused = false;
  let onCheckpoint = null;
  let inputBound = false;
  let violations = [];
  let violationToast = null;
  let violationToastTimer = 0;
  let prevPlayer = { x: 0, y: 0 };
  let stopLinePassed = new Set();
  let redLightTripped = new Set();
  let pedSprites = [];
  let hudViolationEl = null;
  let tlGfx = [];
  let speedViolCd = 0;

  function makeCar(color, isPlayer) {
    if (window.Sprites?.ready) return Sprites.createCar(color, isPlayer);
    const c = new PIXI.Container();
    const col = parseInt(String(color || "#3b82f6").replace("#", ""), 16) || 0x3b82f6;
    const body = new PIXI.Graphics();
    body.beginFill(col);
    body.drawRoundedRect(-11, -18, 22, 36, 6);
    body.endFill();
    c.addChild(body);
    return c;
  }

  function bindInput() {
    if (inputBound) return;
    inputBound = true;
    const setKey = (e, down) => {
      if (paused) return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") INPUT.up = down;
      if (k === "s" || k === "arrowdown") INPUT.down = down;
      if (k === "a" || k === "arrowleft") INPUT.left = down;
      if (k === "d" || k === "arrowright") INPUT.right = down;
      if (k === " ") INPUT.brake = down;
    };
    window.addEventListener("keydown", (e) => {
      if (!running) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      setKey(e, true);
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => setKey(e, false));

    $("rm-drive-controls")?.querySelectorAll("[data-drive]").forEach((btn) => {
      const action = btn.dataset.drive;
      const down = () => { if (!paused) INPUT[action] = true; };
      const up = () => { INPUT[action] = false; };
      btn.addEventListener("pointerdown", (e) => { e.preventDefault(); down(); });
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
    });
  }

  function updateCamera() {
    if (!pixiApp || !world || !player) return;
    const T = city.tile;
    const mapW = city.size * T;
    const mapH = city.size * T;
    world.scale.set(zoom);
    const sx = pixiApp.screen.width;
    const sy = pixiApp.screen.height;
    let cx = sx / 2 - player.x * zoom;
    let cy = sy / 2 - player.y * zoom;
    cx = Math.min(0, Math.max(sx - mapW * zoom, cx));
    cy = Math.min(0, Math.max(sy - mapH * zoom, cy));
    world.x = cx;
    world.y = cy;
  }

  function kmh() {
    return Math.abs(player.speed * 0.12);
  }

  function recordViolation(type, message) {
    violations.push({ type, message, t: Date.now() });
    violationToast = message;
    violationToastTimer = 2.8;
    if (hudViolationEl) {
      hudViolationEl.textContent = violations.length + " наруш.";
      hudViolationEl.className = "badge badge-due rm-viol-badge flash";
    }
    const taskEl = $("rm-drive-task");
    if (taskEl && violationToastTimer > 0) {
      taskEl.dataset.violation = message;
    }
  }

  function drawTrafficLightGfx(g, tl) {
    g.clear();
    g.lineStyle(2, 0x334155, 1);
    g.beginFill(0x1e293b);
    g.drawRoundedRect(-5, -16, 10, 32, 3);
    g.endFill();
    const colors = { red: 0xef4444, yellow: 0xfbbf24, green: 0x22c55e };
    const lit = colors[tl.state] || colors.red;
    g.beginFill(lit, 0.95);
    g.drawCircle(0, tl.state === "green" ? 8 : -8, 4);
    g.endFill();
    g.beginFill(0x334155, 0.5);
    g.drawCircle(0, tl.state === "green" ? -8 : 8, 3);
    g.endFill();
  }

  function updateTrafficLights(dt) {
    (city.trafficLights || []).forEach((tl, i) => {
      tl.timer = (tl.timer || 0) + dt;
      const phase = tl.state === "red" ? 5.5 : 7;
      if (tl.timer >= phase) {
        tl.timer = 0;
        tl.state = tl.state === "red" ? "green" : "red";
      }
      const gfx = tlGfx[i];
      if (gfx) drawTrafficLightGfx(gfx, tl);
    });
  }

  function updatePedestrians(dt) {
    (city.pedestrians || []).forEach((ped, i) => {
      ped.t += ped.speed * dt * 0.008;
      const pos = CityGen.pedPosition(ped);
      const sp = pedSprites[i];
      if (sp) {
        sp.x = pos.x;
        sp.y = pos.y;
      }
    });
  }

  function checkViolations(dt) {
    if (!player || !city) return;
    const speed = kmh();
    const limit = CityGen.getSpeedLimit(city, player.x, player.y);

    if (speedViolCd > 0) speedViolCd -= dt;
    if (speed > limit + 8 && speedViolCd <= 0) {
      recordViolation("speed", `Скорость ${Math.round(speed)} км/ч (лимит ${limit})`);
      speedViolCd = 5;
    }

    (city.trafficLights || []).forEach((tl) => {
      if (tl.state !== "red") return;
      const d = Math.hypot(player.x - tl.x, player.y - tl.y);
      if (d < (tl.zone || 50) && speed > 6 && !redLightTripped.has(tl.id)) {
        redLightTripped.add(tl.id);
        recordViolation("red_light", "Проезд на красный сигнал");
      }
      if (d > (tl.zone || 50) * 2) redLightTripped.delete(tl.id);
    });

    (city.stopLines || []).forEach((sl) => {
      if (stopLinePassed.has(sl.id)) return;
      if (CityGen.segmentCrossed(prevPlayer.x, prevPlayer.y, player.x, player.y, sl.x, sl.y, sl.angle, sl.width / 2)) {
        stopLinePassed.add(sl.id);
        if (speed > 8) {
          recordViolation("stop", "Не остановились у линии «Стоп»");
        }
      }
    });

    (city.pedestrians || []).forEach((ped) => {
      const pos = CityGen.pedPosition(ped);
      const d = Math.hypot(player.x - pos.x, player.y - pos.y);
      if (d < 22 && speed > 12) {
        if (!ped._warned) {
          ped._warned = true;
          recordViolation("crosswalk", "Не уступили пешеходу на переходе");
        }
      } else if (d > 40) {
        ped._warned = false;
      }
    });
  }

  function makePedestrian() {
    const c = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.beginFill(0x0f172a, 0.2);
    g.drawEllipse(0, 5, 7, 3);
    g.endFill();
    g.beginFill(0xf97316);
    g.drawCircle(0, -4, 4);
    g.drawRoundedRect(-3, 0, 6, 9, 2);
    g.endFill();
    g.beginFill(0x1e293b);
    g.drawRect(-3, 8, 3, 4);
    g.drawRect(0, 8, 3, 4);
    g.endFill();
    c.addChild(g);
    return c;
  }

  function canDriveTo(px, py) {
    const r = 10;
    const checks = [
      [px, py],
      [px + Math.cos(player.angle) * r, py + Math.sin(player.angle) * r],
      [px - Math.sin(player.angle) * 8, py + Math.cos(player.angle) * 8],
      [px + Math.sin(player.angle) * 8, py - Math.cos(player.angle) * 8],
    ];
    for (const [x, y] of checks) {
      if (CityGen.isBlocked(city, x, y)) return false;
      if (!CityGen.isDriveable(city, x, y)) return false;
    }
    return true;
  }

  function updatePlayer(dt) {
    const accel = 220;
    const maxSpeed = 150;
    const turn = 2.8;
    const friction = 0.94;

    if (INPUT.up) player.speed += accel * dt;
    else if (INPUT.down) player.speed -= accel * 0.55 * dt;
    if (INPUT.brake) player.speed *= Math.pow(0.35, dt * 4);

    player.speed = Math.max(-maxSpeed * 0.35, Math.min(maxSpeed, player.speed));
    if (!INPUT.up && !INPUT.down) player.speed *= Math.pow(friction, dt * 60);

    if (Math.abs(player.speed) > 8) {
      const dir = player.speed > 0 ? 1 : -1;
      if (INPUT.left) player.angle -= turn * dir * dt;
      if (INPUT.right) player.angle += turn * dir * dt;
    }

    const nx = player.x + Math.cos(player.angle) * player.speed * dt;
    const ny = player.y + Math.sin(player.angle) * player.speed * dt;
    if (canDriveTo(nx, ny)) {
      player.x = nx;
      player.y = ny;
    } else {
      player.speed *= 0.3;
    }

    playerSprite.x = player.x;
    playerSprite.y = player.y;
    if (window.Sprites?.applyFacing) {
      Sprites.applyFacing(playerSprite, player.angle);
    } else {
      playerSprite.rotation = player.angle + Math.PI / 2;
    }
  }

  function updateAI(dt) {
    const T = city.tile;
    const mapW = city.size * T;
    const mapH = city.size * T;
    aiSprites.forEach(({ sprite, data }) => {
      data.x += Math.cos(data.heading) * data.speed * dt;
      data.y += Math.sin(data.heading) * data.speed * dt;
      if (data.x < T || data.x > mapW - T) data.heading = Math.PI - data.heading;
      if (data.y < T || data.y > mapH - T) data.heading = -data.heading;
      if (!CityGen.isDriveable(city, data.x, data.y)) data.heading += Math.PI;
      sprite.x = data.x;
      sprite.y = data.y;
      if (window.Sprites?.applyFacing) {
        Sprites.applyFacing(sprite, data.heading);
      } else {
        sprite.rotation = data.heading + Math.PI / 2;
      }
    });
  }

  function checkCheckpoints() {
    const cp = city.checkpoints[checkpointIdx];
    if (!cp) return;
    const T = city.tile;
    const dx = player.x - cp.x * T;
    const dy = player.y - cp.y * T;
    if (Math.hypot(dx, dy) < cp.radius * T) {
      paused = true;
      player.speed = 0;
      onCheckpoint?.(cp, () => {
        checkpointIdx++;
        paused = false;
        updateHud();
      });
    }
  }

  function updateHud() {
    const speedEl = $("rm-drive-speed");
    const taskEl = $("rm-drive-task");
    const progEl = $("rm-drive-progress");
    const limitEl = $("rm-drive-limit");
    if (speedEl) speedEl.textContent = Math.abs(Math.round(player.speed * 0.12)) + " км/ч";
    if (limitEl && city) limitEl.textContent = CityGen.getSpeedLimit(city, player.x, player.y) + " км/ч";
    const cp = city.checkpoints[checkpointIdx];
    if (taskEl) {
      if (violationToastTimer > 0 && violationToast) {
        taskEl.textContent = "⚠ " + violationToast;
        taskEl.classList.add("rm-viol-text");
      } else {
        taskEl.classList.remove("rm-viol-text");
        taskEl.textContent = cp
          ? `Чекпоинт: ${signLabel(cp.sign)}${cp.label ? " · " + cp.label : cp.bankTopic ? " · " + cp.bankTopic : ""}`
          : "Маршрут завершён — можно продолжать или выйти";
      }
    }
    if (progEl) progEl.textContent = `${Math.min(checkpointIdx, city.checkpoints.length)}/${city.checkpoints.length}`;
  }

  function signLabel(type) {
    return {
      stop: "Знак «Стоп»",
      yield: "Знак «Уступи дорогу»",
      speed: "Ограничение скорости",
      crosswalk: "Пешеходный переход",
      priority: "Главная дорога",
      no_parking: "Стоянка запрещена",
      parking: "Парковка",
      traffic_light: "Светофор",
      controller: "Регулировщик",
      railway: "Ж/д переезд",
    }[type] || "Дорожная ситуация";
  }

  function tick() {
    if (!running || paused) return;
    const dt = Math.min(0.05, pixiApp.ticker.deltaMS / 1000);
    prevPlayer.x = player.x;
    prevPlayer.y = player.y;
    updateTrafficLights(dt);
    updatePedestrians(dt);
    updatePlayer(dt);
    updateAI(dt);
    checkViolations(dt);
    if (violationToastTimer > 0) violationToastTimer -= dt;
    updateCamera();
    checkCheckpoints();
    updateHud();
  }

  function buildScene(worldContainer, cityData) {
    city = cityData;
    checkpointIdx = 0;
    paused = false;
    violations = [];
    violationToast = null;
    violationToastTimer = 0;
    speedViolCd = 0;
    stopLinePassed = new Set();
    redLightTripped = new Set();
    pedSprites = [];
    tlGfx = [];
    hudViolationEl = $("rm-violations");
    if (hudViolationEl) {
      hudViolationEl.textContent = "0 наруш.";
      hudViolationEl.className = "badge rm-viol-badge";
    }
    worldContainer.removeChildren();

    const mapLayer = new PIXI.Container();
    const mapGfx = new PIXI.Graphics();
    CityGen.render(mapGfx, city);
    mapLayer.addChild(mapGfx);

    const decorLayer = new PIXI.Container();
    if (window.Sprites?.ready) Sprites.decorateMap(decorLayer, city);
    mapLayer.addChild(decorLayer);

    const objectsLayer = new PIXI.Container();
    const hudLayer = new PIXI.Container();
    const T = city.tile;

    player = {
      x: city.spawn.x * T,
      y: city.spawn.y * T,
      angle: city.spawn.heading,
      speed: 0,
    };
    playerSprite = makeCar("#3b82f6", true);
    objectsLayer.addChild(playerSprite);

    aiSprites = city.traffic.map((t) => {
      const sp = makeCar(t.color, false);
      sp.x = t.x;
      sp.y = t.y;
      if (window.Sprites?.applyFacing) {
        Sprites.applyFacing(sp, t.heading);
      } else {
        sp.rotation = t.heading + Math.PI / 2;
      }
      objectsLayer.addChild(sp);
      return { sprite: sp, data: { ...t } };
    });

    pedSprites = (city.pedestrians || []).map((ped) => {
      const sp = makePedestrian();
      const pos = CityGen.pedPosition(ped);
      sp.x = pos.x;
      sp.y = pos.y;
      objectsLayer.addChild(sp);
      return sp;
    });

    tlGfx = (city.trafficLights || []).map((tl) => {
      const g = new PIXI.Graphics();
      g.x = tl.x;
      g.y = tl.y;
      drawTrafficLightGfx(g, tl);
      hudLayer.addChild(g);
      return g;
    });

    city.checkpoints.forEach((cp, i) => {
      const ring = new PIXI.Graphics();
      ring.lineStyle(2, i === checkpointIdx ? 0x2563eb : 0x94a3b8, 0.75);
      ring.drawCircle(cp.x * T, cp.y * T, cp.radius * T);
      hudLayer.addChild(ring);
    });

    worldContainer.addChild(mapLayer);
    worldContainer.addChild(objectsLayer);
    worldContainer.addChild(hudLayer);

    playerSprite.x = player.x;
    playerSprite.y = player.y;
    if (window.Sprites?.applyFacing) {
      Sprites.applyFacing(playerSprite, player.angle);
    } else {
      playerSprite.rotation = player.angle + Math.PI / 2;
    }
    updateCamera();
    updateHud();
  }

  async function start(app, worldContainer, options, callbacks) {
    stop();
    pixiApp = app;
    world = worldContainer;
    onCheckpoint = callbacks?.onCheckpoint;
    running = true;
    paused = false;

    if (window.Sprites) await Sprites.loadAll();

    const genOpts = {
      theme: options.theme || "crossroads",
      seed: options.seed,
      size: 28,
    };
    if (options.checkpointDefs?.length) genOpts.checkpointDefs = options.checkpointDefs;

    const cityData = CityGen.generate(genOpts);
    buildScene(worldContainer, cityData);
    app.ticker.add(tick);
    bindInput();
    return cityData;
  }

  function stop() {
    running = false;
    paused = false;
    if (pixiApp) pixiApp.ticker.remove(tick);
    INPUT.up = INPUT.down = INPUT.left = INPUT.right = INPUT.brake = false;
  }

  function resize() {
    updateCamera();
  }

  function setZoom(z) {
    zoom = Math.max(0.8, Math.min(2.2, z));
    updateCamera();
  }

  window.RoadMindDrive = { start, stop, resize, setZoom, signLabel, getViolations: () => violations.slice() };
})();
