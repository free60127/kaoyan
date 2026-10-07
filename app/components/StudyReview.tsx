import { useEffect, useState, type ReactNode } from "react";
import type { StudyReviewController } from "../../lib/use-study-review";
import { localStudyDate, type Rating, type StudyScope } from "../../lib/study-scheduler";
import { cardMatchesStudyScope, loadBrowsePosition, pickPinnedHead, saveBrowsePosition, scopedStudyReviewView, studyBrowseIndex } from "../../lib/study-review-view";

type Book = { id: string; name: string; chapters: { title: string }[] };
type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string; source: string; sourceFile?: string; sourcePage?: number; sourcePages?: number[] };
export const formatStudyDue = (dueAt: string) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(dueAt));
const scopeKey = (scope: StudyScope) => JSON.stringify(scope);
function scopeLabel(scope: StudyScope, books: Book[]) {
  return `${books.find(book => book.id === scope.bookId)?.name || scope.bookId} · 第 ${scope.chapters.join("、")} 章${scope.section ? " · " + scope.section : ""}`;
}

export function StudyReviewScopes({ books, cards, review, current, showCurrent = true }: { books: Book[]; cards: Card[]; review: StudyReviewController; current: StudyScope; showCurrent?: boolean }) {
  const [expanded, setExpanded] = useState(() => !review.progress.scopes.length);
  const [limitDraft, setLimitDraft] = useState(String(review.progress.dailyNewLimit));
  useEffect(() => setLimitDraft(String(review.progress.dailyNewLimit)), [review.progress.dailyNewLimit]);
  const chapterAvailable = (bookId: string, chapter: number) => cards.some(card => card.book === bookId && card.chapter === chapter);
  const selected = (bookId: string, chapter: number) => review.newScopes.some(scope => scope.bookId === bookId && scope.section === undefined && scope.chapters.includes(chapter));
  function toggle(bookId: string, chapter: number) {
    const rest = review.newScopes.flatMap(scope => {
      if (scope.bookId !== bookId) return [scope];
      const chapters = scope.chapters.filter(value => value !== chapter);
      return chapters.length ? [{ ...scope, chapters }] : [];
    });
    review.selectScopes(selected(bookId, chapter) ? rest : [...rest, { bookId, chapters: [chapter] }]);
  }
  const currentAvailable = cards.some(card => card.book === current.bookId && current.chapters.includes(card.chapter) && (!current.section || current.section === card.section));
  return <details className="panel study-scopes" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>设置学习范围与每日新卡上限 <small>{review.newScopes.length ? "已选新学范围 · 上限 " + review.progress.dailyNewLimit + " 张" : "尚未选择新学范围"}</small></summary>
    <div className="study-scope-heading"><div><h2>今日新学范围</h2><p>勾选想学的章，可跨书选择。新学范围加入持续复习；以后换章，之前已学的到期卡仍会出现。</p></div><label className="study-limit">每日新卡上限<input type="number" min="0" max="200" step="1" value={limitDraft} disabled={!review.ready} onChange={event => { const value = event.target.value; setLimitDraft(value); if (value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 200) review.setDailyNewLimit(Number(value)); }} onBlur={() => setLimitDraft(String(review.progress.dailyNewLimit))}/><small>0–200 张 · 已学 {review.progress.daily.date === localStudyDate(review.now) ? review.progress.daily.admitted.length : 0} 张新卡</small></label></div>
    {showCurrent && <button className="secondary" disabled={!review.ready || !currentAvailable} onClick={() => review.selectScopes([...review.newScopes, current])}>把当前{current.section ? "小节" : "章"}加入学习</button>}
    <div className="study-selection" aria-label="已选新学范围">{review.newScopes.length ? review.newScopes.map(scope => <span key={scopeKey(scope)}>{scopeLabel(scope, books)}<button aria-label={"取消今日新学：" + scopeLabel(scope, books)} onClick={() => review.selectScopes(review.newScopes.filter(item => scopeKey(item) !== scopeKey(scope)))}>×</button></span>) : <p>还没有选择新学范围。先勾选一章，或把当前章 / 小节加入学习。</p>}</div>
    <details className="study-range-picker"><summary>按书目和章节选择新学范围</summary><div className="study-range-books">{books.map(book => {
      const available = book.chapters.map((_, index) => index + 1).filter(chapter => chapterAvailable(book.id, chapter));
      const allSelected = available.length > 0 && available.every(chapter => selected(book.id, chapter));
      return <details key={book.id}><summary>{book.name} <small>{available.filter(chapter => selected(book.id, chapter)).length} / {available.length} 章</small></summary><label className="study-range-check study-whole-book"><input type="checkbox" checked={allSelected} disabled={!review.ready || !available.length} onChange={() => review.selectScopes(allSelected ? review.newScopes.filter(scope => scope.bookId !== book.id) : [...review.newScopes.filter(scope => scope.bookId !== book.id), { bookId: book.id, chapters: available }])}/>选择整本书</label><div className="study-chapter-checks">{book.chapters.map((chapter, index) => <label key={index} className="study-range-check"><input type="checkbox" checked={selected(book.id, index + 1)} disabled={!review.ready || !chapterAvailable(book.id, index + 1)} onChange={() => toggle(book.id, index + 1)}/><span>第 {index + 1} 章 · {chapter.title}{!chapterAvailable(book.id, index + 1) && <small>暂无闪卡</small>}</span></label>)}</div></details>;
    })}</div></details>
    <details className="study-active-ranges"><summary>持续复习范围 · {review.progress.scopes.length} 个范围</summary><p>这些范围的已学卡会在到期时进入队列。取消今日新学只调整新卡；暂停此处的范围才会停止其复习，学习记录仍保留。再次加入可继续。</p><div>{review.progress.scopes.length ? review.progress.scopes.map(scope => <div className="study-active-row" key={scopeKey(scope)}><span>{scopeLabel(scope, books)}</span><button className="text-button" onClick={() => review.pauseScope(scope)}>暂停此范围</button></div>) : <p>尚未加入学习范围。</p>}</div></details>
  </details>;
}

