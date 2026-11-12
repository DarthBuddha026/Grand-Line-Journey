/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const l = level - 1;
  return Math.floor(8 + 6 * l + 0.9 * l * l);
}

export interface RunSummary {
  characterId: string;
  stageId: string;
  timeSec: number;
  kills: number;
  level: number;
  berries: number;
  cleared: boolean;
  /** Haki fragments picked up from bosses this run. */
  hakiFound: string[];
  /** Alliance weapons fused this run. */
  alliancesFound: string[];
  bossesDefeated: number;
}

/**
 * Bounty shown on the wanted poster at the end of a run.
 * Rounded to the nearest thousand so posters look like real bounties.
 */
export function computeBounty(r: Pick<RunSummary, 'kills' | 'timeSec' | 'level' | 'cleared'> & { bossesDefeated?: number }): number {
  const raw =
    r.kills * 1_500 + r.timeSec * 2_000 + r.level * 50_000 + (r.bossesDefeated ?? 0) * 5_000_000 + (r.cleared ? 30_000_000 : 0);
  return Math.round(raw / 1000) * 1000;
}

export function formatBounty(n: number): string {
  return n.toLocaleString('en-US');
}
