/** What the element asks its host for when an operation needs a new identifier. */
export type IdKind = 'group' | 'split';
export type IdSource = (kind: IdKind) => string;

/** The parts of the platform an id source reads, so a test can force them. */
export interface IdEnvironment {
  readonly now: () => number;
  readonly crypto?: {
    readonly randomUUID?: () => string;
    readonly getRandomValues?: (array: Uint32Array) => Uint32Array;
  } | undefined;
  readonly random: () => number;
}

const UNSAFE_ID_CHARS = /[^a-zA-Z0-9_-]/g;

/**
 * Builds an id source. Ids must be unique across every window of one workspace, and windows are separate JavaScript
 * contexts that share no counter. `crypto.randomUUID` is the first choice, but it only exists in secure contexts, so
 * a page served over plain http has to fall back: a clock reading and a counter are not enough there (two windows
 * that create a group in the same millisecond would both mint the same id), so the fallback also carries a random
 * token drawn once per source from `crypto.getRandomValues` (available in every context) or, failing that, `random`.
 */
export function createIdSource(env: IdEnvironment): IdSource {
  let counter = 0;
  let token: string | undefined;
  const drawToken = (): string => {
    if (env.crypto?.getRandomValues !== undefined) {
      const words = env.crypto.getRandomValues(new Uint32Array(2));
      return `${words[0]!.toString(36)}${words[1]!.toString(36)}`;
    }
    return `${Math.floor(env.random() * 2 ** 32).toString(36)}${Math.floor(env.random() * 2 ** 32).toString(36)}`;
  };
  return (kind) => {
    const uuid = env.crypto?.randomUUID?.();
    if (uuid !== undefined) return `${kind}-${uuid}`.replace(UNSAFE_ID_CHARS, '');
    token ??= drawToken();
    return `${kind}-${env.now().toString(36)}${(++counter).toString(36)}${token}`.replace(UNSAFE_ID_CHARS, '');
  };
}

export const defaultIdSource: IdSource = createIdSource({
  now: () => Date.now(),
  crypto: globalThis.crypto as IdEnvironment['crypto'],
  random: () => Math.random(),
});
