// Tiny localStorage-backed outbox for *unsynced creates*. We use it so that
// edits and deletes targeting an as-yet-unsynced (negative-id) row can
// coalesce into the queued create instead of trying to PATCH/DELETE
// /api/entries/-1 after a reload.
//
// For each kind ("entries" | "rope"), we map tempId -> the latest draft that
// should be POSTed when the queued create finally reaches the server.

import type { EntryDraft, RopeDraft } from "./mutations";

type Kind = "entries" | "rope";
type Drafts = {
  entries: Record<number, EntryDraft>;
  rope: Record<number, RopeDraft>;
};

const KEY = "ojt-outbox-v1";

function read(): Drafts {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { entries: {}, rope: {} };
    const parsed = JSON.parse(raw);
    return {
      entries: parsed?.entries ?? {},
      rope: parsed?.rope ?? {},
    };
  } catch {
    return { entries: {}, rope: {} };
  }
}

function write(d: Drafts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function putDraft<K extends Kind>(
  kind: K,
  tempId: number,
  draft: K extends "entries" ? EntryDraft : RopeDraft,
): void {
  const d = read();
  // @ts-expect-error narrowing is fine at runtime
  d[kind][tempId] = draft;
  write(d);
}

export function patchDraft<K extends Kind>(
  kind: K,
  tempId: number,
  patch: Partial<K extends "entries" ? EntryDraft : RopeDraft>,
): void {
  const d = read();
  const cur = d[kind][tempId];
  if (!cur) return;
  // @ts-expect-error narrowing
  d[kind][tempId] = { ...cur, ...patch };
  write(d);
}

export function getDraft<K extends Kind>(
  kind: K,
  tempId: number,
): (K extends "entries" ? EntryDraft : RopeDraft) | undefined {
  const d = read();
  // @ts-expect-error narrowing
  return d[kind][tempId];
}

export function removeDraft(kind: Kind, tempId: number): void {
  const d = read();
  delete d[kind][tempId];
  write(d);
}
