/**
 * A recorded change, rendered for a person to check.
 *
 * The contract between an application, which alone knows what its records mean,
 * and the review panels, which only lay text out. An application maps its own
 * change type to this; nothing in platform ever inspects a domain change to
 * produce one.
 */
export type ChangeDescription = {
  /** What this change does, in one line. */
  title: string;
  /** Field-level detail for an update; empty for an add or a delete. */
  fields: readonly string[];
};
