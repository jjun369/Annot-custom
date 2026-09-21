export interface LatestRequestGuard<Key> {
  begin(key: Key): number;
  isCurrent(requestId: number, key: Key): boolean;
}

/**
 * Keeps async UI work from publishing a response after a newer keyed request
 * has started. The key check also rejects a response from an old selection
 * when that selection is revisited later.
 */
export function createLatestRequestGuard<Key>(): LatestRequestGuard<Key> {
  let latestRequestId = 0;
  let latestKey: Key | undefined;

  return {
    begin(key) {
      latestRequestId += 1;
      latestKey = key;
      return latestRequestId;
    },
    isCurrent(requestId, key) {
      return requestId === latestRequestId && Object.is(key, latestKey);
    },
  };
}
