/** A successful write only acknowledges its own store, never another pending write. */
export function acknowledgeStorageSave(previous: Record<string, boolean>, store: string | undefined, timingPending: boolean): Record<string, boolean> {
  const key = store || "unknown";
  const next = { ...previous };
  delete next[key];
  if (timingPending) next["card-timing"] = true;
  return next;
}
