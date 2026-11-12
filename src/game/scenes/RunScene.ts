import Phaser from 'phaser';
import {
  ALLIANCES, BASE_WEAPON_IDS, CHARACTERS, HAKI, ITEMS, LIMITS, MAIN_ATTACKS, SHOP, SKILLS, STAGES, WEAPONS,
  type ActionDef, type CharacterDef, type HitEffects, type StageDef, type TerrainType,
} from '../../data';
import { Rng } from '../../core/rng';
import { ModBlock, StatBlock, type StatModifier } from '../../core/stats';
import { choiceKey, Loadout, type Choice, type LoadoutPools, type Recipe } from '../../core/loadout';
import { WaveDirector, type SpawnRequest } from '../../core/waveDirector';
import { xpToNext, type RunSummary } from '../../core/progression';
import { loadSave, writeSave, type SaveData } from '../../core/save';
import { applyRun, hakiModifiers, metaCounts, rankFor, RANK_BONUS, rollHakiFragment, shopLevel, type RunOutcome } from '../../core/meta';
import { DEPTH, PLAYER_BASE_SPEED, PLAYER_IFRAMES, WORLD_ZOOM, hex, readUrlFlags, viewport, RES } from '../../config';
import { InputController } from '../input';
import type { ActionSource, PlayerState, RunContext } from '../run/context';
import { EnemySystem, type Enemy } from '../run/enemies';
import { HitboxSystem } from '../run/hitboxes';
import { PickupSystem, type Pickup } from '../run/pickups';
import { FxSystem } from '../run/fx';
import { HazardSystem } from '../run/hazards';
import { TerrainSystem } from '../run/terrain';
import { BossSystem } from '../run/bosses';
import { executeAction } from '../run/actions';
import { Kit } from '../run/kits';
import { createWeapon, updateWeapon, type WeaponRuntime } from '../run/weapons';
import { CHAR_TEX, TEX } from '../textures';
import { itemIcon, skillIcon, weaponIcon } from '../icons';

export interface ChoiceInfo {
  name: string;
  desc: string;
  color: number;
  icon: string;
  isNew: boolean;
  maxLevel: number;
}

export type RunState = 'playing' | 'levelup' | 'chest' | 'anvil' | 'cleared' | 'paused' | 'ended';

export interface RunSceneData {
  characterId: string;
  stageId: string;
}

export type AnvilOption = { kind: 'fuse'; recipe: Recipe } | { kind: 'enhance'; id: string };

export interface Banner {
  title: string;
  sub: string;
  t: number;
  color: string;
}

const RECIPES: Recipe[] = ALLIANCES.map((a) => ({ id: a.id, recipe: a.recipe! }));

/**
 * One run on one stage. Owns all gameplay systems and exposes read-only state for
 * HudScene. Gameplay timing uses `runTime`, which only advances while playing.
 */
export class RunScene extends Phaser.Scene implements RunContext {
  rng!: Rng;
  character!: CharacterDef;
  stage!: StageDef;
  stats!: StatBlock;
  mods!: ModBlock;
  loadout!: Loadout;
  player!: PlayerState;
  controls!: InputController;
  enemies!: EnemySystem;
  hitboxes!: HitboxSystem;
  pickups!: PickupSystem;
  fx!: FxSystem;
  hazards!: HazardSystem;
  bosses!: BossSystem;
  terrain!: TerrainSystem;
  runTime = 0;

  // ---- State read by the HUD ----
  state: RunState = 'playing';
  level = 1;
  xp = 0;
  kills = 0;
  berries = 0;
  specialCharge = 0;
  pendingLevelUps = 0;
  choices: Choice[] = [];
  chestResults: Choice[] = [];
  anvilOptions: AnvilOption[] = [];
  banner: Banner | null = null;
  rerolls = 0;
  holds = 0;
  eliminates = 0;
  cleared = false;
  terrainHere: TerrainType | null = null;
  hakiFound: string[] = [];
  alliancesFound: string[] = [];
  bossesDefeated = 0;
  readonly debug = readUrlFlags().debug;
  save!: SaveData;

  private kit!: Kit;
  private main!: WeaponRuntime;
  private weapons: WeaponRuntime[] = [];
  private director!: WaveDirector;
  private spawnBuf: SpawnRequest[] = [];
  private pools!: LoadoutPools;
  private ground!: Phaser.GameObjects.TileSprite;
  private boostAtk = 0;
  private nearestDir = { x: 0, y: 0 };
  private aimOut = { x: 1, y: 0 };
  private buffs = new Map<string, { t: number; invuln: boolean }>();
  private scheduled: { t: number; fn: () => void }[] = [];
  private transform: { remaining: number; every: number; timer: number; action?: ActionDef; invuln: boolean; fired: number } | null = null;
  private revivesUsed = 0;
  private finalSpawned = 0;
  private finalKilled = 0;
  private hakiPulseTimer = 0;
  private terrainKey = '';
  private moving = false;

  constructor() {
    super('run');
  }

  get world(): Phaser.Scene {
    return this;
  }

