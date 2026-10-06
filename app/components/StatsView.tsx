import { useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { lastNDays, streakDays, type DayStat, type StatStore } from "@/lib/stats";

type Book = { id: string; name: string; short: string; tone: string; chapters: unknown[] };

export function StatsView({ subject, subjectLabel, books, done, due, learnedCards, totalCards, storage }: {
  subject: string; subjectLabel: string; books: Book[]; done: Record<string, boolean>; due: number; learnedCards: number; totalCards: number; storage: StatStore;
}) {
  const [tick, setTick] = useState(0);
  const days: DayStat[] = useMemo(() => lastNDays(storage, subject, 14), [subject, tick]);
  const streak = useMemo(() => streakDays(storage, subject), [subject, tick]);
  const today = days[days.length - 1] || { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 } as DayStat;
  const max = Math.max(1, ...days.map((day) => day.ratings + day.quiz));
  const refresh = () => setTick((value) => value + 1);
  return <div className="stats-layout">
    <div className="stats study-stats">
      <div className="stat"><span className="stat-icon"><Flame size={20}/></span><small>连续学习</small><strong>{streak} 天</strong><span>有评分或答题即计入</span></div>
      <div className="stat"><span className="stat-icon">📅</span><small>今日评分</small><strong>{today.ratings} 次</strong><span>重来 {today.again} 次</span></div>
      <div className="stat"><span className="stat-icon">🧩</span><small>今日新学 / 练习</small><strong>{today.newCards} / {today.quiz}</strong><span>练习答对 {today.quizCorrect} 题</span></div>
      <div className="stat"><span className="stat-icon">📈</span><small>当前复习状态</small><strong>{due} 张到期</strong><span>已学 {learnedCards} / {totalCards} 张卡</span></div>
    </div>
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
      <div className="panel-heading"><div><span className="eyebrow">CHAPTER PROGRESS</span><h2>各书章节进度</h2></div></div>
      <div className="book-list">{books.map((item) => {
        const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length;
        return <div key={item.id} className="book-row static-row"><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{count} / {item.chapters.length} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div></div>;
      })}</div>
    </section>
  </div>;
}
