import { useEffect, useMemo, useRef, useState } from "react";
import { createCardTimer, createTimingId, saveCardTiming, flushCardTiming, readTimingRecords, timingContentKey, timingEnabled, timingSettingsKey, type CardTiming, type TimingKind } from "./card-timing";
import type { Rating } from "./study-scheduler";

const accountKey = "yantu-sync-active-partition";
const store = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
const completedVisits = new Map<string, CardTiming>();
const currentAccount = () => { try { return localStorage.getItem(accountKey) || "guest"; } catch { return "unavailable"; } };
export function retryTimingWrites() {
  for (const subject of ["333", "825", "politics"]) flushCardTiming(store, subject, currentAccount());
}
export function useCardTiming(subject: string, card: { id: string; front: string; back: string } | undefined, kind: TimingKind | undefined, enabled: boolean, paused: boolean, note = "") {
  const [switchedOn, setSwitchedOn] = useState(() => timingEnabled(store));
  useEffect(() => {
    const reload = () => setSwitchedOn(timingEnabled(store));
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key === timingSettingsKey) reload(); };
    window.addEventListener("yantu-timing-settings-changed", reload); window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("yantu-timing-settings-changed", reload); window.removeEventListener("storage", onStorage); };
  }, []);
  const active = useRef<{ timer: ReturnType<typeof createCardTimer>; account: string } | null>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const blocked = useRef(false);
  const contentKey = useMemo(() => card ? timingContentKey(card.front, card.back, note) : "", [card?.front, card?.back, note]);
  const key = switchedOn && enabled && card && kind ? JSON.stringify([subject, card.id, contentKey]) : "";
  const account = currentAccount;
  const persist = (row: CardTiming | null, owner: string) => { if (row && account() === owner) saveCardTiming(store, subject, row, owner); };
  const finish = (grade?: Rating) => {
    // A rating while timing is off supersedes the previous undo token too.
    if (grade) completedVisits.delete(`${account()}:${subject}`);
    const current = active.current; if (!current) return;
    const row = current.timer.finish(grade); active.current = null; persist(row, current.account);
    if (row && grade) completedVisits.set(`${current.account}:${subject}`, row);
  };
  useEffect(() => {
    blocked.current = false;
    if (!key || !card || !kind) return;
    const current = { account: account(), timer: createCardTimer({ id: createTimingId(), cardId: card.id, label: card.front.slice(0, 300), contentKey, kind, startedAt: new Date().toISOString() }) };
    active.current = current;
    const update = () => {
      if (active.current !== current || blocked.current) return;
      if (account() !== current.account) { current.timer.pause(); active.current = null; return; }
      if (document.visibilityState === "visible" && !pausedRef.current) current.timer.resume();
      else { current.timer.pause(); persist(current.timer.checkpoint(), current.account); }
    };
    const hide = () => { current.timer.pause(); persist(current.timer.checkpoint(), current.account); };
    const changing = () => { finish(); blocked.current = true; completedVisits.delete(`${current.account}:${subject}`); };
    const checkpoint = () => { update(); if (active.current === current) persist(current.timer.checkpoint(), current.account); };
    update();
    const interval = window.setInterval(checkpoint, 15000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", update);
    window.addEventListener("yantu-account-changing", changing);
    return () => {
      window.clearInterval(interval); document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", update); window.removeEventListener("yantu-account-changing", changing);
      if (active.current === current) finish();
    };
    // Identity changes end a visit; flips, clock ticks and scope/all switches on the same card do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const current = active.current; if (!current || blocked.current) return;
    if (paused || document.visibilityState !== "visible") { current.timer.pause(); persist(current.timer.checkpoint(), current.account); }
    else current.timer.resume();
  }, [paused]);
  return {
    complete: finish,
    undo(cardId: string) {
      const owner = account(), cacheKey = `${owner}:${subject}`, saved = completedVisits.get(cacheKey);
      if (!saved || saved.cardId !== cardId) return;
      const latest = readTimingRecords(store, subject)[saved.id] || saved;
      persist({ ...latest, status: "undone", updatedAt: new Date().toISOString() }, owner);
      completedVisits.delete(cacheKey);
    },
  };
}