  init(data: RunSceneData): void {
    const flags = readUrlFlags();
    this.rng = new Rng(flags.seed ?? Date.now());
    this.character = CHARACTERS.get(data.characterId) ?? CHARACTERS.values().next().value!;
    this.stage = STAGES.get(data.stageId) ?? STAGES.values().next().value!;
    this.runTime = flags.startTime;
    this.state = 'playing';
    this.level = 1;
    this.xp = this.kills = this.berries = this.specialCharge = this.pendingLevelUps = 0;
    this.choices = [];
    this.chestResults = [];
    this.anvilOptions = [];
    this.banner = null;
    this.cleared = false;
    this.terrainHere = null;
    this.hakiFound = [];
    this.alliancesFound = [];
    this.bossesDefeated = 0;
    this.weapons = [];
    this.boostAtk = 0;
    this.buffs = new Map();
    this.scheduled = [];
    this.transform = null;
    this.revivesUsed = 0;
    this.finalSpawned = this.finalKilled = 0;
    this.hakiPulseTimer = 0;
    this.terrainKey = '';
  }

  create(): void {
    const c = this.character;
    this.save = loadSave();
    this.stats = new StatBlock({ maxHp: c.baseStats.hp, atk: c.baseStats.atk, spd: c.baseStats.spd, crit: c.baseStats.crit });
    this.mods = new ModBlock();
    this.applyMeta();
    const counts = metaCounts(this.save);
    this.rerolls = counts.rerolls;
    this.holds = counts.holds;
    this.eliminates = counts.eliminates;

    this.loadout = new Loadout(c.mainAttack, c.skills);
    this.pools = { weapons: BASE_WEAPON_IDS, items: [...ITEMS.keys()], skills: c.skills };
    this.director = new WaveDirector(this.stage, this.rng);
    this.director.skipTo(this.runTime);
    this.kit = new Kit(c);
    this.main = createWeapon(MAIN_ATTACKS.get(c.mainAttack)!, true);

    const cam = this.cameras.main;
    cam.setZoom(WORLD_ZOOM * RES);
    cam.setBackgroundColor(this.stage.ground.base);
    this.ground = this.add.tileSprite(0, 0, 64, 64, `ground_${this.stage.id}`).setDepth(DEPTH.ground).setTileScale(0.5);
    this.fitViewport();
    const onResize = () => this.fitViewport();
    this.scale.on('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', onResize));
    this.terrain = new TerrainSystem(this, this.stage.terrain);

    this.player = {
      x: 0, y: 0, hp: this.stats.get('maxHp'), iframes: 0, scale: 1, facing: 1, shield: 0, shieldDelay: 0, revives: 0,
      dashT: 0, dashVx: 0, dashVy: 0, sleepT: 0, attackPauseT: 0, emergencyCd: 0,
      shadow: this.add.image(0, 0, 'shadow').setDepth(DEPTH.player - 1),
      sprite: this.add.image(0, 0, `player_${c.id}`).setDepth(DEPTH.player).setOrigin(0.5, 0.8),
    };
    cam.startFollow(this.player.sprite, false, 0.12, 0.12);

    this.controls = new InputController(this);
    this.fx = new FxSystem(this, () => this.player);
    this.enemies = new EnemySystem(this, {
      onKill: (e) => this.onEnemyKilled(e),
      onContact: (e) => this.onContact(e),
      onShotHit: (dmg) => this.hurtPlayer(dmg),
    });
    this.hitboxes = new HitboxSystem(this);
    this.pickups = new PickupSystem(this, { onCollect: (p) => this.onCollect(p) });
    this.hazards = new HazardSystem(this, this.stage.hazards);
    this.bosses = new BossSystem(this);