const ratings: { grade: Rating; label: string }[] = [{ grade: "again", label: "重来" }, { grade: "hard", label: "困难" }, { grade: "good", label: "记住了" }, { grade: "easy", label: "很熟悉" }];

export function StudyReviewCards({ subject, review, cards, books, bookId, chapter, section, picker, onRated, onUndoRating, jumpCardId }: { subject: string; review: StudyReviewController; cards: Card[]; books: Book[]; bookId: string; chapter: number; section: string; picker: ReactNode; onRated?: (card: Card, grade: Rating, wasNew: boolean) => void; onUndoRating?: () => void; jumpCardId?: string }) {
  const [mode, setMode] = useState<"scope" | "all" | "browse">("scope");
  const currentScope: { bookId: string; chapters: number[]; section?: string } = { bookId, chapters: [chapter], ...(section ? { section } : {}) };
  const locationKey = scopeKey(currentScope);
  const [browsePosition, setBrowsePosition] = useState({ scopeKey: locationKey, index: 0 });
  const [revealedCard, setRevealedCard] = useState<string | null>(null);
  // R12: 到期卡不再抢占当前学习卡——固定当前显示的卡，实时到期只更新队列与计数；评分后才切换
  const [pinned, setPinned] = useState<{ key: string; cardId: string } | null>(null);
  const browseCards = cards.filter(card => cardMatchesStudyScope(card, currentScope));
  const browseIndex = studyBrowseIndex(browsePosition, locationKey, browseCards.length);
  const scopedQueue = scopedStudyReviewView(review.queueForScope(currentScope), cards, review.progress, currentScope, review.now);
  const queue = mode === "all" ? review.queue : scopedQueue;
  const queueKey = `${mode}:${locationKey}`;
  const head = mode === "browse" ? null : pickPinnedHead(pinned, queueKey, queue.items);
  const wasNew = head?.kind === "new";
  const card = mode === "browse" ? browseCards[browseIndex] : cards.find(card => card.id === head?.cardId);
  const visibleCardKey = JSON.stringify([mode, locationKey, card?.id]);
  const flipped = revealedCard === visibleCardKey;
  const cardsReady = browseCards.length > 0;
  // 固定"正在学习"的卡: 显示中的卡自动成为固定卡, 到期插入不会改变它
  useEffect(() => {
    if (mode === "browse" || !card) return;
    setPinned(previous => previous && previous.key === queueKey && previous.cardId === card.id ? previous : { key: queueKey, cardId: card.id });
  }, [queueKey, card?.id, mode]);
  // R10: 换范围恢复上次浏览位置(按卡片 ID 定位); 固定卡与翻面状态一并重置
  useEffect(() => {
    setBrowsePosition({ scopeKey: locationKey, index: cardsReady ? loadBrowsePosition(localStorage, subject, locationKey, browseCards) : 0 });
    setRevealedCard(null);
    setPinned(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey, cardsReady]);
  // R10: 浏览时保存位置, 刷新/换页后可续看
  useEffect(() => {
    if (mode !== "browse") return;
    const current = browseCards[browseIndex];
    if (current) saveBrowsePosition(localStorage, subject, locationKey, current.id, browseIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, browseIndex, locationKey, cardsReady]);
  useEffect(() => setRevealedCard(null), [visibleCardKey]);
  // 搜索/错题本跳转: 定位到目标卡的浏览位置
  useEffect(() => {
    if (!jumpCardId) return;
    const index = browseCards.findIndex(item => item.id === jumpCardId);
    if (index >= 0) { setMode("browse"); setBrowsePosition({ scopeKey: locationKey, index }); setRevealedCard(null); }
  }, [jumpCardId]);
  function rate(grade: Rating) {
    if (!card || !flipped || mode === "browse") return;
    review.rateCard(card.id, grade, mode === "scope" ? currentScope : undefined);
    onRated?.(card, grade, wasNew);
    setPinned(null);
    setRevealedCard(null);
  }
  // 键盘: 空格/回车翻面, 1-4 评分, 浏览模式 ←/→
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 焦点在可交互元素上时让原生行为生效(如按钮的 Enter/空格点击), 组合键与按住重复也跳过
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("button, a, select, input, textarea, label, summary, [contenteditable], [role=button]") !== null)) return;
      if (document.querySelector(".key-modal, .backup-shade")) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealedCard(flipped ? null : visibleCardKey);
        return;
      }
      if (["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        rate(ratings[Number(event.key) - 1].grade);
        return;
      }
      if (mode === "browse" && event.key === "ArrowRight") { event.preventDefault(); setBrowsePosition(previous => ({ scopeKey: locationKey, index: previous.scopeKey === locationKey ? Math.min(previous.index + 1, browseCards.length - 1) : 1 })); return; }
      if (mode === "browse" && event.key === "ArrowLeft") { event.preventDefault(); setBrowsePosition(previous => ({ scopeKey: locationKey, index: previous.scopeKey === locationKey ? Math.max(previous.index - 1, 0) : 0 })); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const lastCard = cards.find(card => card.id === review.lastRating?.cardId);
  const showLastRating = mode !== "browse" && lastCard && (mode === "all" || cardMatchesStudyScope(lastCard, currentScope));
  return <>
    <div className="study-mode-tabs" role="group" aria-label="闪卡使用方式"><button className={mode === "scope" ? "active" : ""} aria-pressed={mode === "scope"} onClick={() => setMode("scope")}>当前章{section ? " / 小节" : ""}复习</button><button className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>全部学习范围复习</button><button className={mode === "browse" ? "active" : ""} aria-pressed={mode === "browse"} onClick={() => setMode("browse")}>当前章自由浏览</button></div>
    {mode !== "all" && <div className="study-location"><strong>{mode === "scope" ? "当前复习范围" : "当前浏览位置"}</strong>{picker}</div>}
    <StudyReviewScopes books={books} cards={cards} review={review} current={currentScope} showCurrent={mode !== "all"}/>
    {review.storageError && <p className="error study-storage-error" role="alert">{review.storageError}</p>}
    <div className="study-queue-summary">{mode !== "browse" ? <><span>已学到期 <b>{queue.counts.reviewDue}</b> 张 <small>（含短间隔回顾 {queue.counts.learningDue} 张）</small></span><span>今日新学 <b>{queue.counts.newToday}</b> 张</span><small>{mode === "all" ? "覆盖全部持续复习范围" : "仅当前章 / 小节的今日队列"} · 全部范围共享每日新卡余额 {queue.remainingNewLimit} 张</small></> : <><span>当前章{section ? " / 小节" : ""}共 <b>{browseCards.length}</b> 张</span><small>浏览不评分、不改变复习记录。加入学习范围后在复习模式评分。</small></>}</div>
    {showLastRating && review.lastRating && <p className="study-rating-confirmation" role="status">已记录「{lastCard.front}」· 下次复习：{formatStudyDue(review.lastRating.dueAt)}<button className="text-button undo-rating" onClick={() => { review.undoLastRating(); onUndoRating?.(); }}>撤销本次评分</button></p>}
    {!review.ready ? <div className="panel empty">正在读取学习记录…</div> : card ? <div className="flash-area">
      <div className="flash-top"><span>{books.find(book => book.id === card.book)?.name} · 第 {card.chapter} 章{card.section ? " · " + card.section : ""}</span><span>{mode !== "browse" && head ? `${head.kind === "new" ? "新卡" : head.kind === "learning" ? "短间隔回顾" : "到期复习"} · ${mode === "all" ? "全部队列" : "当前范围"}剩余 ${queue.items.length} 张` : `${browseIndex + 1} / ${browseCards.length}`}</span></div>
      <button className="flash-card" onClick={() => setRevealedCard(flipped ? null : visibleCardKey)}><small>{flipped ? "答案" : "问题"}</small><strong>{flipped ? card.back : card.front}</strong><span>{flipped ? card.source : "先自己回答，再点击查看答案"}</span>{flipped && card.sourceFile && <span className="original-source">原 PDF：{card.sourceFile}{card.sourcePages?.length ? " · 第 " + card.sourcePages.join("、") + " 页" : card.sourcePage ? " · 第 " + card.sourcePage + " 页" : ""}</span>}</button>
      <div className="rate-actions study-rate-actions">{!flipped ? <button className="primary" onClick={() => setRevealedCard(visibleCardKey)}>显示答案 <small className="kbd-hint">空格</small></button> : mode !== "browse" ? ratings.map(({ grade, label }, index) => {
        const preview = review.preview(card.id, grade);
        return <button key={grade} onClick={() => rate(grade)}>{label}<small className="kbd-hint">{index + 1}</small><span>{formatStudyDue(preview.dueAt)}</span></button>;
      }) : <button className="secondary" onClick={() => setRevealedCard(null)}>返回问题</button>}</div>
      {mode === "browse" && <div className="study-browse-nav"><button className="secondary" disabled={browseIndex === 0} onClick={() => setBrowsePosition(previous => ({ scopeKey: locationKey, index: previous.scopeKey === locationKey ? Math.max(previous.index - 1, 0) : 0 }))}>上一张</button><button className="secondary" disabled={browseIndex >= browseCards.length - 1} onClick={() => setBrowsePosition(previous => ({ scopeKey: locationKey, index: previous.scopeKey === locationKey ? Math.min(previous.index + 1, browseCards.length - 1) : 1 }))}>下一张</button></div>}
    </div> : <div className="panel empty study-queue-empty">{mode === "browse" ? "当前章 / 小节暂无闪卡，请切换浏览位置。" : <>
      <b>{mode === "scope" ? "当前章 / 小节暂无待复习卡" : review.progress.scopes.length ? "全部学习范围当前队列已完成" : "先选择今天想学的范围"}</b>
      {mode === "scope" ? <><p>可把当前章 / 小节加入上方今日新学范围，或切换到全部学习范围复习。切换位置不会自动加入学习。</p><p>当前范围只显示已进入今日队列的卡；新卡额度与其他范围共享。已学卡到期时会自动刷新。</p><button className="secondary" onClick={() => setMode("all")}>全部学习范围复习{review.queue.items.length ? `（${review.queue.items.length} 张）` : ""}</button></> : <p>{review.progress.scopes.length ? "已学卡会按评分时间再次进入队列；今日新卡来自上方所选范围。" : "上方可按书目勾选章节，或切回当前章复习并加入当前章 / 小节。"}</p>}
      {queue.nextDueAt && <p>{mode === "scope" ? "当前范围下次到期" : "下次到期"}：{formatStudyDue(queue.nextDueAt)} · 到时自动进入队列</p>}
      {queue.remainingNewLimit === 0 && <p>全部范围共享的今日新卡额度已用完。可以调整每日上限，或明天继续。</p>}
    </>}</div>}
  </>;
}
