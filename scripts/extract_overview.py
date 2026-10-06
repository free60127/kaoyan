# -*- coding: utf-8 -*-
"""从 page.tsx 抽取三个 overview 大块为 OverviewPanels.tsx 组件。"""
import io, re

p = 'app/page.tsx'
src = io.open(p, encoding='utf-8').read()
lines = src.split('\n')

blocks = {}
for i, tag in [(357, '333'), (358, '825'), (359, 'politics')]:
    l = lines[i]
    m = re.match(r'\s*\{view === "overview" && subject === "\w+" && <\>(.*)</>\}', l)
    assert m, 'line %d mismatch: %s' % (i + 1, l[:60])
    body = m.group(1)
    body = body.replace('review.progress.dailyNewLimit', 'dailyLimit')
    body = body.replace('setView(', 'onSetView(')
    body = body.replace('chooseChapter(', 'onChooseBook(')
    body = body.replace('activeBook?.name', 'activeBookName')
    body = body.replace('pastQuestions.length', 'pastQuestionCount')
    body = body.replace('allCards.length', 'cardCount')
    blocks[tag] = body
    lines[i] = '          {view === "overview" && subject === "%s" && <Overview%s {...overviewProps}/>}' % (tag, tag)

header = '''import { BookOpen, Check, ChevronRight, CircleHelp, Layers3, Target } from "lucide-react";

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
  dailyLimit: number;
  score: { right: number; total: number };
  pastQuestionCount: number;
  cardCount: number;
  chapter: number;
  chapterName: string;
  activeBookName: string;
  onChooseBook: (bookId: string) => void;
  onSetView: (view: "cards" | "quiz" | "chapters" | "feynman") => void;
};

export function Stat({ Icon, label, value, note }: { Icon: typeof BookOpen; label: string; value: string; note: string }) {
  return <div className="stat"><span className="stat-icon"><Icon size={20}/></span><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
}
'''

parts = [header]
for tag in ('333', '825', 'politics'):
    parts.append('\nexport function Overview%s(props: OverviewProps) {\n  const { subjectLabel, books, done, completed, totalChapters, total333, due, newToday, dailyLimit, score, pastQuestionCount, cardCount, chapter, chapterName, activeBookName, onChooseBook, onSetView } = props;\n  return <>%s</>;\n}\n' % (tag, blocks[tag]))

io.open('app/components/OverviewPanels.tsx', 'w', encoding='utf-8').write('\n'.join(parts))
io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('extracted:', {k: len(v) for k, v in blocks.items()})
