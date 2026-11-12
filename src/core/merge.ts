/**
 * Content files describe levels cumulatively: level N = level N-1 deep-merged with
 * the entry for level N. Objects merge key by key; arrays and primitives replace.
 * This keeps JSON short ("+1 projectile" only lists `count`).
 */

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(out[k]) && isPlain(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function expandCumulative<T>(levels: readonly unknown[]): T[] {
  const out: T[] = [];
  let acc: unknown = {};
  for (const lv of levels) {
    acc = deepMerge(acc, lv);
    out.push(structuredClone(acc) as T);
  }
  return out;
}
