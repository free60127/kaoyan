import { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { lastNDays, streakDays, listStats, type DayStat, type StatStore } from "@/lib/stats";
import { type ActivityEntry } from "@/lib/activity";
import { readVisibleMistakes } from "@/lib/mistakes";
import { CardTimingStats } from "./CardTimingStats";

type LoadDay = { date: string; review: number; learning: number };

type Book = { id: string; name: string; short: string; tone: string; chapters: unknown[] };

export function StatsView({ subject, subjectLabel, books, done, due, learnedCards, totalCards, storage, forecast, activities, cards, onChooseChapter }: {
  subject: string; subjectLabel: string; books: Book[]; done: Record<string, boolean>; due: number; learnedCards: number; totalCards: number; storage: StatStore; forecast: LoadDay[]; activities: ActivityEntry[];
  cards: { id: string; book: string; chapter: number }[];
  onChooseChapter?: (book: string, chapter: number) => void;
}) {
  const [tick, setTick] = useState(0);
  // 统计必须跟随数据变化, 不能只靠手动刷新: 跨标签 storage 写入、本页写入事件、跨日零点都触发重算
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.includes("yantu-stats") || event.key.includes("yantu-activity") || event.key.includes("yantu-card-timing")) bump();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("yantu-storage-saved", bump);
    let day = new Date().toDateString();
    const timer = window.setInterval(() => {
      const now = new Date().toDateString();
      if (now !== day) { day = now; bump(); }
    }, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("yantu-storage-saved", bump);
      window.clearInterval(timer);
    };
  }, []);
  const days: DayStat[] = useMemo(() => lastNDays(storage, subject, 14), [subject, tick, storage]);
  const streak = useMemo(() => streakDays(storage, subject), [subject, tick, storage]);
  const today = days[days.length - 1] || { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 } as DayStat;
  // E: 总体正确率(全部历史 quiz/quizCorrect)与薄弱章节 Top10(错题按卡章节聚合)
  const accuracy = useMemo(() => {
    const totals = listStats(storage, subject).reduce((acc, day) => ({ quiz: acc.quiz + day.quiz, correct: acc.correct + day.quizCorrect }), { quiz: 0, correct: 0 });
    return { ...totals, rate: totals.quiz ? Math.round(100 * totals.correct / totals.quiz) : null };
    // tick 由跨标签/跨日监听触发
  }, [storage, subject, tick]);
  const weakChapters = useMemo(() => {
    const byChapter = new Map<string, { book: string; chapter: number; name: string; count: number }>();
    for (const mistake of readVisibleMistakes()) {
      if (mistake.subject !== subject || mistake.kind !== "card") continue;
      const card = cards.find(item => item.id === mistake.refId);
      if (!card) continue;
      const key = card.book + ":" + card.chapter;
      const entry = byChapter.get(key) || { book: card.book, chapter: card.chapter, name: books.find(item => item.id === card.book)?.name || card.book, count: 0 };
      entry.count += 1;
      byChapter.set(key, entry);
    }
    return [...byChapter.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  }, [subject, cards, books, tick]);
  const max = Math.max(1, ...days.map((day) => day.ratings + day.quiz));
  const refresh = () => setTick((value) => value + 1);
  return <div className="stats-layout">
    <div className="stats study-stats">
      <div className="stat"><span className="stat-icon"><Flame size={20}/></span><small>连续学习</small><strong>{streak} 天</strong><span>有评分或答题即计入</span></div>
      <div className="stat"><span className="stat-icon">📅</span><small>今日评分</small><strong>{today.ratings} 次</strong><span>重来 {today.again} 次</span></div>
      <div className="stat"><span className="stat-icon">🧩</span><small>今日新学 / 练习</small><strong>{today.newCards} / {today.quiz}</strong><span>练习答对 {today.quizCorrect} 题</span></div>
      <div className="stat"><span className="stat-icon">🎯</span><small>总体正确率</small><strong>{accuracy.rate === null ? "—" : accuracy.rate + "%"}</strong><span>累计 {accuracy.correct} / {accuracy.quiz} 题</span></div>
      <div className="stat"><span className="stat-icon">📈</span><small>当前复习状态</small><strong>{due} 张到期</strong><span>已学 {learnedCards} / {totalCards} 张卡</span></div>
    </div>
    <CardTimingStats subject={subject} storage={storage} tick={tick}/>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">LAST 14 DAYS</span><h2>{subjectLabel} · 近 14 天</h2></div><button className="text-button" onClick={refresh}>刷新</button></div>
      <div className="stats-chart" role="img" aria-label="近14天学习量柱状图">
        {days.map((day) => <div key={day.date} className="chart-column" title={`${day.date}：评分 ${day.ratings} · 练习 ${day.quiz}`}>
          <div className="chart-bars">
            <i style={{ height: `${100 * day.ratings / max}%` }} className="bar-rating"/>
            <i style={{ height: `${100 * day.quiz / max}%` }} className="bar-quiz"/>
          </div>
          <small>{day.date.slice(5)}</small>
        </div>)}
      </div>
      <div className="chart-legend"><span><i className="bar-rating"/>闪卡评分</span><span><i className="bar-quiz"/>练习答题</span></div>
      <p className="mock-help">统计自本功能启用起按日累计，保存在本浏览器。</p>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">UPCOMING LOAD</span><h2>未来 14 天复习负荷</h2></div></div>
      <div className="load-chart" role="img" aria-label="未来14天复习负荷图">
        {forecast.map((day) => {
          const max = Math.max(1, ...forecast.map(item => item.review + item.learning));
          return <div key={day.date} className="chart-column" title={`${day.date}：到期复习 ${day.review} · 短间隔回顾 ${day.learning}`}>
            <div className="chart-bars">
              <i style={{ height: `${100 * day.review / max}%` }} className="bar-review"/>
              <i style={{ height: `${100 * day.learning / max}%` }} className="bar-learning"/>
            </div>
            <small>{day.date.slice(5)}</small>
          </div>;
        })}
      </div>
      <div className="chart-legend"><span><i className="bar-review"/>到期复习</span><span><i className="bar-learning"/>短间隔回顾</span></div>
      <p className="mock-help">新卡不排期、不计入负荷；连续学习会让短间隔回顾落在未来几天内。到期总数 {forecast.reduce((sum, day) => sum + day.review, 0)} 张。</p>
    </section>
    {weakChapters.length > 0 && <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">WEAK SPOTS</span><h2>薄弱章节 Top {weakChapters.length}</h2></div><small className="source-status">按错题卡所在章统计</small></div>
      <div className="weak-list">
        {weakChapters.map(entry => <div key={entry.book + ":" + entry.chapter} className="weak-row">
          <span className="weak-name">{entry.name} · 第 {entry.chapter} 章</span>
          <span className="weak-count">{entry.count} 张错题卡</span>
          {onChooseChapter && <button className="secondary" onClick={() => onChooseChapter(entry.book, entry.chapter)}>去复习</button>}
        </div>)}
      </div>
      <p className="mock-help">错题在闪卡复习里答对后会自动移出错题本；这里的排序会随之改善。</p>
    </section>}
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">TODAY'S LOG</span><h2>今天实际完成了什么</h2></div></div>
      {activities.length === 0 ? <p className="mock-help">今天还没有记录。闪卡评分、真题与自测答题都会出现在这里。</p> : <div className="activity-list">
        {activities.map((entry, index) => <div key={entry.t + String(index)} className="activity-row">
          <small>{new Date(entry.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</small>
          <span className={"activity-kind kind-" + entry.kind}>{entry.kind === "rating" ? "评分" : entry.kind === "undo" ? "撤销" : entry.kind === "quiz" ? "真题" : "自测"}</span>
          <b>{entry.label}</b>
          {entry.detail && <small>{entry.detail}</small>}
        </div>)}
      </div>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">CHAPTER PROGRESS</span><h2>各书章节进度</h2></div></div>
      <div className="book-list">{books.map((item) => {
        const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length;
        return <div key={item.id} className="book-row static-row"><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{count} / {item.chapters.length} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div></div>;
      })}</div>
    </section>
  </div>;
}
