// Проcedural city generator for RoadMind drive mode

(function () {
  "use strict";

  const TILE = 40;
  const CELL = {
    GRASS: 0,
    ROAD: 1,
    INTER: 2,
    SIDEWALK: 3,
    BUILDING: 4,
  };

  const C = {
    grass: 0xd8ead5,
    grassDark: 0xc8dfc4,
    asphalt: 0x6b7280,
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

  const THEME_MAP = {
    crossroads: {
      title: "Перекрёстки",
      bankTopics: ["Проезд перекрестков", "Начало движения, маневрирование"],
      signs: ["stop", "yield", "priority"],
      crosswalks: 0.35,
      traffic: 0.55,
    },
    pedestrians: {
      title: "Пешеходы",
      bankTopics: ["Пешеходные переходы и места остановок маршрутных транспортных средств"],
      signs: ["crosswalk", "school"],
      crosswalks: 0.85,
      traffic: 0.35,
    },
    signs: {
      title: "Дорожные знаки",
      bankTopics: ["Дорожные знаки", "Дорожная разметка"],
      signs: ["stop", "yield", "speed", "no_entry", "main_road", "parking"],
      crosswalks: 0.4,
      traffic: 0.45,
    },
    priority: {
      title: "Приоритет",
      bankTopics: ["Проезд перекрестков", "Приоритет маршрутных транспортных средств"],
      signs: ["yield", "priority", "roundabout"],
      crosswalks: 0.3,
      traffic: 0.65,
    },
    parking: {
      title: "Остановка и стоянка",
      bankTopics: ["Остановка и стоянка", "Движение в жилых зонах"],
      signs: ["stop", "no_parking", "parking"],
      crosswalks: 0.25,
      traffic: 0.3,
    },
    speed: {
      title: "Скорость",
      bankTopics: ["Скорость движения", "Движение по автомагистралям"],
      signs: ["speed", "speed_min", "main_road"],
      crosswalks: 0.2,
      traffic: 0.5,
    },
    signals: {
      title: "Светофор и регулировщик",
      bankTopics: ["Сигналы светофора и регулировщика", "Дорожные знаки"],
      signs: ["stop", "yield"],
      crosswalks: 0.45,
      traffic: 0.5,
      features: ["traffic_light", "controller"],
    },
    railway: {
      title: "Ж/д переезд",
      bankTopics: ["Движение через железнодорожные пути"],
      signs: ["stop", "yield"],
      crosswalks: 0.1,
      traffic: 0.25,
      features: ["railway"],
    },
  };

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function streetBands(size) {
    const bands = [];
    for (let i = 2; i < size - 3; i += 6) {
      bands.push(i, i + 1, i + 2);
    }
    return bands;
  }

  function inBand(v, bands) {
    return bands.includes(v);
  }

  function generate(options) {
    const themeId = options.theme || "crossroads";
    const theme = THEME_MAP[themeId] || THEME_MAP.crossroads;
    const size = options.size || 28;
    const seed = options.seed ?? Math.floor(Math.random() * 1e9);
    const rnd = mulberry32(seed);
    const vBands = streetBands(size);
    const hBands = streetBands(size);
    const grid = Array.from({ length: size }, () => Array(size).fill(CELL.GRASS));

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const vr = inBand(x, vBands);
        const hr = inBand(y, hBands);
        if (vr && hr) grid[y][x] = CELL.INTER;
        else if (vr || hr) grid[y][x] = CELL.ROAD;
        else if (vr || hr || inBand(x - 1, vBands) || inBand(x + 1, vBands) || inBand(y - 1, hBands) || inBand(y + 1, hBands)) {
          grid[y][x] = CELL.SIDEWALK;
        } else {
          grid[y][x] = CELL.BUILDING;
        }
      }
    }

    const intersections = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid[y][x] === CELL.INTER) intersections.push({ x, y });
      }
    }

    const signs = [];
    const crosswalks = [];
    const shuffled = intersections.slice().sort(() => rnd() - 0.5);
    const pick = shuffled.slice(0, Math.max(4, Math.floor(intersections.length * 0.45)));

    pick.forEach((node, i) => {
      const signType = theme.signs[Math.floor(rnd() * theme.signs.length)];
      const approach = Math.floor(rnd() * 4);
      const px = (node.x + 0.5) * TILE;
      const py = (node.y + 0.5) * TILE;
      const offset = 2.1 * TILE;
      const pos = [
        { x: px, y: py - offset, rot: 0 },
        { x: px + offset, y: py, rot: Math.PI / 2 },
        { x: px, y: py + offset, rot: Math.PI },
        { x: px - offset, y: py, rot: -Math.PI / 2 },
      ][approach];
      signs.push({ type: signType, x: pos.x, y: pos.y, rot: pos.rot, node });

      if (rnd() < theme.crosswalks) {
        const cwApproach = (approach + 1) % 4;
        const cw = [
          { x: px, y: py - offset * 0.55, dir: "h" },
          { x: px + offset * 0.55, y: py, dir: "v" },
          { x: px, y: py + offset * 0.55, dir: "h" },
          { x: px - offset * 0.55, y: py, dir: "v" },
        ][cwApproach];
        crosswalks.push(cw);
      }
    });

    const spawnCol = vBands[Math.floor(vBands.length / 2)] ?? vBands[0];
    const spawn = { x: spawnCol + 0.5, y: size - 2.5, heading: -Math.PI / 2 };

    const checkpoints = [];
    const routeNodes = pick.slice(0, 4);
    if (options.checkpointDefs?.length) {
      options.checkpointDefs.forEach((def, i) => {
        const node = routeNodes[i] || pick[i % pick.length];
        if (!node) return;
        checkpoints.push({
          ...def,
          id: def.id || "cp" + i,
          x: node.x + 0.5,
          y: node.y + 0.5,
          radius: 1.4,
          sign: def.sign || signs[i]?.type || theme.signs[0],
        });
      });
    } else {
      routeNodes.forEach((node, i) => {
        checkpoints.push({
          id: "cp" + i,
          x: node.x + 0.5,
          y: node.y + 0.5,
          radius: 1.4,
          bankTopic: theme.bankTopics[i % theme.bankTopics.length],
          sign: signs[i]?.type || theme.signs[0],
        });
      });
    }

    const trafficLights = [];
    const controllers = [];
    let railway = null;

    const wantSignals = themeId === "signals" || theme.features?.includes("traffic_light");
    const wantController = themeId === "signals" || theme.features?.includes("controller");
    const wantRailway = themeId === "railway" || theme.features?.includes("railway");
    const addLights = wantSignals || themeId === "crossroads" || themeId === "priority";

    if (addLights) {
      const lightNodes = wantSignals ? pick.slice(0, 3) : pick.slice(0, Math.min(2, pick.length));
      lightNodes.forEach((node, i) => {
        const px = (node.x + 0.5) * TILE;
        const py = (node.y + 0.5) * TILE;
        trafficLights.push({
          id: "tl" + i,
          x: px,
          y: py - TILE * 0.65,
          node,
          state: rnd() > 0.4 ? "red" : "green",
          timer: rnd() * 4,
          zone: TILE * 1.35,
        });
      });
    }
    if (wantController && pick[0]) {
      controllers.push({
        x: (pick[0].x + 0.5) * TILE + 28,
        y: (pick[0].y + 0.5) * TILE,
      });
    }
    if (wantRailway) {
      const row = hBands[Math.floor(hBands.length / 2)] + 0.5;
      const col = vBands[Math.floor(vBands.length / 2)] + 0.5;
      railway = {
        x: (size * TILE) / 2,
        y: row * TILE,
        width: size * TILE,
        row,
        col,
      };
    }

    const traffic = [];
    if (rnd() < theme.traffic) {
      for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
        const vertical = rnd() > 0.5;
        const pos = roadPositionPixels(size, vBands, hBands, rnd, vertical);
        traffic.push({
          id: "ai" + i,
          x: pos.x,
          y: pos.y,
          heading: pos.heading,
          color: ["#ef4444", "#f59e0b", "#8b5cf6", "#64748b"][i % 4],
          speed: 55 + rnd() * 35,
        });
      }
    }

    const trees = [];
    for (let n = 0; n < 18; n++) {
      const x = Math.floor(rnd() * size);
      const y = Math.floor(rnd() * size);
      if (grid[y][x] === CELL.GRASS || grid[y][x] === CELL.BUILDING) {
        trees.push({ x: x + rnd(), y: y + rnd() });
      }
    }

    const stopLines = [];
    signs.forEach((sign, i) => {
      if (sign.type !== "stop") return;
      const nx = (sign.node.x + 0.5) * TILE;
      const ny = (sign.node.y + 0.5) * TILE;
      const t = 0.72;
      const lx = sign.x + (nx - sign.x) * t;
      const ly = sign.y + (ny - sign.y) * t;
      const angle = Math.atan2(ny - sign.y, nx - sign.x);
      stopLines.push({ id: "sl" + i, x: lx, y: ly, angle, width: TILE * 1.6, signId: i });
    });

    const speedZones = [];
    signs.forEach((sign, i) => {
      if (sign.type !== "speed" && sign.type !== "speed_min") return;
      speedZones.push({
        id: "sz" + i,
        x: sign.x,
        y: sign.y,
        radius: TILE * 4.5,
        limit: sign.type === "speed_min" ? 40 : 60,
      });
    });

    const pedestrians = [];
    crosswalks.forEach((cw, i) => {
      if (rnd() > 0.55) return;
      pedestrians.push({
        id: "ped" + i,
        x: cw.x,
        y: cw.y,
        dir: cw.dir,
        t: rnd(),
        speed: 18 + rnd() * 14,
        span: cw.dir === "h" ? 36 : 36,
      });
    });

    return {
      seed,
      themeId,
      theme,
      size,
      tile: TILE,
      grid,
      signs,
      crosswalks,
      stopLines,
      speedZones,
      pedestrians,
      defaultSpeedLimit: 60,
      spawn,
      checkpoints,
      traffic,
      trees,
      vBands,
      hBands,
      trafficLights,
      controllers,
      railway,
    };
  }

  function roadPositionPixels(size, vBands, hBands, rnd, vertical) {
    if (vertical) {
      const col = vBands[Math.floor(rnd() * vBands.length)] + 0.5;
      const y = (2 + rnd() * (size - 4)) * TILE;
      return {
        x: col * TILE,
        y,
        heading: rnd() > 0.5 ? -Math.PI / 2 : Math.PI / 2,
      };
    }
    const row = hBands[Math.floor(rnd() * hBands.length)] + 0.5;
    const x = (2 + rnd() * (size - 4)) * TILE;
    return {
      x,
      y: row * TILE,
      heading: rnd() > 0.5 ? 0 : Math.PI,
    };
  }

  function isRoadCell(city, x, y) {
    if (x < 0 || y < 0 || x >= city.size || y >= city.size) return false;
    const c = city.grid[y][x];
    return c === CELL.ROAD || c === CELL.INTER;
  }

  function isDriveable(city, wx, wy) {
    const x = Math.floor(wx / city.tile);
    const y = Math.floor(wy / city.tile);
    return isRoadCell(city, x, y);
  }

  function isBlocked(city, wx, wy) {
    const x = Math.floor(wx / city.tile);
    const y = Math.floor(wy / city.tile);
    if (x < 0 || y < 0 || x >= city.size || y >= city.size) return true;
    const c = city.grid[y][x];
    return c === CELL.BUILDING || c === CELL.GRASS;
  }

  function drawSign(g, sign) {
    const x = sign.x;
    const y = sign.y;
    g.lineStyle(0);
    switch (sign.type) {
      case "stop":
        g.beginFill(0xdc2626);
        g.drawPolygon([x, y - 12, x + 9, y - 9, x + 12, y, x + 9, y + 9, x, y + 12, x - 9, y + 9, x - 12, y, x - 9, y - 9]);
        g.endFill();
        break;
      case "yield":
        g.beginFill(C.yellow);
        g.moveTo(x - 10, y - 8);
        g.lineTo(x + 10, y - 8);
        g.lineTo(x, y + 10);
        g.closePath();
        g.endFill();
        break;
      case "speed":
        g.beginFill(C.yellow);
        g.drawCircle(x, y, 13);
        g.endFill();
        g.lineStyle(2, 0x111827, 1);
        g.drawCircle(x, y, 13);
        break;
      case "crosswalk":
        g.beginFill(C.marking, 0.9);
        for (let i = -3; i <= 3; i++) g.drawRect(x - 18, y + i * 5, 36, 3);
        g.endFill();
        break;
      case "no_parking":
        g.beginFill(C.yellow);
        g.drawCircle(x, y, 12);
        g.endFill();
        g.lineStyle(3, 0xdc2626, 1);
        g.moveTo(x - 8, y + 8);
        g.lineTo(x + 8, y - 8);
        break;
      case "parking":
        g.beginFill(C.yellow);
        g.drawRoundedRect(x - 11, y - 13, 22, 26, 3);
        g.endFill();
        break;
      default:
        g.beginFill(C.yellow);
        g.drawCircle(x, y, 11);
        g.endFill();
    }
    g.lineStyle(0);
    g.beginFill(0x64748b);
    g.drawRect(x - 1.5, y + 10, 3, 14);
    g.endFill();
  }

  function drawTree(g, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    g.beginFill(C.grassDark, 0.35);
    g.drawEllipse(px, py + 8, 10, 4);
    g.endFill();
    g.beginFill(C.treeTrunk);
    g.drawRoundedRect(px - 2, py + 2, 4, 7, 2);
    g.endFill();
    g.beginFill(C.treeDark);
    g.drawCircle(px - 3, py - 2, 8);
    g.drawCircle(px + 4, py - 3, 7);
    g.endFill();
    g.beginFill(C.tree);
    g.drawCircle(px, py - 5, 9);
    g.endFill();
  }

  function render(g, city) {
    g.clear();
    const T = city.tile;
    const W = city.size * T;
    const H = city.size * T;

    g.beginFill(C.grass);
    g.drawRect(0, 0, W, H);
    g.endFill();

    for (let y = 0; y < city.size; y++) {
      for (let x = 0; x < city.size; x++) {
        if (city.grid[y][x] !== CELL.BUILDING) continue;
        const px = x * T;
        const py = y * T;
        g.beginFill(C.buildingEdge, 0.5);
        g.drawRoundedRect(px + 3, py + 4, T - 5, T - 5, 5);
        g.endFill();
        g.beginFill(C.building);
        g.drawRoundedRect(px + 5, py + 5, T - 10, T - 10, 4);
        g.endFill();
        if ((x + y) % 3 !== 0) {
          g.beginFill(C.buildingWindow, 0.8);
          g.drawRoundedRect(px + 10, py + 10, 8, 6, 2);
          g.endFill();
        }
      }
    }

    g.lineStyle(0);
    g.beginFill(C.sidewalk);
    for (let y = 0; y < city.size; y++) {
      for (let x = 0; x < city.size; x++) {
        if (city.grid[y][x] === CELL.SIDEWALK) g.drawRect(x * T, y * T, T, T);
      }
    }
    g.endFill();

    g.beginFill(C.asphalt);
    for (let y = 0; y < city.size; y++) {
      for (let x = 0; x < city.size; x++) {
        const c = city.grid[y][x];
        if (c === CELL.ROAD || c === CELL.INTER) g.drawRect(x * T, y * T, T, T);
      }
    }
    g.endFill();

    g.beginFill(C.asphaltLight, 0.35);
    for (let y = 0; y < city.size; y++) {
      for (let x = 0; x < city.size; x++) {
        if (city.grid[y][x] === CELL.INTER) g.drawRect(x * T + 4, y * T + 4, T - 8, T - 8);
      }
    }
    g.endFill();

    g.lineStyle(2, C.marking, 0.85);
    city.vBands.forEach((bx) => {
      const cx = (bx + 0.5) * T;
      for (let y = 0; y < H; y += 26) {
        if (isNearInterRow(city, bx, y / T)) continue;
        g.moveTo(cx - 8, y);
        g.lineTo(cx - 8, y + 14);
        g.moveTo(cx + 8, y);
        g.lineTo(cx + 8, y + 14);
      }
    });
    city.hBands.forEach((by) => {
      const cy = (by + 0.5) * T;
      for (let x = 0; x < W; x += 26) {
        if (isNearInterCol(city, by, x / T)) continue;
        g.moveTo(x, cy - 8);
        g.lineTo(x + 14, cy - 8);
        g.moveTo(x, cy + 8);
        g.lineTo(x + 14, cy + 8);
      }
    });

    g.lineStyle(3, C.yellow, 0.9);
    city.vBands.forEach((bx, i) => {
      if (i % 2) return;
      const cx = (bx + 1) * T;
      dashedV(g, cx, 0, H, city);
    });
    city.hBands.forEach((by, i) => {
      if (i % 2) return;
      const cy = (by + 1) * T;
      dashedH(g, cy, 0, W, city);
    });

    city.crosswalks.forEach((cw) => {
      g.lineStyle(0);
      g.beginFill(C.marking, 0.95);
      const stripes = 7;
      if (cw.dir === "h") {
        for (let i = -stripes; i <= stripes; i++) {
          g.drawRect(cw.x - 28, cw.y + i * 5 - 2, 56, 4);
        }
        g.beginFill(C.marking, 0.35);
        g.drawRect(cw.x - 30, cw.y - 10, 60, 20);
      } else {
        for (let i = -stripes; i <= stripes; i++) {
          g.drawRect(cw.x + i * 5 - 2, cw.y - 28, 4, 56);
        }
        g.beginFill(C.marking, 0.35);
        g.drawRect(cw.x - 10, cw.y - 30, 20, 60);
      }
      g.endFill();
    });

    (city.stopLines || []).forEach((sl) => {
      g.lineStyle(0);
      g.beginFill(C.marking, 0.98);
      const hw = sl.width / 2;
      const ca = Math.cos(sl.angle);
      const sa = Math.sin(sl.angle);
      const px = -sa * 5;
      const py = ca * 5;
      g.drawPolygon([
        sl.x + ca * hw + px, sl.y + sa * hw + py,
        sl.x - ca * hw + px, sl.y - sa * hw + py,
        sl.x - ca * hw - px, sl.y - sa * hw - py,
        sl.x + ca * hw - px, sl.y + sa * hw - py,
      ]);
      g.endFill();
    });

    city.trees.forEach((t) => drawTree(g, t.x, t.y));
  }

  function isNearInterRow(city, bx, y) {
    return city.hBands.some((hb) => Math.abs(hb - y) <= 1);
  }

  function isNearInterCol(city, by, x) {
    return city.vBands.some((vb) => Math.abs(vb - x) <= 1);
  }

  function dashedV(g, x, y0, y1, city) {
    for (let y = y0; y < y1; y += 24) {
      if (city.hBands.some((hb) => Math.abs(hb - y / city.tile) <= 1.5)) continue;
      g.moveTo(x, y);
      g.lineTo(x, y + 14);
    }
  }

  function dashedH(g, y, x0, x1, city) {
    for (let x = x0; x < x1; x += 24) {
      if (city.vBands.some((vb) => Math.abs(vb - x / city.tile) <= 1.5)) continue;
      g.moveTo(x, y);
      g.lineTo(x + 14, y);
    }
  }

  function getSpeedLimit(city, wx, wy) {
    let limit = city.defaultSpeedLimit || 60;
    (city.speedZones || []).forEach((z) => {
      if (Math.hypot(wx - z.x, wy - z.y) < z.radius) limit = z.limit;
    });
    return limit;
  }

  function segmentCrossed(ax, ay, bx, by, cx, cy, angle, halfW) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const la = (ax - cx) * cos + (ay - cy) * sin;
    const lb = (bx - cx) * cos + (by - cy) * sin;
    const pa = (-(ax - cx) * sin + (ay - cy) * cos);
    const pb = (-(bx - cx) * sin + (by - cy) * cos);
    if (Math.sign(la) === Math.sign(lb)) return false;
    const t = la / (la - lb);
    const perp = pa + t * (pb - pa);
    return Math.abs(perp) < halfW + 8;
  }

  function pedPosition(ped) {
    const off = Math.sin(ped.t * Math.PI * 2) * ped.span;
    return ped.dir === "h"
      ? { x: ped.x + off, y: ped.y }
      : { x: ped.x, y: ped.y + off };
  }

  window.CityGen = {
    TILE,
    CELL,
    THEME_MAP,
    generate,
    render,
    isRoadCell,
    isBlocked,
    isDriveable,
    getSpeedLimit,
    segmentCrossed,
    pedPosition,
  };
})();
