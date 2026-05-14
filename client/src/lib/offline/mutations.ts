import type { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Entry, RopeHours } from "@shared/schema";

export type EntryDraft = {
  date: string;
  location: string;
  method: string;
  hours: number;
};

export type RopeDraft = {
  startDate: string;
  endDate: string;
  location: string;
  skills: string;
  hours: number;
};

let _tempCounter = -1;
const nextTempId = () => _tempCounter--;

type WithSync<T> = T & { _pendingSync?: boolean; _syncFailed?: string | null };

const ENTRIES_KEY = ["/api/entries"] as const;
const ROPE_KEY = ["/api/rope-hours"] as const;

function makeOptimisticEntry(draft: EntryDraft): WithSync<Entry> {
  return {
    id: nextTempId(),
    userId: 0,
    date: new Date(draft.date) as unknown as Entry["date"],
    location: draft.location,
    method: draft.method,
    hours: Number(draft.hours),
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    verificationToken: null,
    verificationRequestedAt: null,
    sourceDocumentKey: null,
    sourceDocumentName: null,
    importedAt: null,
    _pendingSync: true,
  } as unknown as WithSync<Entry>;
}

function makeOptimisticRope(draft: RopeDraft): WithSync<RopeHours> {
  return {
    id: nextTempId(),
    userId: 0,
    startDate: new Date(draft.startDate) as unknown as RopeHours["startDate"],
    endDate: new Date(draft.endDate) as unknown as RopeHours["endDate"],
    location: draft.location,
    skills: draft.skills,
    hours: Number(draft.hours),
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    verificationToken: null,
    verificationRequestedAt: null,
    sourceDocumentKey: null,
    sourceDocumentName: null,
    importedAt: null,
    _pendingSync: true,
  } as unknown as WithSync<RopeHours>;
}

export function setupOfflineMutations(qc: QueryClient): void {
  // ---------------------- OJT entries: create batch ----------------------
  qc.setMutationDefaults(["entries.batch"], {
    networkMode: "offlineFirst",
    mutationFn: async (drafts: EntryDraft[]) => {
      const res = await apiRequest("POST", "/api/entries", drafts);
      return (await res.json()) as Entry[];
    },
    onMutate: async (drafts: EntryDraft[]) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];
      const optimistic = drafts.map(makeOptimisticEntry);
      qc.setQueryData<Entry[]>(
        [...ENTRIES_KEY],
        [...prev, ...optimistic],
      );
      return { prev, tempIds: optimistic.map((o) => o.id) };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: Entry[] } | undefined;
      if (c?.prev) qc.setQueryData([...ENTRIES_KEY], c.prev);
    },
    onSuccess: (created, _vars, ctx) => {
      const c = ctx as { tempIds?: number[] } | undefined;
      const tempIds = new Set<number>(c?.tempIds ?? []);
      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) => {
        const list = cur ?? [];
        const filtered = list.filter((e) => !tempIds.has(e.id));
        return [...filtered, ...created];
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ---------------------- OJT entries: update ----------------------
  qc.setMutationDefaults(["entries.update"], {
    networkMode: "offlineFirst",
    mutationFn: async (vars: {
      id: number;
      patch: Partial<EntryDraft>;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/entries/${vars.id}`,
        vars.patch,
      );
      return (await res.json()) as Entry;
    },
    onMutate: async (vars: { id: number; patch: Partial<EntryDraft> }) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];
      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) =>
        (cur ?? []).map((e) =>
          e.id === vars.id
            ? ({
                ...e,
                ...vars.patch,
                date: vars.patch.date
                  ? (new Date(vars.patch.date) as unknown as Entry["date"])
                  : e.date,
                _pendingSync: true,
              } as WithSync<Entry>)
            : e,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: Entry[] } | undefined;
      if (c?.prev) qc.setQueryData([...ENTRIES_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ---------------------- OJT entries: delete ----------------------
  qc.setMutationDefaults(["entries.delete"], {
    networkMode: "offlineFirst",
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
      return id;
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const prev = qc.getQueryData<Entry[]>([...ENTRIES_KEY]) ?? [];
      qc.setQueryData<Entry[]>([...ENTRIES_KEY], (cur) =>
        (cur ?? []).filter((e) => e.id !== id),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: Entry[] } | undefined;
      if (c?.prev) qc.setQueryData([...ENTRIES_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ENTRIES_KEY });
    },
  });

  // ---------------------- Rope hours: create ----------------------
  qc.setMutationDefaults(["ropeHours.create"], {
    networkMode: "offlineFirst",
    mutationFn: async (draft: RopeDraft) => {
      const res = await apiRequest("POST", "/api/rope-hours", draft);
      return (await res.json()) as RopeHours;
    },
    onMutate: async (draft: RopeDraft) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];
      const optimistic = makeOptimisticRope(draft);
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], [...prev, optimistic]);
      return { prev, tempId: optimistic.id };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: RopeHours[] } | undefined;
      if (c?.prev) qc.setQueryData([...ROPE_KEY], c.prev);
    },
    onSuccess: (created, _vars, ctx) => {
      const c = ctx as { tempId?: number } | undefined;
      const tempId = c?.tempId;
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) => {
        const list = cur ?? [];
        const filtered =
          tempId !== undefined ? list.filter((e) => e.id !== tempId) : list;
        return [...filtered, created];
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });

  // ---------------------- Rope hours: update ----------------------
  qc.setMutationDefaults(["ropeHours.update"], {
    networkMode: "offlineFirst",
    mutationFn: async (vars: { id: number; patch: Partial<RopeDraft> }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/rope-hours/${vars.id}`,
        vars.patch,
      );
      return (await res.json()) as RopeHours;
    },
    onMutate: async (vars: { id: number; patch: Partial<RopeDraft> }) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) =>
        (cur ?? []).map((e) =>
          e.id === vars.id
            ? ({
                ...e,
                ...vars.patch,
                startDate: vars.patch.startDate
                  ? (new Date(
                      vars.patch.startDate,
                    ) as unknown as RopeHours["startDate"])
                  : e.startDate,
                endDate: vars.patch.endDate
                  ? (new Date(
                      vars.patch.endDate,
                    ) as unknown as RopeHours["endDate"])
                  : e.endDate,
                _pendingSync: true,
              } as WithSync<RopeHours>)
            : e,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: RopeHours[] } | undefined;
      if (c?.prev) qc.setQueryData([...ROPE_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });

  // ---------------------- Rope hours: delete ----------------------
  qc.setMutationDefaults(["ropeHours.delete"], {
    networkMode: "offlineFirst",
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/rope-hours/${id}`);
      return id;
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ROPE_KEY });
      const prev = qc.getQueryData<RopeHours[]>([...ROPE_KEY]) ?? [];
      qc.setQueryData<RopeHours[]>([...ROPE_KEY], (cur) =>
        (cur ?? []).filter((e) => e.id !== id),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: RopeHours[] } | undefined;
      if (c?.prev) qc.setQueryData([...ROPE_KEY], c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROPE_KEY });
    },
  });
}

// Helper for components to detect optimistic / pending-sync rows.
export function isPendingSync(row: { id: number; _pendingSync?: boolean }): boolean {
  return row.id < 0 || row._pendingSync === true;
}
