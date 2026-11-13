# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Grand Line Survivor (formerly Grand Line Journey; the repo folder and the design PDF keep the old name) is a browser survivor roguelite (HoloCure-style: auto-firing attacks, 20-minute stages, level-up build choices) set in the One Piece world. It's an unofficial, free, non-commercial fan project. All art must be original or placeholder; never add ripped anime assets or music. The design plan (full 48-character roster, update roadmap) lives outside the repo in "Grand Line Journey — Game Design Plan.pdf" on the user's Desktop.

**Roadmap status:** Phases 1–3 (prototype, vertical slice, launch content) are implemented:
- 17 characters (Straw Hats + World Government)
- 12 weapons, 14 items and all 6 Alliances
- 4 stages, each with a mid-boss and a final boss
- Haki slots, the Shipwright shop, recruitment, bounty ranks and achievements
- the Thousand Sunny hub
- a balance-spreadsheet export

Not done: closed playtests (a human task), audio (no assets yet), real art (characters, enemies and in-game icons are generated HD vector placeholders; only the main-menu title logo and buttons use supplied PNGs, in `src/assets/menu/`, loaded by `BootScene.preload` as `menu_<file name>`; a PNG in `src/assets/icons/<name>.png` (256×256) replaces the generated `ic_<name>` glyph, e.g. the Berries coin; `src/assets/art/*.png` load as `art_<name>`, e.g. the ship hub), and optional extras like aquarium fishing, costumes, PWA and leaderboards. Phase 4 adds one crew + one stage per update using the same systems.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc --noEmit + vite build → dist/ (static; relative paths for itch.io)
npm run typecheck
npm run preview      # serve the built dist/
npm test             # vitest (node env, src/**/*.test.ts): src/core logic + content validation
npm run test:watch
npx vitest run src/core/meta.test.ts         # single file
npx vitest run -t "fuses two max-level"      # single test by name
npm run balance      # export every tunable number to balance/*.csv (via Vite SSR, so levels are fully expanded)
```

There is no linter or formatter; `typecheck` + `test` are the checks.

Link previews: `index.html` has Open Graph / Twitter-card tags; `public/` holds `og-image.jpg` (1200×630, a title-screen capture), `favicon.png` and `apple-touch-icon.png`. Set `VITE_SITE_URL` (`.env`, trailing slash) to the hosted address before building, since social sites need an absolute image URL.

Dev URL flags (`src/config.ts` → `readUrlFlags`): `?debug` shows FPS/entity counts, `?seed=N` fixes the RNG, `?time=S` starts runs at S seconds (e.g. `?time=595` jumps to the mid-boss), and `?unlockall` is test mode: every character unlocked (`setUnlockAll` in core/meta.ts) and 999,999,999 Berries, played on an in-memory copy of the save (`applyTestMode` in src/game/account.ts), so nothing done in it is saved or synced. In the browser console, `game` is the Phaser.Game and `game.scene.getScene('run')` is the live run. Its private methods (`syncChoice`, `openAnvil`, `activateSpecial`) are callable for testing. A good smoke test:

1. Stop all scenes.
2. Call `game.scene.start('run', {characterId, stageId})`.
3. Add an invulnerable buff with `r.addBuff('t', [], 9999, true)`.
4. Max skills and weapons via `r.loadout.apply` + `r.syncChoice`.
5. Set `r.runTime` past 600 / 1200 to trigger the bosses.

Uncaught errors in a scene's `update` freeze Phaser's loop, so check the console after any browser test.

## Stack

Phaser **4** (not 3) + TypeScript + Vite + Vitest. Phaser 4 differences that bite:
- Tint fill is `setTint(c).setTintMode(Phaser.TintModes.FILL)`.
- `Geom.Point` is gone; use `Vector2`.
- `Math.TAU` is 2π.
- FX and masks are now filters.

Phaser ships agent docs at `node_modules/phaser/skills/*/SKILL.md`; check `v3-to-v4-migration` before using unfamiliar APIs.

## Architecture

**Content is data; behaviour is a small action library.** Characters, main attacks, weapons/Alliances, items, skills, Haki, enemies/bosses, stages, shop and achievements are JSON in `src/data/`, typed by `src/data/types.ts`. They're loaded, expanded and cross-validated in `src/data/index.ts`. `validateContent()` runs at boot and in tests, and covers unknown ids, action types, textures, level counts and custom hooks. Level arrays are **cumulative** (each entry deep-merges onto the previous; `core/merge.ts`). Three things are generated rather than hand-written:
- **Main attacks** are one base level, expanded by `growMainAttack` into the standard 7-level curve.
- **Items** use `perLevel`/`base`/`max` and are expanded by `expandItem`, which auto-writes their descriptions.
- **Alliances** are weapons with a `recipe`.

Every attack, skill effect and Special is an `ActionDef` executed by `src/game/run/actions.ts`. The action types are punch, cone, volley, strike, pulse, orbit, sweep, zone, beam, dash, blink, chain, screen, buff, heal, magnet and multi. `transform` and `flurry` are handled by `RunScene` and `Kit` respectively. Skills (`src/game/run/kits.ts`, the generic `Kit`) have triggers: passive, periodic, mainAttack (every Nth), hurt, and custom. Custom hooks are named in `CUSTOM_HOOKS` in data/index.ts and implemented in `Kit.custom`. New content that reuses existing actions is JSON-only. A new action type means a case in `actions.ts` plus `ACTION_TYPES`; a new texture means `textures.ts` plus `TEXTURE_KEYS`.

**Numbers flow through three places:**
- `StatBlock` (`core/stats.ts`): `final = (base + Σflat) × (1 + Σpct)` over named sources (`item:x`, `skill:x`, `buff:x`, `shop`, `rank`, `haki0`, `terrain`, `transform`). Re-leveling replaces a source.
- `ModBlock`: summed rule modifiers (`MOD_KEYS`: dodge, burnOnHit, eliteDmg, revives, shieldMax...).
- `RunScene.hitEnemy`: the **single damage path** for player attacks. It applies ATK, crits, every modifier and on-hit statuses. Never damage enemies elsewhere except via `enemies.applyDamage` for non-player sources (hazards).

**Pure core vs Phaser layer.** `src/core/` has no Phaser imports and is unit-tested:
- spatial hash, pools and wave director
- loadout (level-up rolls, Hold/Eliminate, chests, Alliance fusion, anvil enhancement)
- progression (XP curve, bounty) and noise (terrain)
- save (v2 with migration + export/import)
- meta (shop, recruitment, stage unlocks, bounty rank, Haki, achievements, and `applyRun`, which folds a finished run into the save)

**Run loop** (`src/game/scenes/RunScene.ts`, implements `RunContext` from `run/context.ts`), in order each frame:
1. input
2. scheduled callbacks and buffs
3. player (dash/sleep/drift, regen, shield, terrain)
4. spawns: `WaveDirector` handles segments, events and bosses; elites have a chance to spawn per stage
5. `enemies.rebuildHash()`
6. weapons (`run/weapons.ts`) and the kit
7. the Special/transform
8. hitboxes → bosses → enemies → hazards → pickups → fx → terrain

The run states are `playing | levelup | chest | anvil | cleared | paused | ended`. Only `playing` advances `runTime`, so gameplay must use `runTime` and `schedule()`, never Phaser timers or tweens. Names avoid `Phaser.Scene` clashes: `runTime` (not `time`), `controls` (not `input`), `world` (not `scene`).

**Systems** (`src/game/run/`):
- `hitboxes.ts`: every player attack is a pooled Hitbox with a motion (linear, boomerang, punch, beam, sweep, cone, pulse, orbit, zone, strike). It handles collision via the spatial hash, pierce, re-hit intervals, pull, and buff zones. Cones, zones and strike telegraphs are drawn with shared Graphics.
- `enemies.ts`: pool, archetype AI, statuses (stun, slow, burn, fear), elites and enemy shots.
- `bosses.ts`: data-driven patterns (charge, slam, radial, aimed, summon, zones, teleport) with telegraphs. The Observation `telegraphLead` mod extends them.
- `hazards.ts`: anything that hurts the player (boss slams, wax zones, the Buster Call bombardment, sandstorm vision).
- `terrain.ts`: noise-based seawater, quicksand and Impel Down's cycling heat, cold and poison floors. The Devil Fruit seawater rule is in `RunScene.updateTerrainEffects`.
- `pickups.ts`: XP (merges past 200 orbs), Berries, meat, and treasure (chest, anvil, Haki fragment), which must be walked over.

**Pooled-object gotcha:** enemies, hitboxes and pickups are recycled from fixed pools (`CAPS` in config.ts). An object can be released and re-acquired as something else within the same frame, so anything that holds a reference across frames must check identity, not just `alive`. `BossSystem` stores the def for this reason. `Pool.release` swap-removes, so iterate `pool.active` backwards when releasing. Never allocate game objects mid-run.

**Scenes:**
- `boot` validates data, generates placeholder textures, then `restoreAccount()` → `title`, or `account` (first launch: Sign in with Google / Play as guest).
- `profile` (main menu → Profile): account card (sign in / sign out) + lifetime stats.
- `title` is the main menu: a row of icon buttons (Profile, Achievements, Shop, Set Sail, Pirate Ship → `hub`, Settings, Quit). It implements `MenuHost`: Achievements and Settings open `panel` (a generic list+detail menu; configs in `src/game/menus.ts`), Profile and Shop launch their own scenes on top; its first click is also the audio-unlock gesture.
- `hub` is the harbour: a code-drawn wooden dock in front (where you and the crew stand) with the Thousand Sunny (`art_ship`, src/assets/art/ship.png) moored behind as scenery at slower parallax: walk the dock (A/D) and press E by a recruited crewmate to hear one of their `lines` (characters.json). The deck scrolls with the player; the HUD is on a second fixed camera. Crew use `characterFrames` (textures.ts) for idle/run frames when they have hand-drawn art. The sea is `drawCelSea` (src/game/sea.ts), shared with the title.
- `shopfront` is the main menu's Shop desk (Nakama / Shipwright / Back); it launches `gacha` or `shop` on top. Launched scenes draw in `main.ts` scene-list order, so sub-screens must come after the screen that opens them.
- `shop` is the Shipwright (via `shopfront`): Abilities/Stats tabs (split on `meta` in shop.json), a tile grid with level pips and SOLD!, and a description box. `gacha` and `shop` share `screenChrome` from ui.ts.
- `gacha` is the Nakama screen (via `shopfront`): one banner card per crew (`CREWS` in data/index.ts: `tag`, `color`, `pullCost`), with ×1/×10 pulls via `pullCrew` in core/meta.ts and a speed-line reveal.
- `sail` is the main menu's Set Sail flow in one scene: captain grid (rows per crew) → Haki (three slot cards; only once the player owns a Haki, otherwise skipped both ways) → mode (`RunMode`: `stage`, `endless`; Time mode is a "coming soon" card) → stage, then `run` with `{ characterId, stageId, mode }`. Endless mode auto-continues past the stage clear (the clear still counts); `result` carries the mode into "Sail again".
- `run` + `hud` run in parallel; the HUD reads RunScene state every frame and calls `choose`, `reroll`, `hold`, `eliminate`, `chooseAnvil`, `closeChest`, `continueEndless`, `retire`, `togglePause` and `quitRun`.
- `result` shows the wanted poster and rewards; the save is already written by `RunScene.endRun` via `applyRun`. Its Share button (S) snapshots the 1280×720 design area and calls `shareImage` (src/game/share.ts): the native share sheet with the PNG and a caption, else it downloads the PNG and copies the caption.

Phaser reuses scene instances, so reset per-run fields in `init()`/`create()`, never in class field initializers. Use `update()` rather than `this.events.on(UPDATE)`.

**UI design system** (`src/game/ui.ts`, "manga ink on pirate materials"). Every screen builds from this kit; don't hand-roll new styles.
- **Palette:** tokens `C` (numbers) and `CSS` (strings). Sea navy backdrops, parchment for anything readable, gold for selection and rewards, red for titles and danger, warm ink `#1d1410` for every outline.
- **Fonts:** bundled via `@fontsource` (latin subsets, imported in `main.ts`, awaited in `BootScene` before any text is created):
  - `FONT.display`: Abril Fatface, for headings, numbers and banners, via `display()`, which adds an ink stroke and a hard shadow
  - `FONT.ui`: M PLUS Rounded 1c, for all UI text, via `label()`; pass `onDark: false` on parchment
  - `FONT.poster`: Rye, only on the wanted poster
- **Shapes:** `inkPanel` (hard offset shadow + fill + ink stroke, optionally slanted), `parchment`, `ribbon`, `gauge`, `medallion`, `burst`, `speedLines`, `backdrop`, `keycap` and `hintRow`.
- **Buttons:** `Button`, a slanted container with hover, press, focus and a count badge.
- **Icons:** `ic_*` textures generated in `src/game/icons.ts`: white glyphs with an ink outline, meant to sit on a coloured `medallion`. `weaponIcon` / `itemIcon` / `skillIcon` map content to icons; new content may need an entry there.
- **Big moments:** level up, treasure, stage clear and boss arrivals use speed lines plus tilted gradient display text. Keep that treatment for big moments only.
- **Polygon typings:** `src/phaser-augment.d.ts` lets `Graphics.fillPoints` / `strokePoints` take plain `{x, y}` arrays.

**Aspect ratios** (`src/game/layout.ts`): the canvas uses `Scale.EXPAND`. It is always at least 1280×720 (game units) and grows in width or height to fill any window, with no size cap, so it never letterboxes. Never assume the screen is 1280×720:
- **World:** read `viewport.w/h` (live view size in world units, updated by `RunScene.fitViewport` on resize) and `recycleDist()`, never `VIEW_W/VIEW_H`.
- **Centered screens** (title, hub, panel, result): composed in 1280×720 design coordinates. `centerCamera(scene)` scrolls the camera so that area sits mid-screen and returns the screen edges (`left/top/right/bottom`) for full-bleed backgrounds and corner-pinned elements.
- **HUD:** anchors chrome to `this.sw/this.sh`, the live screen size divided by `uiZoom`. `uiZoom` (>1 on physically small screens like phones) enlarges the chrome through the main camera. Overlays and touch controls render through a second, unzoomed camera (`overlayCam`) in a container offset to center the 1280×720 design. Anything created after `create()` must be added to the right camera's ignore list.
- **Resize:** every UI scene calls `relayoutOnResize`, which restarts it (debounced) with its data. RunScene never restarts; it only refits the viewport.
- **Portrait:** touch devices held upright see a "turn your device" screen (CSS in index.html), and the run pauses.

**Rendering (HD):** layout is authored in 1280×720 design units, but the canvas renders at `RES`× (config.ts; picked at boot from the screen's physical pixels, about 1.5 at 1080p, 2 at 1440p and up to 3 at 4K; override with `?res=N`). Phaser 4 has no global resolution, so every camera zooms by RES: `centerCamera` (zoom RES), HUD (RES × uiZoom), world (`WORLD_ZOOM * RES`). Pointer coordinates are game pixels, so divide by RES for design units (see input.ts). Text rasterises at `TEXT_RES` (`label`/`display` set it; raw `add.text` calls must pass it too). `pixelArt` is off: all generated textures are supersampled, `TEX`× (4) for most and `CHAR_TEX`× (12) for the chibi characters, with linear filtering. Code that shows them with `setScale(n)` must use `n / TEX` or `n / CHAR_TEX`; `setDisplaySize` needs no change. The world view is 640×360 world units at 16:9.

**Input** (`src/game/input.ts`) merges keyboard+mouse, gamepad and a touch joystick into one per-frame snapshot. Aim modes are mouse or auto (nearest enemy), toggled with C.

**Accounts and saves** (`src/game/account.ts`): `loadSave`/`writeSave` with no store argument go to the store set by `useSaveStore` (`core/save.ts`).
- **Guest:** `sessionStorage`, wiped when the browser closes. The choice is remembered for the session only.
- **Google:** Firebase Auth + Firestore doc `saves/{uid}` = `{ save: <JSON string>, updatedAt }`. A cache in localStorage under `<save key>@<uid>` keeps loads synchronous. Writes push to the cloud about 1 s later and on tab hide. At sign-in `chooseSave` picks the newer of the cloud copy and the device cache, else carried-in progress: a guest's save when signing in from Profile, or the pre-accounts localStorage save for the first Google account on that browser.
- **Config:** `VITE_FIREBASE_*` in `.env.local` (see `.env.example`). Without it the Google button is disabled and only guest play works. Firebase is code-split and only downloaded when configured. Security rules live in `firestore.rules`.
- **Popups:** `signInWithGoogle` must be called straight from a click or key handler, so `prepareGoogle()` preloads Firebase when the sign-in screen or Profile opens.
