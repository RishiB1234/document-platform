import { useCallback, useEffect, useState } from "react";

import type { CachedValidatedDocument, ValidatedDocumentSnapshot } from "../document/ValidatedDocumentSnapshot.js";
import type { DocumentCacheChannel } from "./DocumentCacheChannel.js";
import type { ValidatedDocumentCache } from "./ValidatedDocumentCache.js";

export type DocumentCacheState<T> =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; cached: CachedValidatedDocument<T> }
  | { status: "error"; message: string };

export function useValidatedDocumentCache<T>(store: ValidatedDocumentCache<T>, channel: DocumentCacheChannel) {
  const [state, setState] = useState<DocumentCacheState<T>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const read = () => {
      store.load().then(
        (cached) => { if (active) setState(cached ? { status: "ready", cached } : { status: "empty" }); },
        (error: unknown) => { if (active) setState({ status: "error", message: error instanceof Error ? error.message : "Unknown document cache error" }); },
      );
    };
    read();
    const stop = channel.onChange(read);
    return () => { active = false; stop(); };
  }, [channel, store]);

  const save = useCallback(async (snapshot: ValidatedDocumentSnapshot<T>, verifiedAt: string) => {
    await store.save(snapshot, verifiedAt);
    setState({ status: "ready", cached: { snapshot, verifiedAt } });
    channel.announceChange();
  }, [channel, store]);

  const clear = useCallback(async () => {
    await store.clear();
    setState({ status: "empty" });
    channel.announceChange();
  }, [channel, store]);

  return { clear, save, state } as const;
}
