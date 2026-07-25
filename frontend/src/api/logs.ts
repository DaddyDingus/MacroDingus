import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { DayLog, Food, LogEntry, Meal, Nutrition } from "./types";
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

export function useAddLog(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { food: Food; meal: Meal; quantityGrams: number }) =>
      apiFetch<LogEntry>("/logs", {
        method: "POST",
        body: JSON.stringify({
          date,
          meal: input.meal,
          foodId: input.food.id,
          quantityGrams: input.quantityGrams,
          loggedAt: localIsoNoTz(),
        }),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["logs", date] });
      const previous = qc.getQueryData<DayLog>(["logs", date]);
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: LogEntry = {
        id: tempId,
        meal: input.meal,
        quantityGrams: input.quantityGrams,
        loggedAt: localIsoNoTz(),
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
    mutationFn: (input: { id: string; quantityGrams: number; meal?: Meal }) =>
      apiFetch<LogEntry>(`/logs/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantityGrams: input.quantityGrams, meal: input.meal }),
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
              ? {
                  ...e,
                  quantityGrams: input.quantityGrams,
                  meal: input.meal ?? e.meal,
                  nutrition: scaleNutrition(e.food, input.quantityGrams),
                }
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
    mutationFn: (input: { entries: { food: Food; meal: Meal; quantityGrams: number }[] }) =>
      apiFetch<{ entries: LogEntry[] }>("/logs/bulk", {
        method: "POST",
        body: JSON.stringify({
          date,
          entries: input.entries.map((e) => ({
            meal: e.meal,
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
        meal: e.meal,
        quantityGrams: e.quantityGrams,
        loggedAt: localIsoNoTz(),
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

export function useRecentDays(meal?: Meal) {
  return useQuery({
    queryKey: ["logs", "recent-days", meal ?? "all"],
    queryFn: () => apiFetch<RecentDay[]>(`/logs/recent-days${meal ? `?meal=${meal}` : ""}`),
  });
}

export function useCopyDay(targetDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceDate: string; meal?: Meal }) =>
      apiFetch<{ copied: number }>("/logs/copy", {
        method: "POST",
        body: JSON.stringify({ sourceDate: input.sourceDate, targetDate, meal: input.meal }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs", targetDate] }),
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
