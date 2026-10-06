import { useEffect, useState } from "react";
import { loadTrainingBook } from "../../lib/essay-training-data";
import { scopedTrainingEntries, type ResolvedTrainingEntry, type TrainingScope } from "../../lib/essay-training";

type KnowledgeCard = { id: string; front: string; back: string; source: string };
type Props = { scope: TrainingScope; bookName: string; chapterTitle?: string; cards: KnowledgeCard[]; open: boolean; onOpenChange: (open: boolean) => void };
const questionTypes = { "short-answer": "简答题", essay: "论述题", material: "材料题" };

/** The caller keys this panel by the visible card's book/chapter/section. */
export function SectionEssayTraining({ scope, bookName, chapterTitle, cards, open, onOpenChange }: Props) {
  const [load, setLoad] = useState<{ status: "idle" | "loading" | "ready" | "error"; entries: ResolvedTrainingEntry[] }>({ status: "idle", entries: [] });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [answerOpen, setAnswerOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ status: "loading", entries: [] });
    loadTrainingBook(scope.book).then(entries => {
      if (!cancelled) setLoad({ status: "ready", entries });
    }).catch(() => {
      if (!cancelled) setLoad({ status: "error", entries: [] });
    });
    return () => { cancelled = true; };
  }, [scope.book, open, attempt]);
  const entries = scopedTrainingEntries(load.entries, scope);
  const entry = entries[index];
  function move(next: number) { setIndex(next); setAnswerOpen(false); }
  return <section className="panel section-essay-training" aria-label="本节大题训练">
    <button className="section-essay-toggle" aria-expanded={open} aria-controls="section-essay-content" onClick={() => { onOpenChange(!open); setAnswerOpen(false); }}>
      <span><b>本节大题训练</b><small>{scope.section ? "简答 · 论述 · 材料" : "框架卡 · 本章去重题"}</small></span><span aria-hidden="true">{open ? "收起 −" : "展开 ＋"}</span>
    </button>
    {open && <div id="section-essay-content" className="section-essay-content">
      <p className="section-essay-scope">{bookName} · 第 {scope.chapter} 章{chapterTitle ? " · " + chapterTitle : ""}<br/>{scope.section || "本章全部小节（相同资料原题合并显示）"}</p>
      <p className="section-essay-help">先口述或在纸上组织答案，再展开对照。训练展开期间，闪卡键盘快捷键暂停；仍可点击闪卡按钮评级。</p>
      {(load.status === "idle" || load.status === "loading") && <p role="status">正在读取大题资料…</p>}
      {load.status === "error" && <div role="alert"><p>大题资料加载失败，请重试。</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>重新加载大题资料</button></div>}
      {load.status === "ready" && !entry && <p className="empty">当前{scope.section ? "小节" : "章"}暂无大题训练资料。</p>}
      {load.status === "ready" && entry && <>
        <div className="section-essay-nav" role="group" aria-label="大题翻题"><button className="secondary" disabled={index === 0} onClick={() => move(index - 1)}>上一题</button><span>{index + 1} / {entries.length} 题</span><button className="secondary" disabled={index >= entries.length - 1} onClick={() => move(index + 1)}>下一题</button></div>
        <article className="section-essay-question" key={entry.id}>
          <div className="section-essay-tags"><span>{entry.origin === "source-question" ? "资料原题" : "资料改编"}</span><span>{questionTypes[entry.questionType]}</span><span>{entry.section}</span></div>
          <h3>{entry.topic}</h3>
          <p className="section-essay-text">{entry.stem}</p>
          <p className="section-essay-source">来源：{entry.source}{entry.originalQuestionId && <><br/>原题记录：{entry.originalQuestionId}</>}</p>
          {entry.ocrWarning && <div className="section-essay-warning"><b>原资料 OCR 校对提示</b><p>{entry.ocrWarning}</p></div>}
          <button className="primary" aria-expanded={answerOpen} aria-controls="section-essay-answer" onClick={() => setAnswerOpen(value => !value)}>{answerOpen ? "收起参考答案与解析" : "展开参考答案与解析"}</button>
          {answerOpen && <div id="section-essay-answer" className="section-essay-answer">
            <h4>参考答案</h4><p className="section-essay-text">{entry.referenceAnswer}</p>
            <h4>本节关联解析</h4><p className="section-essay-text">{entry.analysis}</p>
            <p className="section-essay-help">答案为资料参考，非官方评分标准；有依据的其他作答路径可结合材料核对。</p>
          </div>}
          <details className="section-essay-knowledge"><summary>关联知识卡 · {entry.knowledgeCardIds.length} 张</summary><ul>{entry.knowledgeCardIds.map(id => {
            const card = cards.find(item => item.id === id);
            return <li key={id}>{card ? <details><summary>{card.front}</summary><p className="section-essay-text">{card.back}</p><small>来源：{card.source} · 卡片 {id}</small></details> : <span>卡片 {id} · 知识卡资料尚未载入</span>}</li>;
          })}</ul></details>
        </article>
      </>}
    </div>}
  </section>;
}
