import { useCallback, useEffect, useRef, useState } from "react";

import type { ValidatedDocumentSnapshot } from "../document/ValidatedDocumentSnapshot.js";
import type { GoogleDriveDocumentSource } from "./GoogleDriveDocumentSource.js";

export type GoogleDriveSyncState<T> =
  | { status: "idle"; completedAt: null; snapshot: null }
  | { status: "connecting" | "cancelled"; completedAt: string | null; snapshot: ValidatedDocumentSnapshot<T> | null }
  | { status: "ready"; completedAt: string; snapshot: ValidatedDocumentSnapshot<T> }
  | { status: "error"; completedAt: string | null; message: string; snapshot: ValidatedDocumentSnapshot<T> | null };

export function useGoogleDriveSync<T>(
  source: GoogleDriveDocumentSource<T>,
  onVerified: (snapshot: ValidatedDocumentSnapshot<T>, verifiedAt: string) => Promise<void>,
  selectFile: boolean,
  currentSnapshot: ValidatedDocumentSnapshot<T> | null,
) {
  const [state, setState] = useState<GoogleDriveSyncState<T>>({ status: "idle", completedAt: null, snapshot: null });
  const active = useRef(true);
  const connecting = useRef(false);
  const lastCompletedAt = useRef<string | null>(null);
  const lastSnapshot = useRef<ValidatedDocumentSnapshot<T> | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const acceptVerified = useCallback(async (snapshot: ValidatedDocumentSnapshot<T>, verifiedAt = new Date().toISOString()) => {
    await onVerified(snapshot, verifiedAt);
    if (!active.current) return;
    lastCompletedAt.current = verifiedAt;
    lastSnapshot.current = snapshot;
    setState({ status: "ready", completedAt: verifiedAt, snapshot });
  }, [onVerified]);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    setState({ status: "connecting", completedAt: lastCompletedAt.current, snapshot: lastSnapshot.current });
    try {
      const snapshot = await source.load(selectFile, currentSnapshot);
      if (!active.current) return;
      if (snapshot) await acceptVerified(snapshot);
      else setState({ status: "cancelled", completedAt: lastCompletedAt.current, snapshot: lastSnapshot.current });
    } catch (error: unknown) {
      if (!active.current) return;
      setState({ status: "error", completedAt: lastCompletedAt.current, message: error instanceof Error ? error.message : "Unknown synchronization error", snapshot: lastSnapshot.current });
    } finally { connecting.current = false; }
  }, [acceptVerified, currentSnapshot, selectFile, source]);

  return { acceptVerified, connect, state } as const;
}
