import type { Json } from './types.ts';

/*
 * Identifiers become keys of plain objects (`roots`, `panels`). Keys like "constructor" or "toString" resolve through
 * the prototype chain on a plain lookup, and assigning `__proto__` changes the object's prototype instead of adding a
 * key. So every lookup goes through `own`/`has`, and `__proto__` is not accepted as an identifier at all.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

/** A usable identifier: a non-empty string that is not `__proto__`. */
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v !== '__proto__';

export const has = (record: object, key: string): boolean => Object.hasOwn(record, key);

/** Own-property lookup: `undefined` for anything not set directly on the record, whatever the prototype offers. */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function isJson(v: unknown): v is Json {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  if (isRecord(v)) return Object.entries(v).every(([k, x]) => k !== '__proto__' && isJson(x));
  return false;
}
