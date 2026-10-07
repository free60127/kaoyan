import { BookOpen, Check, ChevronRight, CircleHelp, Layers3, Target } from "lucide-react";

function heading(label: string, title: string, description: string) {
  return <div className="page-head"><span className="eyebrow">{label}</span><h1>{title}</h1><p>{description}</p></div>;
}

export type OverviewBook = { id: string; name: string; short: string; tone: string; chapters: { title: string }[] };

type OverviewProps = {
  subjectLabel: string;
  books: OverviewBook[];
  done: Record<string, boolean>;
  completed: number;
  totalChapters: number;
  total333: number;
  due: number;
  newToday: number;
  studiedToday: number;
  reviewReady: boolean;
  dailyLimit: number;
  score: { right: number; total: number };
  pastQuestionCount: number;
  cardCount: number;
  perBookCards: Record<string, number>;
  chapter: number;
  chapterName: string;
  activeBookName: string;
  onChooseBook: (bookId: string) => void;
  onSetView: (view: "cards" | "quiz" | "chapters" | "feynman" | "choice") => void;
};

export function Stat({ Icon, label, value, note }: { Icon: typeof BookOpen; label: string; value: string; note: string }) {
  return <div className="stat"><span className="stat-icon"><Icon size={20}/></span><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
}


export function Overview333(props: OverviewProps) {
  const { books, done, completed, total333, due, newToday, studiedToday, reviewReady, dailyLimit, score, perBookCards, chapter, chapterName, activeBookName, onChooseBook, onSetView } = props;
  return <>{heading("GOOD TO SEE YOU", "今天，继续向目标靠近。", "从一个章节开始，学一点、讲出来、再用真题检验。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="333 已学章节" value={completed + " / " + total333} note="四本应试解析"/><Stat Icon={Layers3} label="当前待复习" value={reviewReady ? String(due) : "—"} note={reviewReady ? "持续复习范围内的到期卡" : "正在读取学习记录…"}/><Stat Icon={Layers3} label="今日已学新卡" value={reviewReady ? String(studiedToday) : "—"} note={reviewReady ? "今日剩余新卡 " + newToday + " 张 · 上限 " + dailyLimit + " 张" : "正在读取学习记录…"}/><Stat Icon={Target} label="练习正确率" value={score.total ? Math.round(score.right / score.total * 100) + "%" : "—"} note={score.total ? "本次已答 " + score.total + " 题" : "开始真题练习"}/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">FOUR BOOKS</span><h2>333 · 四本书</h2></div><button className="text-button" onClick={() => onSetView("chapters")}>查看全部 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; return <button key={item.id} className="book-row" onClick={() => onChooseBook(item.id)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">YOUR NEXT STEP</span><h2>继续上次的节奏</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBookName} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => onSetView("cards")}>开始闪卡复习</button><button className="secondary" onClick={() => onSetView("quiz")}>做一道真题</button></div><small className="source-status"><Check size={15}/> 题目附有年份、题号与来源页码</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>资料与真题</h2><p>四本《27KC 333 应试解析》建立章节目录；练习题来自 2024、2025、2026 年 333 真题。扫描页经 OCR 校对后使用。</p></div><div className="year-chips"><span>2024 真题</span><span>2025 真题</span><span>2026 真题</span></div></section></>;
}


export function Overview825(props: OverviewProps) {
  const { books, done, completed, totalChapters, due, newToday, studiedToday, reviewReady, dailyLimit, pastQuestionCount, cardCount, perBookCards, chapter, chapterName, activeBookName, onChooseBook, onSetView } = props;
  return <>{heading("TODAY'S STUDY", "825 · 英语专业基础", "按两本书的章节与小节推进；历年真题已按章节归档为真题卡。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="已学章节" value={completed + " / " + totalChapters} note="语言学与英美文学"/><Stat Icon={Layers3} label="当前待复习" value={reviewReady ? String(due) : "—"} note={reviewReady ? "持续复习范围内的到期卡" : "正在读取学习记录…"}/><Stat Icon={Layers3} label="今日已学新卡" value={reviewReady ? String(studiedToday) : "—"} note={reviewReady ? "今日剩余新卡 " + newToday + " 张 · 上限 " + dailyLimit + " 张" : "正在读取学习记录…"}/><Stat Icon={CircleHelp} label="历年题" value={String(pastQuestionCount)} note="可练习与索引混合统计"/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">TWO BOOKS</span><h2>825 · 两本书</h2></div><button className="text-button" onClick={() => onSetView("chapters")}>查看章节 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; return <button key={item.id} className="book-row" onClick={() => onChooseBook(item.id)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {perBookCards[item.id] || 0} 张卡 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">NEXT STEP</span><h2>继续学习</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBookName} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => onSetView("cards")}>打开今日复习队列</button><button className="secondary" onClick={() => onSetView("quiz")}>练习历年题</button></div><small className="source-status"><Check size={15}/> 按书目与年份筛选；真题已按章节归档，章节学习中可看本章真题卡</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>笔记和真题索引</h2><p>语言学与英美文学闪卡含笔记卡与按章节归档的历年真题卡；题目显示来源状态、PDF 文件和页码。</p></div><div className="year-chips"><span>94 道可练习</span><span>74 条索引</span><span>2010—2026</span></div></section></>;
}


export function OverviewPolitics(props: OverviewProps) {
  const { books, done, completed, totalChapters, due, newToday, studiedToday, reviewReady, dailyLimit, cardCount, perBookCards, chapter, chapterName, activeBookName, onChooseBook, onSetView } = props;
  return <>{heading("TODAY'S STUDY", "政治 · 五科考点", "按马原、毛中特、新思想、史纲、思修的教材章节推进，闪卡覆盖全部考点。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="已学章节" value={completed + " / " + totalChapters} note="五科教材章节"/><Stat Icon={Layers3} label="当前待复习" value={reviewReady ? String(due) : "—"} note={reviewReady ? "持续复习范围内的到期卡" : "正在读取学习记录…"}/><Stat Icon={Layers3} label="今日已学新卡" value={reviewReady ? String(studiedToday) : "—"} note={reviewReady ? "今日剩余新卡 " + newToday + " 张 · 上限 " + dailyLimit + " 张" : "正在读取学习记录…"}/><Stat Icon={Layers3} label="考点闪卡" value={String(cardCount)} note="徐涛强化笔记 + 肖1000背诵要点"/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">FIVE BOOKS</span><h2>政治 · 五本书</h2></div><button className="text-button" onClick={() => onSetView("chapters")}>查看章节 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; return <button key={item.id} className="book-row" onClick={() => onChooseBook(item.id)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {perBookCards[item.id] || 0} 张卡 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">NEXT STEP</span><h2>继续学习</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBookName} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => onSetView("cards")}>打开今日复习队列</button><button className="secondary" onClick={() => onSetView("choice")}>选择题自测</button><button className="secondary" onClick={() => onSetView("feynman")}>口述本章考点</button></div><small className="source-status"><Check size={15}/> 每张卡附资料出处与 PDF 页码</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>资料说明</h2><p>《27徐涛强化笔记（完整版）》提供考点体系（选择/分析题重点标注），《肖1000题背诵要点（汇总版）》补充易错辨析；章节按 2027 教材目录组织，共 {cardCount} 张闪卡。</p></div><div className="year-chips"><span>马原</span><span>毛中特</span><span>新思想</span><span>史纲</span><span>思修</span></div></section></>;
}
