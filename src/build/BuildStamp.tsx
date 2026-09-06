/**
 * Which build you are actually looking at.
 *
 * Worth the pixels: a stale bundle looks exactly like a current one, so a bug
 * fixed in the source can appear to persist in the browser with nothing on
 * screen to contradict it. The commit is the fastest way to tell the two
 * apart, and the build time is the fastest way to spot a `dist` that was never
 * rebuilt at all.
 *
 * The identity arrives as props rather than being read from a build-time
 * global here, so this layer stays independent of the bundler that produced
 * it. The application reads its own constant at the composition boundary.
 */
export type BuildIdentity = {
  readonly commit: string;
  readonly builtAt: string;
};

export function BuildStamp({ commit, builtAt }: BuildIdentity) {
  const built = new Date(builtAt);
  const valid = !Number.isNaN(built.getTime());
  return (
    <span className="build-stamp">
      <code>{commit}</code>
      {valid && (
        <time dateTime={builtAt} title={`Built ${built.toLocaleString()}`}>
          {built.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" "}
          {built.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </time>
      )}
    </span>
  );
}
