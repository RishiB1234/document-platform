/**
 * A recorded change that no longer applies to the latest document.
 *
 * It deliberately does NOT carry the session it failed in. Replay is atomic,
 * and a handle on the partially rebased session is the one way a partial result
 * could escape: it is exactly what a caller would reach for after a conflict,
 * and writing it would upload a document in a state nobody chose. Carrying the
 * failed change is enough to tell the user which edit collided.
 *
 * It also keeps the whole document off an Error object, where a single log call
 * would serialize the owner's entire private record.
 */
export class ReplayConflict extends Error {
  constructor(message: string, readonly change: unknown) {
    super(message);
    this.name = "ReplayConflict";
  }
}