    const onHidden = () => {
      if (this.state === 'playing') this.state = 'paused';
    };
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden));

    this.showBanner(this.stage.name, `${c.name} sets sail — survive 20:00`, '#f2c94c');
    this.scene.launch('hud');
  }

  /** Match the world view to the (expanded) canvas: wider screens see more of the sea. */
  private fitViewport(): void {
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    viewport.w = this.scale.width / (WORLD_ZOOM * RES);
    viewport.h = this.scale.height / (WORLD_ZOOM * RES);
    this.ground.setSize(viewport.w * 2.2, viewport.h * 2.2);
    // A phone turned upright shows the "turn your device" screen: pause underneath it.
    const device = this.sys.game.device;
    const handheld = device.input.touch && !device.os.desktop;
    if (handheld && this.scale.height > this.scale.width && this.state === 'playing') this.state = 'paused';
  }

  /** Shipwright upgrades, bounty rank and equipped Haki. */
  private applyMeta(): void {
    const shopStats: StatModifier[] = [];
    for (const def of SHOP.values()) {
      const lv = shopLevel(this.save, def.id);
      for (const m of def.stats ?? []) shopStats.push({ stat: m.stat, flat: (m.flat ?? 0) * lv, pct: (m.pct ?? 0) * lv });
    }
    this.stats.set('shop', shopStats);
    const rank = rankFor(this.save.charXp[this.character.id] ?? 0);
    const rb = RANK_BONUS * (rank - 1);
    this.stats.set('rank', [{ stat: 'atk', pct: rb }, { stat: 'maxHp', pct: rb }]);
    hakiModifiers(this.save).forEach((h, i) => {
      this.stats.set(`haki${i}`, h.stats);
      this.mods.set(`haki${i}`, h.mods);
    });
  }

  // ---- RunContext ------------------------------------------------------------

  aimDir(): { x: number; y: number } {
    const a = this.controls.aim;
    const wobble = this.mods.get('aimWobble');
    if (wobble <= 0) return a;
    const ang = Math.atan2(a.y, a.x) + this.rng.range(-wobble, wobble);
    this.aimOut.x = Math.cos(ang);
    this.aimOut.y = Math.sin(ang);
    return this.aimOut;
  }

  hitEnemy(e: Enemy, base: number, kx: number, ky: number, knockback: number, effects: HitEffects = {}, killWeak = false): void {
    if (!e.alive) return;
    const m = this.mods;
    if (killWeak && e.def.weak && !e.elite && !e.boss) {
      this.fx.burst(e.x, e.y, 2, 10, 0.25, 0x9b59ff, 'disc', false, 0.7);
      this.enemies.kill(e);
      return;
    }
    if (base > 0) {
      const p = this.player;
      let mul = this.stats.get('atk') + this.boostAtk;
      mul *= 1 + m.get('lowHpDmg') * (1 - Math.max(0, p.hp) / this.stats.get('maxHp'));
      if (e.elite || e.boss) mul *= 1 + m.get('eliteDmg') + m.get('tankDmg');
      else if (e.def.archetype === 'tank') mul *= 1 + m.get('tankDmg');
      if (e.stun > 0) mul *= 1 + m.get('stunnedDmg');
      if (!e.touched) mul *= 1 + m.get('firstHitBonus');
      const far = m.get('farDmg');
      if (far > 0) mul *= 1 + (far * Math.hypot(e.x - p.x, e.y - p.y)) / 100;
      if (effects.vsDF && e.def.devilFruit) mul *= 1 + effects.vsDF;
      const maxedBonus = m.get('maxedWeaponDmg');
      if (maxedBonus > 0) mul *= 1 + maxedBonus * this.maxedWeapons();
      const crit = this.rng.chance(this.stats.get('crit'));
      const amount = base * mul * (crit ? 1.5 + m.get('critDmg') : 1) * this.rng.range(0.9, 1.1);
      const ls = (effects.lifesteal ?? 0) + m.get('lifesteal');
      if (ls > 0) this.healPlayer(ls);
      const drain = m.get('selfDrain');
      if (drain > 0) p.hp = Math.max(1, p.hp - drain);
      if (this.rng.chance(m.get('magmaPools'))) {
        this.hitboxes.spawn({ motion: 'zone', x: e.x, y: e.y, radius: 16, life: 3, dmg: 6, hitInterval: 0.5, color: 0xff7043, effects: { burn: 4, burnTime: 2 } });
      }
      if (this.enemies.applyDamage(e, amount, crit, kx, ky, knockback)) return;
    } else {
      this.enemies.applyDamage(e, 0, false, kx, ky, knockback);
    }
    // Status effects
    const bossMul = e.boss ? 0.3 : 1;
    if (effects.stun) e.stun = Math.max(e.stun, effects.stun * bossMul);
    const slow = Math.max(effects.slow ?? 0, m.get('slowOnHit'));
    if (slow > 0) {
      e.slowMul = Math.max(e.slowT > 0 ? e.slowMul : 0, Math.min(0.9, slow));
      e.slowT = Math.max(e.slowT, effects.slowTime ?? 1.5);
    }
    const burn = Math.max(effects.burn ?? 0, m.get('burnOnHit'));
    if (burn > 0) {
      e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, burn);
      e.burnT = Math.max(e.burnT, effects.burnTime ?? 2);
    }
    if (!e.boss && this.rng.chance((effects.fear ?? 0) + m.get('fearOnHit'))) e.fearT = 2;
  }

  private maxedWeapons(): number {
    let n = this.main.level >= LIMITS.mainAttackMaxLevel ? 1 : 0;
    for (const w of this.weapons) if (w.def.recipe || w.level >= LIMITS.weaponMaxLevel) n++;
    return n;
  }

  isPlayerInvulnerable(): boolean {
    if (this.player.dashT > 0 || this.transform?.invuln) return true;
    for (const b of this.buffs.values()) if (b.invuln) return true;
    return false;
  }

  hurtPlayer(raw: number): void {
    const p = this.player;
    if (this.state !== 'playing' || p.iframes > 0 || this.isPlayerInvulnerable()) return;
    if (this.rng.chance(this.mods.get('dodge'))) {
      p.iframes = 0.3;
      this.fx.burst(p.x, p.y, 4, 16, 0.25, 0xb3e5fc, 'ring', true);
      return;
    }
    let dmg = Math.max(1, raw * (1 - Math.min(0.9, this.stats.get('defense'))));
    p.shieldDelay = 3;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      this.fx.burst(p.x, p.y, 8, 18, 0.25, 0xffb74d, 'ring', true);
      if (dmg <= 0) {
        p.iframes = PLAYER_IFRAMES * 0.5;
        return;
      }
    }
    p.hp -= dmg;
    p.iframes = PLAYER_IFRAMES;
    this.cameras.main.shake(80, 0.004);
    this.kit.onHurt(this);
    const maxHp = this.stats.get('maxHp');
    const dashCharges = this.mods.get('emergencyDash');
    if (dashCharges > 0 && p.hp > 0 && p.hp < maxHp * 0.3 && p.emergencyCd <= 0) {
      p.emergencyCd = 30 / dashCharges;
      const near = this.enemies.nearest(p.x, p.y, 200);
      const ax = near ? p.x - near.x : -this.controls.aim.x;
      const ay = near ? p.y - near.y : -this.controls.aim.y;
      const len = Math.hypot(ax, ay) || 1;
      this.dashPlayer(ax / len, ay / len, 120, 0.2);
      this.fx.burst(p.x, p.y, 6, 30, 0.3, 0x29b6f6, 'ring');
    }
    if (p.hp <= 0) this.onPlayerDown();
  }

  private onPlayerDown(): void {
    const p = this.player;
    const revives = metaCounts(this.save).revives + this.mods.get('revives') - this.revivesUsed;
    if (revives > 0) {
      this.revivesUsed++;
      p.hp = this.stats.get('maxHp') * 0.5;
      p.iframes = 2;
      this.screenClear(0xffffff);
      this.showBanner('REVIVED!', 'Back on your feet', '#69f0ae');
      return;
    }
    p.hp = 0;
    this.endRun(false);
  }

  /** Knock every enemy on screen back (used on revive). */
  private screenClear(color: number): void {
    this.enemies.clearShots();
    this.runAction({ type: 'screen', dmg: 0, knockback: 300, effects: { stun: 1 } }, { dmgMul: 1, isMain: false, color, fireCount: 0 });
  }

  healPlayer(amount: number): void {
    const max = this.stats.get('maxHp');
    this.player.hp = Math.min(max, this.player.hp + amount);
  }

  addBuff(id: string, stats: readonly StatModifier[], duration: number, invuln = false): void {
    this.buffs.set(id, { t: duration, invuln });
    this.stats.set(`buff:${id}`, stats);
  }

  dashPlayer(dx: number, dy: number, distance: number, time: number): void {
    const p = this.player;
    p.dashT = time;
    p.dashVx = (dx * distance) / time;
    p.dashVy = (dy * distance) / time;
  }

  runAction(action: ActionDef, source: ActionSource): void {
    if (action.type === 'transform') this.startTransform(action);
    else executeAction(this, action, source);
  }

  schedule(delay: number, fn: () => void): void {
    this.scheduled.push({ t: this.runTime + delay, fn });
  }

  // ---- HUD-facing getters -------------------------------------------------------

  get xpNeeded(): number {
    return xpToNext(this.level);
  }

  get specialCooldown(): number {
    return this.character.special.cooldown;
  }

  get specialActive(): number {
    return this.transform?.remaining ?? 0;
  }

  get weaponList(): readonly WeaponRuntime[] {
    return this.weapons;
  }

  get mainWeapon(): WeaponRuntime {
    return this.main;
  }

  get bossList(): Enemy[] {
    return this.bosses.alive;
  }

  get revivesLeft(): number {
    return metaCounts(this.save).revives + this.mods.get('revives') - this.revivesUsed;
  }

  // ---- Frame loop ----------------------------------------------------------------

  update(_t: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 1 / 30);
    const p = this.player;
    const nearest = this.enemies.nearest(p.x, p.y, 260);
    if (nearest) {
      this.nearestDir.x = nearest.x - p.x;
      this.nearestDir.y = nearest.y - p.y;
    }
    this.controls.update(p.x, p.y, nearest ? this.nearestDir : null);
    if (this.controls.pause) this.togglePause();
    if (this.banner && this.state === 'playing') {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
    if (this.state !== 'playing') return;

    this.runTime += dt;
    this.runScheduled();
    this.updateBuffs(dt);
    this.updatePlayer(dt);
    this.spawnEnemies(dt);
    this.enemies.rebuildHash();

    if (updateWeapon(this, this.main, dt)) this.kit.onMainFired(this, this.main);
    for (const w of this.weapons) updateWeapon(this, w, dt);
    this.kit.update(this, dt, this.moving, this.main);
    this.updateSpecial(dt);
    this.updateHakiPulse(dt);

    this.hitboxes.update(dt);
    this.bosses.update(dt);
    this.enemies.update(dt);
    this.hazards.update(dt);
    this.pickups.update(dt);
    this.fx.update(dt);
    this.terrain.update(p.x, p.y, this.runTime);

    const zoneBuff = this.hitboxes.playerBuff;
    if (zoneBuff) this.stats.set('zoneBuff', zoneBuff);
    else this.stats.remove('zoneBuff');

    if (this.pendingLevelUps > 0 && this.state === 'playing') this.openLevelUp();
  }

  private runScheduled(): void {
    if (!this.scheduled.length) return;
    const due = this.scheduled.filter((s) => s.t <= this.runTime);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter((s) => s.t > this.runTime);
    for (const s of due) s.fn();
  }

  private updateBuffs(dt: number): void {
    for (const [id, b] of this.buffs) {
      b.t -= dt;
      if (b.t <= 0) {
        this.buffs.delete(id);
        this.stats.remove(`buff:${id}`);
      }
    }
  }

  private spawnEnemies(dt: number): void {
    const rateMul = (1 + this.mods.get('spawnMul')) * (this.bosses.bosses.length ? 0.5 : 1);
    const n = this.director.update(this.runTime, dt, this.enemies.count, this.spawnBuf, rateMul);
    const hpScale = this.director.hpScale(this.runTime);
    const eliteChance = this.stage.eliteChance * (1 + this.mods.get('chestRate') + this.mods.get('luck'));
    for (let i = 0; i < n; i++) {
      const req = this.spawnBuf[i];
      const e = this.enemies.spawn(req, hpScale, eliteChance);
      if (e?.boss) {
        this.bosses.add(e);
        if (e.role === 'final') this.finalSpawned++;
        this.showBanner(e.def.name.toUpperCase(), e.def.title ?? (e.role === 'final' ? 'Final boss' : 'Mid-boss'), '#ff8a80');
        this.cameras.main.shake(250, 0.006);
      }
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const mv = this.controls.move;
    const speed = PLAYER_BASE_SPEED * Math.max(0.2, this.stats.get('spd'));
    let mx = mv.x;
    let my = mv.y;
    this.moving = mx !== 0 || my !== 0;
    if (p.sleepT > 0) {
      p.sleepT -= dt;
      mx = my = 0;
    } else if (this.moving) {
      const drift = this.kit.drift(this, dt);
      if (drift) {
        mx += drift.x;
        my += drift.y;
      }
    }
    if (p.attackPauseT > 0) p.attackPauseT -= dt;
    if (p.emergencyCd > 0) p.emergencyCd -= dt;
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVx * dt;
      p.y += p.dashVy * dt;
    } else {
      p.x += mx * speed * dt;
      p.y += my * speed * dt;
    }
    if (mx !== 0) p.facing = mx < 0 ? -1 : 1;
    if (p.iframes > 0) p.iframes -= dt;

    // Regen and shield
    const regen = this.mods.get('regen');
    if (regen > 0) this.healPlayer(regen * dt);
    const shieldMax = this.mods.get('shieldMax');
    if (p.shieldDelay > 0) p.shieldDelay -= dt;
    else if (p.shield < shieldMax) p.shield = Math.min(shieldMax, p.shield + shieldMax * 0.5 * dt);

    this.updateTerrainEffects(dt);

    const invuln = this.isPlayerInvulnerable();
    const blink = p.iframes > 0 && !invuln && Math.floor(p.iframes * 20) % 2 === 0;
    p.sprite
      .setPosition(p.x, p.y)
      .setFlipX(p.facing < 0)
      .setScale(p.scale / CHAR_TEX)
      .setAlpha(blink ? 0.4 : p.sleepT > 0 ? 0.7 : 1)
      .setAngle(p.sleepT > 0 ? 80 : 0);
    p.shadow.setPosition(p.x, p.y + 2).setScale(p.scale / TEX);
    if (invuln) p.sprite.setTint(this.runTime % 0.3 < 0.15 ? 0xffffff : 0xfff2b0);
    else p.sprite.clearTint();

    this.ground.setPosition(p.x, p.y);
    this.ground.setTilePosition(p.x - this.ground.width / 2, p.y - this.ground.height / 2);
    const max = this.stats.get('maxHp');
    if (p.hp > max) p.hp = max;
  }

  /** Seawater, quicksand and Impel Down floors, plus hazard-zone slows and Seastone Cuffs. */
  private updateTerrainEffects(dt: number): void {
    const p = this.player;
    const m = this.mods;
    const type = this.terrain.sample(p.x, p.y, this.runTime);
    this.terrainHere = type;
    const ignore = m.get('ignoreHazards') > 0;
    const noSlow = m.get('noSlow') > 0 || ignore;
    const df = this.character.devilFruit;
    let mods: StatModifier[] = [];
    let key = type ?? 'none';
    if (type === 'water') {
      if (m.get('seawaterHeals') > 0) {
        this.healPlayer(3 * dt);
        key += ':heal';
      } else if (m.get('waterWalker') > 0) {
        mods = [{ stat: 'spd', pct: 0.25 }];
        key += ':walk';
      } else if (df) {
        mods = [{ stat: 'spd', pct: -0.35 }, { stat: 'atk', pct: -0.2 }];
        key += ':df';
      } else {
        mods = [{ stat: 'spd', pct: 0.1 }, { stat: 'atk', pct: 0.1 }];
      }
    } else if ((type === 'quicksand' || type === 'cold') && !noSlow) {
      mods = [{ stat: 'spd', pct: type === 'quicksand' ? -0.4 : -0.3 }];
    } else if ((type === 'heat' || type === 'poison') && !ignore && !this.isPlayerInvulnerable()) {
      p.hp -= (type === 'heat' ? 3 : 2.5) * dt;
      if (p.hp <= 0) this.onPlayerDown();
    }
    const zoneSlow = noSlow ? 0 : this.hazards.zoneSlow;
    if (zoneSlow > 0) mods = [...mods, { stat: 'spd', pct: -zoneSlow }];
    const dfSlow = df ? m.get('dfSlow') : 0;
    if (dfSlow > 0) mods = [...mods, { stat: 'spd', pct: -dfSlow }];
    key += `|${zoneSlow}|${dfSlow}`;
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.stats.set('terrain', mods);
    }
  }

  private updateSpecial(dt: number): void {
    const t = this.transform;
    if (t) {
      t.remaining -= dt;
      if (t.action && t.every > 0) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.timer = t.every;
          executeAction(this, t.action, { dmgMul: 1, isMain: false, color: hex(this.character.look.body), fireCount: t.fired++ });
        }
      }
      if (t.remaining <= 0) this.endTransform();
      return;
    }
    const rate = 1 + this.mods.get('specialCharge') + this.kit.extraSpecialCharge;
    this.specialCharge = Math.min(this.specialCooldown, this.specialCharge + dt * rate);
    if (this.controls.special && this.specialCharge >= this.specialCooldown) this.activateSpecial();
  }

  activateSpecial(): void {
    this.specialCharge = 0;
    const sp = this.character.special;
    this.cameras.main.flash(200, 255, 255, 255);
    this.showBanner(sp.name.toUpperCase() + '!', '', '#f2c94c', 1.4);
    this.runAction(sp.action, { dmgMul: 1, isMain: false, color: hex(this.character.look.body), fireCount: 0 });
    if (sp.action.type !== 'transform') this.afterSpecial();
  }

  private startTransform(a: ActionDef): void {
    this.transform = { remaining: a.duration ?? 8, every: a.every ?? 0, timer: 0.2, action: a.action, invuln: !!a.invuln, fired: 0 };
    this.player.scale = a.scale ?? 1;
    this.stats.set('transform', a.stats ?? []);
    this.fx.burst(this.player.x, this.player.y, 10, 200, 0.6, 0xffffff, 'disc', true, 0.7);
    if (a.invuln) this.enemies.clearShots();
  }

  private endTransform(): void {
    this.transform = null;
    this.player.scale = 1;
    this.stats.remove('transform');
    this.afterSpecial();
  }

  private afterSpecial(): void {
    const inv = this.mods.get('postSpecialInvuln');
    if (inv > 0) this.addBuff('raidSuit', [], inv, true);
  }

  private updateHakiPulse(dt: number): void {
    const every = this.mods.get('hakiPulse');
    if (every <= 0) return;
    this.hakiPulseTimer += dt;
    if (this.hakiPulseTimer >= every) {
      this.hakiPulseTimer = 0;
      executeAction(this, { type: 'pulse', radius: 100, dmg: 0, color: '#9b59ff', effects: { stun: 1.2 } }, { dmgMul: 1, isMain: false, color: 0x9b59ff, fireCount: 0 });
    }
  }

  // ---- Events ----------------------------------------------------------------------

  private onContact(e: Enemy): void {
    const chance = this.mods.get('weakContactKill');
    if (chance > 0 && e.def.weak && !e.elite && this.rng.chance(chance)) {
      this.fx.burst(e.x, e.y, 2, 10, 0.25, 0x9b59ff, 'disc', false, 0.7);
      this.enemies.kill(e);
      return;
    }
    this.hurtPlayer(e.damage);
  }

  private onEnemyKilled(e: Enemy): void {
    this.kills++;
    const d = e.def;
    const luck = 1 + this.mods.get('luck');
    this.pickups.dropXp(e.x, e.y, d.xp * (e.elite ? 5 : 1));
    if (this.rng.chance((d.berryChance ?? 0) * luck)) this.pickups.drop('berry', e.x, e.y, 1 + Math.floor(this.runTime / 300));
    if (this.rng.chance((d.meatChance ?? 0) * luck)) this.pickups.drop('meat', e.x, e.y, 0.2);
    if (e.elite) this.pickups.drop('chest', e.x, e.y, 1);
    if (e.boss) this.onBossKilled(e);
  }

  private onBossKilled(e: Enemy): void {
    this.bossesDefeated++;
    this.pickups.drop('anvil', e.x - 14, e.y, 1);
    this.pickups.drop('chest', e.x + 14, e.y, 1);
    const fragment = rollHakiFragment({ ...this.save, haki: this.foundHakiLevels() }, this.rng);
    if (fragment) this.pickups.drop('haki', e.x, e.y + 16, 1, fragment);
    for (let i = 0; i < 8; i++) this.pickups.dropXp(e.x + this.rng.range(-20, 20), e.y + this.rng.range(-20, 20), d8(e.def.xp));
    this.fx.burst(e.x, e.y, 10, 120, 0.7, 0xffffff, 'disc', false, 0.8);
    this.cameras.main.shake(300, 0.01);
    this.showBanner(`${e.def.name} defeated!`, e.role === 'final' ? '' : 'Grab the anvil and the treasure', '#f2c94c');
    if (e.role === 'final') {
      this.finalKilled++;
      if (this.finalKilled >= this.finalSpawned && !this.cleared) this.stageClear();
    }
  }

  /** Save Haki levels plus fragments already found this run (so drops prefer new ones). */
  private foundHakiLevels(): Record<string, number> {
    const h = { ...this.save.haki };
    for (const id of this.hakiFound) h[id] = (h[id] ?? 0) + 1;
    return h;
  }

  private stageClear(): void {
    this.cleared = true;
    this.state = 'cleared';
    this.hazards.clear();
    this.enemies.clearShots();
  }

  /** HUD: keep playing after clearing the stage. */
  continueEndless(): void {
    if (this.state !== 'cleared') return;
    this.state = 'playing';
    this.showBanner('ENDLESS MODE', 'How long can you last?', '#ff8a80');
  }

  retire(): void {
    if (this.state === 'cleared') this.endRun(true);
  }

  private onCollect(pk: Pickup): void {
    switch (pk.kind) {
      case 'xp':
        this.gainXp(pk.value * this.stats.get('xpGain'));
        break;
      case 'berry':
        this.berries += pk.value * (1 + this.mods.get('berryMul'));
        break;
      case 'meat': {
        const max = this.stats.get('maxHp');
        this.healPlayer(max * pk.value * (1 + this.mods.get('healMul')));
        const foodXp = this.mods.get('foodXp');
        if (foodXp > 0) this.gainXp(foodXp);
        if (this.mods.get('foodBuff') > 0) this.addBuff('food', [{ stat: 'atk', pct: 0.2 }], 6);
        this.fx.burst(this.player.x, this.player.y, 4, 20, 0.3, 0x69f0ae, 'ring', true);
        break;
      }
      case 'chest':
        this.openChest();
        break;
      case 'anvil':
        this.openAnvil();
        break;
      case 'haki':
        this.hakiFound.push(pk.ref);
        this.showBanner('HAKI FRAGMENT', `${HAKI.get(pk.ref)?.name ?? pk.ref} — equip it at the Haki Dojo`, '#b388ff');
        break;
    }
  }

  private gainXp(amount: number): void {
    this.xp += amount;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.pendingLevelUps++;
    }
  }

  showBanner(title: string, sub: string, color: string, time = 3): void {
    this.banner = { title, sub, color, t: time };
  }

  // ---- Level-ups, chests, anvils ----------------------------------------------------------

  private choiceCount(): number {
    return LIMITS.levelUpChoices + Math.round(this.mods.get('extraChoices'));
  }

  private openLevelUp(): void {
    this.pendingLevelUps--;
    this.choices = this.loadout.rollChoices(this.pools, this.rng, this.choiceCount(), this.mods.get('luck'));
    this.state = 'levelup';
  }

  choose(index: number): void {
    if (this.state !== 'levelup') return;
    const c = this.choices[index];
    if (!c) return;
    if (this.loadout.held && choiceKey(this.loadout.held) === choiceKey(c)) this.loadout.held = null;
    this.loadout.apply(c);
    this.syncChoice(c);
    this.choices = [];
    this.state = 'playing';
  }

  reroll(): void {
    if (this.state !== 'levelup' || this.rerolls <= 0) return;
    this.rerolls--;
    this.choices = this.loadout.rollChoices(this.pools, this.rng, this.choiceCount(), this.mods.get('luck'));
  }

  hold(index: number): void {
    const c = this.choices[index];
    if (this.state !== 'levelup' || this.holds <= 0 || !c || c.kind === 'boost' || this.loadout.held) return;
    this.holds--;
    this.loadout.held = c;
  }

  eliminate(index: number): void {
    const c = this.choices[index];
    if (this.state !== 'levelup' || this.eliminates <= 0 || !c || c.kind === 'boost') return;
    this.eliminates--;
    this.loadout.banned.add(choiceKey(c));
    const shown = new Set(this.choices.map(choiceKey));
    const replacement = this.loadout.candidates(this.pools).find((x) => !shown.has(choiceKey(x)));
    this.choices[index] = replacement ?? { kind: 'boost', id: 'berries', level: 0 };
  }

  private openChest(): void {
    const m = this.mods;
    let n = 1;
    if (this.rng.chance(0.3 + m.get('chestExtra'))) n++;
    if (this.rng.chance(m.get('chestRarity') + m.get('luck') * 0.5)) n++;
    n = Math.min(3, n);
    this.chestResults = this.loadout.rollChest(this.pools, this.rng, n);
    for (const c of this.chestResults) this.syncChoice(c);
    this.state = 'chest';
  }

  closeChest(): void {
    if (this.state === 'chest') this.state = 'playing';
  }

  private openAnvil(): void {
    const opts: AnvilOption[] = this.loadout.availableFusions(RECIPES).map((recipe) => ({ kind: 'fuse', recipe }));
    const enh = (id: string) => (this.loadout.enhance.get(id) ?? 0) < LIMITS.maxEnhance;
    if (enh(this.main.def.id)) opts.push({ kind: 'enhance', id: this.main.def.id });
    for (const w of this.weapons) if (enh(w.def.id)) opts.push({ kind: 'enhance', id: w.def.id });
    if (!opts.length) {
      this.berries += 50;
      this.showBanner('ANVIL', 'Nothing to forge: +50 Berries', '#f2c94c');
      return;
    }
    this.anvilOptions = opts;
    this.state = 'anvil';
  }

  chooseAnvil(index: number): void {
    if (this.state !== 'anvil') return;
    const o = this.anvilOptions[index];
    if (!o) return;
    if (o.kind === 'fuse') {
      const r = o.recipe;
      this.loadout.fuse(r);
      this.weapons = this.weapons.filter((w) => !r.recipe.includes(w.def.id));
      this.weapons.push(createWeapon(WEAPONS.get(r.id)!, false));
      if (!this.alliancesFound.includes(r.id)) this.alliancesFound.push(r.id);
      this.showBanner('ALLIANCE FORMED!', WEAPONS.get(r.id)!.name, '#f2c94c');
    } else {
      this.loadout.enhanceWeapon(o.id);
      this.showBanner('ENHANCED', `${this.nameOf(o.id)} +${this.loadout.enhance.get(o.id)}`, '#f2c94c', 2);
    }
    this.anvilOptions = [];
    this.state = 'playing';
  }

  skipAnvil(): void {
    if (this.state === 'anvil') {
      this.anvilOptions = [];
      this.state = 'playing';
    }
  }

  nameOf(weaponId: string): string {
    return (WEAPONS.get(weaponId) ?? MAIN_ATTACKS.get(weaponId))?.name ?? weaponId;
  }

  /** Make a loadout change take effect (runtimes, stats, mods). */
  private syncChoice(c: Choice): void {
    const oldMax = this.stats.get('maxHp');
    switch (c.kind) {
      case 'mainAttack':
        this.main.level = c.level;
        break;
      case 'weapon': {
        const existing = this.weapons.find((w) => w.def.id === c.id);
        if (existing) existing.level = c.level;
        else this.weapons.push(createWeapon(WEAPONS.get(c.id)!, false));
        break;
      }
      case 'item': {
        const lv = ITEMS.get(c.id)!.levels[c.level - 1];
        this.stats.set(`item:${c.id}`, lv.stats ?? []);
        this.mods.set(`item:${c.id}`, lv.mods ?? {});
        break;
      }
      case 'skill':
        this.kit.syncPassives(this);
        break;
      case 'boost':
        if (c.id === 'heal') this.healPlayer(this.stats.get('maxHp') * 0.3);
        else if (c.id === 'atk') this.boostAtk += 0.04;
        else this.berries += 25;
        break;
    }
    const newMax = this.stats.get('maxHp');
    if (newMax > oldMax) this.player.hp += newMax - oldMax;
  }

  /** Display info for a choice card / chest reward. */
  describe(c: Choice): ChoiceInfo {
    switch (c.kind) {
      case 'mainAttack': {
        const d = MAIN_ATTACKS.get(c.id)!;
        return { name: d.name, desc: d.levels[c.level - 1].desc, color: hex(d.color), icon: weaponIcon(d), isNew: false, maxLevel: LIMITS.mainAttackMaxLevel };
      }
      case 'weapon': {
        const d = WEAPONS.get(c.id)!;
        return { name: d.name, desc: c.level === 1 ? d.desc : d.levels[c.level - 1].desc, color: hex(d.color), icon: weaponIcon(d), isNew: c.level === 1, maxLevel: LIMITS.weaponMaxLevel };
      }
      case 'item': {
        const d = ITEMS.get(c.id)!;
        return { name: d.name, desc: c.level === 1 ? `${d.desc} ${d.levels[0].desc}` : d.levels[c.level - 1].desc, color: hex(d.color), icon: itemIcon(d.id), isNew: c.level === 1, maxLevel: LIMITS.itemMaxLevel };
      }
      case 'skill': {
        const d = SKILLS.get(c.id)!;
        return { name: d.name, desc: d.levels[c.level - 1].desc, color: 0x8d5cf6, icon: skillIcon(d), isNew: c.level === 1, maxLevel: LIMITS.skillMaxLevel };
      }
      case 'boost':
        if (c.id === 'heal') return { name: 'Meat Feast', desc: 'Heal 30% of your max HP.', color: 0x3cc46b, icon: 'ic_meat', isNew: false, maxLevel: 0 };
        if (c.id === 'atk') return { name: 'Training', desc: '+4% damage for the rest of the run.', color: 0x3cc46b, icon: 'ic_sword', isNew: false, maxLevel: 0 };
        return { name: 'Treasure', desc: '+25 Berries.', color: 0x3cc46b, icon: 'ic_coin', isNew: false, maxLevel: 0 };
    }
  }

  // ---- Pause / end -------------------------------------------------------------------------

  togglePause(): void {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  quitRun(): void {
    if (this.state === 'ended') return;
    this.endRun(this.cleared);
  }

  /** Leave the voyage for the title screen. The run still counts (Berries, records, rewards). */
  quitToTitle(): void {
    if (this.state === 'ended') return;
    this.endRun(this.cleared, 'title');
  }

  private endRun(cleared: boolean, to: 'result' | 'title' = 'result'): void {
    this.state = 'ended';
    const summary: RunSummary = {
      characterId: this.character.id,
      stageId: this.stage.id,
      timeSec: Math.floor(this.runTime),
      kills: this.kills,
      level: this.level,
      berries: Math.floor(this.berries),
      cleared,
      hakiFound: this.hakiFound,
      alliancesFound: this.alliancesFound,
      bossesDefeated: this.bossesDefeated,
    };
    const save = loadSave(); // re-read in case another tab changed it
    const outcome: RunOutcome = applyRun(save, summary);
    const saved = writeSave(save);
    this.cameras.main.fadeOut(to === 'title' ? 350 : cleared ? 900 : 600, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('hud');
      if (to === 'title') this.scene.start('title');
      else this.scene.start('result', { summary, outcome, saved });
    });
  }
}

function d8(xp: number): number {
  return Math.max(1, Math.round(xp / 8));
}
