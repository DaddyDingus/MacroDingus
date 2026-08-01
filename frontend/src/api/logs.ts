import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { DayLog, Food, LogEntry, Nutrition } from "./types";
import { localIsoNoTz } from "../lib/date";
import { scaleNutrition, sumNutrition } from "../lib/nutrition";

export function useDayLog(date: string) {
  return useQuery({
    queryKey: ["logs", date],
    queryFn: () => apiFetch<DayLog>(`/logs?date=${date}`),
  });
}

export function useSmartHistory(time: string) {
  return useQuery({
    queryKey: ["smart-history", time],
    queryFn: () =>
      apiFetch<{ basis: string; foods: Food[] }>(`/logs/smart-history?time=${encodeURIComponent(time)}`),
  });
}

function withEntries(date: string, entries: LogEntry[]): DayLog {
  return { date, entries, totals: sumNutrition(entries.map((e) => e.nutrition)) };
}

export interface DayHistory extends Nutrition {
  date: string;
}

export function useLogsHistory(days: number) {
  return useQuery({
    queryKey: ["logs", "history", days],
    queryFn: () => apiFetch<DayHistory[]>(`/logs/history?days=${days}`),
  });
}

// Full-history distinct logged dates, for the Habits logging-consistency
// calendar and CalendarJumpSheet's date dots — deliberately not
// `useLogsHistory`, which is dense/zero-filled and capped at a year; this is
// sparse and unbounded. `enabled` defaults to true but TodayScreen (an eager,
// hot-path screen) passes false until its CalendarJumpSheet actually opens,
// so this doesn't add a request to every Food Log load.
export function useLoggedDates(enabled = true) {
  return useQuery({
    queryKey: ["logs", "logged-dates"],
    queryFn: () => apiFetch<{ dates: string[] }>("/logs/logged-dates"),
    enabled,
  });
}

export function useAddLog(date: string) {
  const qc = useQueryClient();
  return useMutation({
    // loggedAt override lets a caller log this under a specific time instead
    // of "now" — used by the Food Log's per-group "+" button so an item
    // added there joins that group's own time instead of always landing at
    // the moment the sheet happened to be opened.
    mutationFn: (input: { food: Food; quantityGrams: number; loggedAt?: string }) =>
      apiFetch<LogEntry>("/logs", {
        method: "POST",
        body: JSON.stringify({
          date,
          foodId: input.food.id,
          quantityGrams: input.quantityGrams,
          loggedAt: input.loggedAt ?? localIsoNoTz(),
        }),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["logs", date] });
      const previous = qc.getQueryData<DayLog>(["logs", date]);
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: LogEntry = {
        id: tempId,
        quantityGrams: input.quantityGrams,
        loggedAt: input.loggedAt ?? localIsoNoTz(),
        food: input.food,
        nutrition: scaleNutrition(input.food, input.quantityGrams),
      };
      qc.setQueryData<DayLog>(["logs", date], (old) =>
        withEntries(date, [...(old?.entries ?? []), optimistic])
      );
      return { previous, tempId };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["logs", date], ctx.previous);
    },
    onSuccess: (serverEntry, _input, ctx) => {
      qc.setQueryData<DayLog>(["logs", date], (old) => {
        if (!old) return old;
        return withEntries(
          date,
          old.entries.map((e) => (e.id === ctx.tempId ? serverEntry : e))
        );
      });
    },
  });
}

