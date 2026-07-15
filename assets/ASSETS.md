# Ассеты для RoadMind (2D-сим)

Каталог источников + что уже лежит в репозитории.

## Быстрый старт

```bash
node scripts/fetch-assets.mjs
```

Скачает ГОСТ-знаки с Wikimedia и CC0-паки с OpenGameArt.

---

## Уже в репозитории

### Свои SVG (`assets/svg/`)

| Файл | Назначение |
|------|------------|
| `car.svg`, `car-red.svg` | Машина игрока / AI (упрощённый top-down) |
| `sign-stop.svg`, `sign-yield.svg`, … | Стилизованные знаки (не ГОСТ) |
| `traffic-light.svg` | Светофор |
| `controller.svg` | Регулировщик |
| `railway.svg` | Ж/д переезд |

Используются в `sprites.js` → PixiJS.

### ГОСТ-знаки (`assets/svg/gost/`)

Скачаны с [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_road_signs_in_Russia) — **ГОСТ Р 52290-2004**, лицензия **CC BY-SA 3.0**.

| Файл | Знак | Тип в `citygen.js` |
|------|------|---------------------|
| `2.4.svg` | Уступите дорогу | `yield`, `roundabout` |
| `2.5.svg` | STOP | `stop` |
| `2.1.svg` | Главная дорога | `priority`, `main_road` |
| `3.1.svg` | Въезд запрещён | `no_entry` |
| `3.24-60.svg` | Ограничение 60 км/ч | `speed`, `speed_min` |
| `3.28.svg` | Стоянка запрещена | `no_parking` |
| `5.19.1.svg` | Пешеходный переход | `crosswalk` |
| `1.23.svg` | Дети | `school` |
| `4.1.1.svg` | Круговое движение | `roundabout` |
| `6.4.svg` | Парковка | `parking` |

Маппинг: `assets/sign-map.json`.

> Для полного набора (~400 знаков) — категории на Commons: [предупреждающие](https://commons.wikimedia.org/wiki/Category:SVG_warning_road_signs_of_Russia), [запрещающие](https://commons.wikimedia.org/wiki/Category:SVG_prohibitory_road_signs_of_Russia), [информационные](https://commons.wikimedia.org/wiki/Category:SVG_information_road_signs_of_Russia).

Шрифт для цифр на знаках: [shoorick/russian-road-sign-font](https://github.com/shoorick/russian-road-sign-font) (CC BY-SA).

### CC0-машины (`assets/packs/tiny-cars/`)

Источник: [Tiny Cars · OpenGameArt](https://opengameart.org/content/tiny-cars-0) — **CC0**.

- `32x32/` и `64x64/` — 7 цветов, **8 направлений** (sprite sheet в каждом PNG)
- С alpha (`*a.png`) и без
- Идеально для top-down CCD-стиля

---

## Рекомендованные внешние паки

### Машины + дороги (CC0)

| Пак | Лицензия | Что внутри | Ссылка |
|-----|----------|------------|--------|
| **PixelCars** | CC0 | 6 типов авто, 4 спецмашины, **4 типа дорог + зебра** (128×64) | [itch.io](https://lushmustache.itch.io/pixelcars) |
| **2D Car Kit** | CC0 | Машины, грузовики, такси, полиция + **тайлы дорог** (трава/бетон) | [itch.io](https://wolfram-studio.itch.io/2d-car-kit) |
| **Kenney RPG Urban Kit** | CC0 | 480+ спрайтов: **машины, дороги, здания** | [itch.io](https://kenney-assets.itch.io/rpg-urban-kit) |
| **Newc42 Pixel Cars** | CC0 | 20+ машин и грузовиков top-down | [itch.io](https://newc-42.itch.io/pixel-art-cars-trucks) |

### Разметка и дорожное полотно

| Пак | Лицензия | Что внутри | Ссылка |
|-----|----------|------------|--------|
| **Street Lines** | Public Domain | Зебра, сплошная/прерывистая, повороты, парковочные места — **накладываются на асфальт** | [OpenGameArt](https://opengameart.org/content/street-lines) · `node scripts/fetch-assets.mjs` |
| **Pixel Streets** (demo бесплатно) | CC0 | 16×16: белая/жёлтая, сплошная/прерывистая, **crosswalks**, светофоры | [itch.io demo](https://bloodyfish.itch.io/pixel-streets) |
| **Road Tile Set** (chasersgaming) | CC0 | Top-down тайлы, двойная жёлтая, светофоры | [itch.io](https://chasersgaming.itch.io/road-tile-set) |
| **2D Road Tileset 64×64** | Free | Прямые, повороты, перекрёстки, тротуары | [itch.io](https://rayhanalshorif133.itch.io/2d-road-assets) |

### Знаки ПДД (официальные)

| Источник | Формат | Лицензия | Примечание |
|----------|--------|----------|------------|
| **Wikimedia Commons** | SVG | CC BY-SA 3.0 | Лучший источник для РФ/СНГ, уже используем |
| **AllDrawings.ru** | DWG | — | Полный комплект ГОСТ-52290, для CAD, не для web |
| **russian-road-sign-font** | TTF | CC BY-SA | Цифры и буквы по ГОСТ |

### Окружение города

| Пак | Лицензия | Ссылка |
|-----|----------|--------|
| Kenney City Kit (Roads) | CC0 | [itch.io](https://kenney-assets.itch.io/city-kit-roads) — 3D, но можно рендерить |
| Kenney Top-down Tanks Redux | CC0 | [itch.io](https://kenney-assets.itch.io/top-down-tanks-redux) — дороги, деревья, бочки |
| LPC Top-down Road Tileset | Royalty-free | [OpenGameArt](https://lpc.opengameart.org/content/top-down-road-tileset) |

---

## Что выбрать для «CCD 2D»

Рекомендуемый стек для MVP:

1. **Машины** — `assets/packs/tiny-cars/64x64` (уже скачано) или PixelCars (дороги в комплекте)
2. **Разметка** — Street Lines (overlay) или Pixel Streets 16×16 (если pixel-art стиль)
3. **Знаки** — `assets/svg/gost/` (реальные ГОСТ) вместо стилизованных `sign-*.svg`
4. **Дорожное полотно** — пока процедурно в `citygen.js` (Graphics); позже заменить на тайлсет Kenney/PixelCars

---

## Интеграция

- [x] `sprites.js` — ГОСТ-знаки из `gost/`, машины Tiny Cars (8 направлений)
- [x] `drive.js` — `Sprites.applyFacing()` вместо вращения спрайта
- [x] `index.sim.html` — отдельная точка входа для прототипа
- [x] Слой разметки — стоп-линии, улучшенные «зебры» в `citygen.js`
- [x] Детекция нарушений — скорость, красный, стоп-линия, пешеходы (`drive.js`)

---

## Лицензии (кратко)

| Ассет | Можно коммерчески | Атрибуция |
|-------|-------------------|-----------|
| CC0 (Kenney, Tiny Cars, PixelCars) | ✅ | Не обязательна |
| Wikimedia GOST SVG | ✅ | CC BY-SA — указать источник |
| Street Lines | ✅ | Public domain |
| AllDrawings DWG | Уточнять на сайте | — |

Не коммитить в git без проверки лицензии. Крупные архивы (`assets/packs/*.zip`, `street-lines/`) — через `fetch-assets.mjs`.
