import { useEffect, useMemo, useState } from "react";
import { formatStudyTime, readTimingRecords, timingComparisons, timingEnabled, setTimingEnabled, type CardTiming } from "../../lib/card-timing";
import { studyDate, type StatStore } from "../../lib/stats";

const kindLabel = { new: "新卡学习", learning: "短间隔回顾", review: "到期复习" };
const gradeLabel = { again: "重来", hard: "困难", good: "记住了", easy: "很熟悉" };
function AttemptHistory({ rows }: { rows: CardTiming[] }) {
  const [limit, setLimit] = useState(10);
  const reversed = [...rows].reverse();
  return <div className="timing-history"><ol>{reversed.slice(0, limit).map(row => <li key={row.id}>
    <time dateTime={row.startedAt}>{new Date(row.startedAt).toLocaleString("zh-CN", { hour12: false })}</time>
    <span>{kindLabel[row.kind]} · {row.status === "completed" ? gradeLabel[row.grade!] : row.status === "undone" ? "评分已撤销" : "中途离开 / 尚未评分"}</span>
    <b>{formatStudyTime(row.elapsedMs)}</b>
  </li>)}</ol>{limit < rows.length && <button className="text-button" onClick={() => setLimit(n => n + 20)}>显示更早的记录（剩余 {rows.length - limit} 次）</button>}</div>;
}
export function CardTimingStats({ subject, storage, tick }: { subject: string; storage: StatStore; tick: number }) {
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(20);
  const [settingsError, setSettingsError] = useState("");
  const enabled = useMemo(() => timingEnabled(storage), [storage, tick]);
  useEffect(() => { setQuery(""); setLimit(20); }, [subject]);
  const rows = useMemo(() => Object.values(readTimingRecords(storage, subject)), [subject, storage, tick]);
  const comparisons = useMemo(() => timingComparisons(rows), [rows]);
  const now = new Date(), today = studyDate(now);
  const dates = Array.from({ length: 14 }, (_, i) => { const date = new Date(now); date.setDate(date.getDate() - (13 - i)); return studyDate(date); });
  const totals = rows.reduce<Record<string, number>>((sum, row) => { for (const [date, ms] of Object.entries(row.days)) sum[date] = (sum[date] || 0) + ms; return sum; }, {});
  const complete = rows.filter(row => row.status === "completed");
  const filtered = comparisons.filter(item => `${item.latest.label} ${item.cardId}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="panel card-timing-stats" aria-label="闪卡背诵用时统计">
    <div className="panel-heading"><div><span className="eyebrow">RECALL TIME</span><h2>闪卡背诵用时</h2></div></div>
    <label className="timing-toggle"><input type="checkbox" aria-label="自动记录背诵用时" checked={enabled} onChange={event => setSettingsError(setTimingEnabled(storage, event.target.checked) ? "" : "自动计时设置未能保存，请释放浏览器存储空间后重试。")}/>自动记录背诵用时 <small>{enabled ? "已开启" : "已关闭 · 已有记录保留"}</small></label>
    {settingsError && <p className="error" role="alert">{settingsError}</p>}
    <p className="mock-help">只记录新卡学习和复习；自由浏览不计时。翻面继续计时，后台、锁屏与编辑期间暂停。用时包含回忆和查看答案，不能单独代表掌握程度。</p>
    <div className="timing-summary">
      <div><small>今日有效用时</small><strong>{formatStudyTime(totals[today] || 0)}</strong></div>
      <div><small>近 14 天</small><strong>{formatStudyTime(dates.reduce((sum, date) => sum + (totals[date] || 0), 0))}</strong></div>
      <div><small>累计有效用时</small><strong>{formatStudyTime(rows.reduce((sum, row) => sum + row.elapsedMs, 0))}</strong></div>
      <div><small>已完成背诵 / 平均用时</small><strong>{complete.length} 次 / {formatStudyTime(complete.length ? complete.reduce((sum, row) => sum + row.elapsedMs, 0) / complete.length : 0)}</strong></div>
    </div>
    <details className="timing-days"><summary>近 14 天每日用时</summary><div>{dates.map(date => <span key={date}><time>{date.slice(5)}</time><b>{formatStudyTime(totals[date] || 0)}</b></span>)}</div></details>
    <h3>同一卡的背诵进步</h3>
    <p className="mock-help">对比当前内容的首次与最近一次完成背诵；中途离开、未评分和撤销评分的记录保留用时，但不参与速度对比。修改问题、答案或补充后开始新的对比，旧记录仍可查看。</p>
    <label className="timing-search">查找卡片<input type="search" value={query} placeholder="输入问题或卡片编号" onChange={event => { setQuery(event.target.value); setLimit(20); }}/></label>
    {filtered.length ? <div className="timing-cards">{filtered.slice(0, limit).map(item => <details key={item.cardId}>
      <summary><span className="timing-card-label">{item.latest.label || item.cardId}<small>{item.history.length} 次记录 · 当前内容完成 {item.completedCount} 次</small></span><span className="timing-comparison">
        {item.first && item.last ? <>首次 {formatStudyTime(item.first.elapsedMs)} → 最近 {formatStudyTime(item.last.elapsedMs)}<b>{item.improvement === null ? "再完成一次即可对比" : Math.abs(item.improvement) < 0.05 ? "用时基本持平" : `${item.improvement > 0 ? "用时减少" : "用时增加"} ${Math.abs(item.improvement).toFixed(1)}%`}</b></> : <>最近有效用时 {formatStudyTime(item.latest.elapsedMs)}<b>尚无完成背诵记录</b></>}
      </span></summary>
      <small className="timing-card-id">卡片编号：{item.cardId}</small><AttemptHistory rows={item.history}/>
    </details>)}</div> : <p className="mock-help">{rows.length ? "没有匹配的卡片。" : "还没有背诵用时记录。开始新卡学习或复习，评分或离开闪卡后即可在这里查看。"}</p>}
    {limit < filtered.length && <button className="secondary" onClick={() => setLimit(n => n + 20)}>显示更多卡片（剩余 {filtered.length - limit} 张）</button>}
    <p className="mock-help">从功能启用后开始记录，历史学习无法补算；用时随账号自动同步，并包含在 PDF 备份中。中途离开的有效用时也计入总时长。</p>
  </section>;
}