export function useUpdateLogQuantity(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; quantityGrams: number }) =>
      apiFetch<LogEntry>(`/logs/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantityGrams: input.quantityGrams }),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["logs", date] });
      const previous = qc.getQueryData<DayLog>(["logs", date]);
      qc.setQueryData<DayLog>(["logs", date], (old) => {
        if (!old) return old;
        return withEntries(
          date,
          old.entries.map((e) =>
            e.id === input.id
              ? { ...e, quantityGrams: input.quantityGrams, nutrition: scaleNutrition(e.food, input.quantityGrams) }
              : e
          )
        );
      });
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["logs", date], ctx.previous);
    },
  });
}

export function useBulkAddLog(date: string) {
  const qc = useQueryClient();
  return useMutation({
    // Same loggedAt override as useAddLog above, applied to every entry in
    // the batch — the Food Log's "+" button stages/commits through this
    // path (the plate's normal multi-item commit), so it needs the override
    // too, not just the single-item useAddLog.
    mutationFn: (input: { entries: { food: Food; quantityGrams: number }[]; loggedAt?: string }) =>
      apiFetch<{ entries: LogEntry[] }>("/logs/bulk", {
        method: "POST",
        body: JSON.stringify({
          date,
          loggedAt: input.loggedAt,
          entries: input.entries.map((e) => ({
            foodId: e.food.id,
            quantityGrams: e.quantityGrams,
          })),
        }),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["logs", date] });
      const previous = qc.getQueryData<DayLog>(["logs", date]);
      const optimisticEntries: LogEntry[] = input.entries.map((e) => ({
        id: `temp-${crypto.randomUUID()}`,
        quantityGrams: e.quantityGrams,
        loggedAt: input.loggedAt ?? localIsoNoTz(),
        food: e.food,
        nutrition: scaleNutrition(e.food, e.quantityGrams),
      }));
      qc.setQueryData<DayLog>(["logs", date], (old) =>
        withEntries(date, [...(old?.entries ?? []), ...optimisticEntries])
      );
      return { previous, tempIds: optimisticEntries.map((e) => e.id) };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["logs", date], ctx.previous);
    },
    onSuccess: (data, _input, ctx) => {
      qc.setQueryData<DayLog>(["logs", date], (old) => {
        if (!old) return old;
        const remaining = old.entries.filter((e) => !ctx.tempIds.includes(e.id));
        return withEntries(date, [...remaining, ...data.entries]);
      });
    },
  });
}

export interface RecentDay {
  date: string;
  calories: number;
  entryCount: number;
}

export function useRecentDays() {
  return useQuery({
    queryKey: ["logs", "recent-days"],
    queryFn: () => apiFetch<RecentDay[]>("/logs/recent-days"),
  });
}

export function useCopyDay(targetDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceDate: string }) =>
      apiFetch<{ copied: number }>("/logs/copy", {
        method: "POST",
        body: JSON.stringify({ sourceDate: input.sourceDate, targetDate }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs", targetDate] }),
  });
}

// Copies existing entries to a new date/time by recreating them via
// /logs/bulk (the frontend already has each entry's foodId/quantityGrams in
// hand from the selection, so there's no need for a separate "copy by id"
// endpoint) — backs the Food Log's per-entry/per-group "copy to…" actions.
// Not tied to one fixed target date the way useCopyDay is, since the target
// varies per tap (now/today/tomorrow/a custom date+time).
export function useCopyLogEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; loggedAt: string; items: { foodId: string; quantityGrams: number }[] }) =>
      apiFetch<{ entries: LogEntry[] }>("/logs/bulk", {
        method: "POST",
        body: JSON.stringify({ date: input.date, loggedAt: input.loggedAt, entries: input.items }),
      }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "logs" }),
  });
}

// Moves existing entries in place (date and/or loggedAt) — backs "move to…"
// and "modify timestamp" (which omits `date`, leaving the entry on the same
// day). Invalidates every logs-prefixed query rather than just the source or
// target date, since either (or both) may not be the currently viewed day.
export function useMoveLogEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; date?: string; loggedAt: string }) =>
      apiFetch<{ entries: LogEntry[] }>("/logs/bulk-move", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "logs" }),
  });
}

export function useDeleteLog(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/logs/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["logs", date] });
      const previous = qc.getQueryData<DayLog>(["logs", date]);
      qc.setQueryData<DayLog>(["logs", date], (old) =>
        old ? withEntries(date, old.entries.filter((e) => e.id !== id)) : old
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["logs", date], ctx.previous);
    },
  });
}
