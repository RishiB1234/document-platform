/**
 * Whether a validated document may be shown yet.
 *
 * A cached snapshot is private data, and holding it is not authority to display
 * it: on a shared device the previous person's document is sitting in IndexedDB
 * before anyone signs in. Nothing is rendered until the current browser session
 * has established authorization for the document at least once. A cached copy
 * is a fallback for a live read that fails *within* an authorized session, and
 * a fast repaint after one -- never a pre-authorization display.
 *
 * The deliberate cost: a session that starts offline shows nothing, because
 * authorization cannot be established without reaching Google. Offline reading
 * survives only inside a session that already authorized.
 */
export function visibleSnapshot<T>(
  verifiedThisSession: boolean,
  live: T | null,
  cached: T | null,
): T | null {
  if (!verifiedThisSession) return null;
  return live ?? cached;
}
