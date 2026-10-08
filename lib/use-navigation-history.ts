import { useEffect, useRef } from "react";
import { isRestorableView, isStudySubject, restoreLearningSession, type BookIds, type LearningLocation, type LearningSession, type StudySubject } from "./learning-session";

type Navigation = { subject: StudySubject; location: LearningLocation; cardId?: string };
const routeKey = ({ subject, location, cardId }: Navigation) => JSON.stringify([subject, location.view, location.book, location.chapter, location.section, location.view === "cards" ? cardId : null]);
/** Browser/Android Back changes navigation only; drafts and schedules stay live.
 * Do not create an extra initial entry or intercept navigation out of the app. */
export function useNavigationHistory(session: LearningSession, ready: boolean, ids: BookIds, cardId: string | undefined, onNavigate: (next: Navigation) => void) {
  const last = useRef<{ account: string; key: string; snapshot: string } | null>(null), navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  useEffect(() => {
    if (!ready) return;
    const onPop = (event: PopStateEvent) => {
      const saved = event.state?.yantuNavigation;
      const account = localStorage.getItem("yantu-sync-active-partition") || "guest";
      if (!saved || saved.account !== account || !isStudySubject(saved.subject) || !isRestorableView(saved.subject, saved.location?.view)) return;
      const restored = restoreLearningSession(JSON.stringify({ version: 1, subject: saved.subject, locations: { [saved.subject]: saved.location } }), ids);
      const next = { subject: restored.subject, location: restored.locations[restored.subject], cardId: typeof saved.cardId === "string" && saved.cardId.length <= 200 ? saved.cardId : undefined };
      last.current = { account, key: routeKey(next), snapshot: JSON.stringify(next) };
      navigate.current(next);
    };
    const onAccount = () => { last.current = null; };
    window.addEventListener("popstate", onPop);
    window.addEventListener("yantu-account-changed", onAccount);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("yantu-account-changed", onAccount); };
  }, [ready, ids]);
  useEffect(() => {
    if (!ready) return;
    const next = { subject: session.subject, location: session.locations[session.subject], cardId: session.locations[session.subject].view === "cards" ? cardId : undefined };
    const account = localStorage.getItem("yantu-sync-active-partition") || "guest", key = routeKey(next);
    const snapshot = JSON.stringify(next);
    if (last.current?.account === account && last.current.snapshot === snapshot) return;
    const state = { ...history.state, yantuNavigation: { ...next, account } };
    try {
      if (!last.current || last.current.account !== account) history.replaceState(state, "");
      else if (last.current.key !== key) history.pushState(state, "");
      else history.replaceState(state, "");
    } catch { /* A restricted History API must not prevent studying. */ }
    last.current = { account, key, snapshot };
  }, [session, ready, cardId]);
}
