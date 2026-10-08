import { useEffect, useRef, type ReactNode } from "react";

/** One dialog owns focus, Escape, and inert background, including lazy loading. */
export function ModalFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background: { node: HTMLElement; inert: boolean }[] = [];
    for (let current: HTMLElement | null = node; current?.parentElement; current = current.parentElement) {
      for (const sibling of current.parentElement.children) if (sibling !== current && sibling instanceof HTMLElement && !sibling.hasAttribute("data-modal-background")) {
        background.push({ node: sibling, inert: sibling.inert }); sibling.inert = true;
      }
    }
    const focusable = () => [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex="0"]')].filter(item => item.getClientRects().length && !item.closest("[inert]"));
    (focusable()[0] || node).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); node.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      for (const item of background) item.node.inert = item.inert;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="backup-shade"><div ref={dialog} className="backup-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div></div>;
}
