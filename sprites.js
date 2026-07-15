// Sprite loader for RoadMind (PixiJS): ГОСТ-знаки + Tiny Cars CC0

(function () {
  "use strict";

  const SVG_BASE = "assets/svg/";
  const CAR_DIR = "assets/packs/tiny-cars/64x64/";
  const CAR_FRAME = 64;
  const CAR_FRAMES = 8;

  const CAR_PALETTE = {
    player: "blue64a",
    blue: "blue64a",
    red: "red64a",
    orange: "orange64a",
    yellow: "yellow64a",
    green: "green64a",
    purple: "purple64a",
    white: "white64a",
    black: "black64a",
  };

  const SIGN_FALLBACK = {
    stop: "sign-stop",
    yield: "sign-yield",
    speed: "sign-speed",
    speed_min: "sign-speed",
    priority: "sign-priority",
    main_road: "sign-priority",
    crosswalk: "sign-yield",
    no_parking: "sign-stop",
    parking: "sign-speed",
    no_entry: "sign-stop",
    school: "sign-yield",
    roundabout: "sign-yield",
  };

  let signMap = {};
  let ready = false;
  let loading = null;
  const cache = new Map();
  const carSheets = new Map();
  const carFrameTex = new Map();

  async function loadSignMap() {
    try {
      const res = await fetch("assets/sign-map.json");
      const data = await res.json();
      signMap = { ...data };
      delete signMap._comment;
    } catch (e) {
      console.warn("sign-map.json:", e);
    }
  }

  async function loadTex(url, key) {
    const tex = await PIXI.Assets.load(url);
    cache.set(key, tex);
    return tex;
  }

  async function loadAll() {
    if (ready) return;
    if (loading) return loading;

    loading = (async () => {
      await loadSignMap();

      const misc = [
        "traffic-light.svg", "controller.svg", "railway.svg",
        "sign-stop.svg", "sign-yield.svg", "sign-speed.svg", "sign-priority.svg",
        "car.svg", "car-red.svg",
      ];
      await Promise.all(
        misc.map((f) => loadTex(SVG_BASE + f, f.replace(".svg", "")))
      );

      const gostPaths = new Set();
      Object.values(signMap).forEach((e) => {
        if (e?.file) gostPaths.add(e.file);
      });
      await Promise.all(
        [...gostPaths].map(async (file) => {
          const key = "gost:" + file.replace(/^gost\//, "").replace(/\.svg$/, "");
          try {
            await loadTex(SVG_BASE + file, key);
          } catch (err) {
            console.warn("GOST", file, err);
          }
        })
      );

      await Promise.all(
        Object.entries(CAR_PALETTE).map(async ([name, file]) => {
          try {
            const url = CAR_DIR + file + ".png";
            const tex = await PIXI.Assets.load(url);
            carSheets.set(name, tex);
            for (let i = 0; i < CAR_FRAMES; i++) {
              carFrameTex.set(
                `${name}:${i}`,
                new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(i * CAR_FRAME, 0, CAR_FRAME, CAR_FRAME))
              );
            }
          } catch (err) {
            console.warn("Car", file, err);
          }
        })
      );

      ready = true;
    })();

    return loading;
  }

  function tex(key) {
    return cache.get(key);
  }

  function angleToFrame(angle) {
    const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((a / (Math.PI * 2)) * CAR_FRAMES) % CAR_FRAMES;
  }

  function pickCarColor(color, isPlayer) {
    if (isPlayer) return "player";
    const s = String(color || "").toLowerCase();
    if (/ef4444|dc2626|f87171|e5484d/.test(s)) return "red";
    if (/f59e0b|fbbf24|d9a441/.test(s)) return "orange";
    if (/22c55e|4ade80|2f9e6e/.test(s)) return "green";
    if (/a855f7|9333ea/.test(s)) return "purple";
    if (/f8fafc|ffffff|e2e8f0/.test(s)) return "white";
    if (/111827|1e293b|0f172a/.test(s)) return "black";
    return "blue";
  }

  function carFrameTexFor(colorKey, frame) {
    return carFrameTex.get(`${colorKey}:${frame}`) || carFrameTex.get(`player:${frame}`);
  }

  function makeSprite(texture, scale) {
    const s = new PIXI.Sprite(texture);
    s.anchor.set(0.5, 0.5);
    if (scale) s.scale.set(scale);
    return s;
  }

  function sprite(name, scale = 0.55) {
    return makeSprite(tex(name) || tex("car"), scale);
  }

  function createCar(color, isPlayer) {
    const c = new PIXI.Container();
    const colorKey = pickCarColor(color, isPlayer);

    if (carSheets.has(colorKey)) {
      const body = new PIXI.Sprite(carFrameTexFor(colorKey, 0));
      body.anchor.set(0.5, 0.5);
      body.scale.set(0.72);
      c.addChild(body);
      c.setFacing = (angle) => {
        body.texture = carFrameTexFor(colorKey, angleToFrame(angle));
      };
    } else {
      const fb = pickCarColor(color, false) === "red" ? "car-red" : "car";
      c.addChild(sprite(fb, 0.62));
      c.setFacing = null;
    }

    if (isPlayer) {
      const ring = new PIXI.Graphics();
      ring.lineStyle(2, 0x2563eb, 0.5);
      ring.drawCircle(0, 0, 24);
      c.addChildAt(ring, 0);
    }
    return c;
  }

  function applyFacing(spriteContainer, angle) {
    if (spriteContainer?.setFacing) {
      spriteContainer.setFacing(angle);
    } else if (spriteContainer) {
      spriteContainer.rotation = angle + Math.PI / 2;
    }
  }

  function createSign(type) {
    const entry = signMap[type];
    if (entry?.file) {
      const key = "gost:" + entry.file.replace(/^gost\//, "").replace(/\.svg$/, "");
      const t = tex(key);
      if (t) return makeSprite(t, 0.05);
    }
    return sprite(SIGN_FALLBACK[type] || "sign-yield", 0.5);
  }

  function createTrafficLight(state) {
    const c = new PIXI.Container();
    c.addChild(sprite("traffic-light", 0.45));
    if (state === "red") {
      const overlay = new PIXI.Graphics();
      overlay.beginFill(0xef4444, 0.35);
      overlay.drawCircle(0, -14, 8);
      overlay.endFill();
      c.addChild(overlay);
    }
    return c;
  }

  function createController() {
    return sprite("controller", 0.55);
  }

  function createRailway(width) {
    const c = new PIXI.Container();
    const rail = sprite("railway", 0.9);
    rail.width = width;
    c.addChild(rail);
    return c;
  }

  function decorateMap(layer, city) {
    if (!ready) return;
    city.signs.forEach((sign) => {
      const sp = createSign(sign.type);
      sp.x = sign.x;
      sp.y = sign.y;
      sp.rotation = sign.rot || 0;
      layer.addChild(sp);
    });
    (city.trafficLights || []).forEach((tl) => {
      const sp = createTrafficLight(tl.state);
      sp.x = tl.x;
      sp.y = tl.y;
      layer.addChild(sp);
    });
    (city.controllers || []).forEach((ctrl) => {
      const sp = createController();
      sp.x = ctrl.x;
      sp.y = ctrl.y;
      layer.addChild(sp);
    });
    if (city.railway) {
      const rw = city.railway.width || city.size * city.tile;
      const sp = createRailway(rw);
      sp.x = city.railway.x;
      sp.y = city.railway.y;
      layer.addChild(sp);
    }
  }

  window.Sprites = {
    loadAll,
    get ready() { return ready; },
    createCar,
    createSign,
    createTrafficLight,
    createController,
    decorateMap,
    applyFacing,
    angleToFrame,
  };
})();
