/** 科目能力的唯一事实源: 导航过滤、资料懒加载触发、备份/位置校验都从这里派生。 */
import { Target, BookOpen, Layers3, CircleHelp, ClipboardList, Sparkles, Mic, LineChart, Search, FileText, type LucideIcon } from "lucide-react";
import type { StudySubject, StudyView } from "./learning-session";

export type SubjectInfo = { id: StudySubject; name: string; mark: string; short: string; tone: string; hasData: boolean; books: string[] };
export type ViewInfo = { id: StudyView; label: string; Icon: LucideIcon; group: "学习" | "练习" | "工具" };

/** 每个科目的书目 ID(静态目录; 异步资料加载后按此校验)。 */
export const subjectBooks: Record<StudySubject, string[]> = {
  english: [],
  politics: ["mayuan", "maozhongte", "xinsixiang", "shigang", "sixiu"],
  "333": ["principles", "china", "foreign", "psychology"],
  "825": ["linguistics", "literature"],
};

/** 科目是否已接入真实资料(导航展示"已接入")。 */
export const subjectHasData: Record<StudySubject, boolean> = { english: false, politics: true, "333": true, "825": true };

/** 页面在各科目是否可用: 与 learning-session 的位置恢复、study-backup 的校验一致。
 *  政治没有真题与模拟卷数据。 */
export function viewAvailable(subject: StudySubject, view: StudyView): boolean {
  if (subject === "politics" && (view === "quiz" || view === "mock")) return false;
  if (view === "essay") return subject === "333"; // 主观题库目前仅 333 资料
  return true;
}

export const subjects: SubjectInfo[] = [
  { id: "english", name: "英语二", mark: "EN", short: "英二", tone: "#8a8f9e", hasData: false, books: subjectBooks.english },
  { id: "politics", name: "政治", mark: "PO", short: "政治", tone: "#b04a4a", hasData: true, books: subjectBooks.politics },
  { id: "333", name: "333 教育综合", mark: "33", short: "333", tone: "#4976b6", hasData: true, books: subjectBooks["333"] },
  { id: "825", name: "825 英语专业基础", mark: "82", short: "825", tone: "#9478ad", hasData: true, books: subjectBooks["825"] },
];

/** 页面清单(按侧栏分组展示)。 */
export const views: ViewInfo[] = [
  { id: "overview", label: "今日概览", Icon: Target, group: "学习" },
  { id: "chapters", label: "章节学习", Icon: BookOpen, group: "学习" },
  { id: "cards", label: "Anki 闪卡", Icon: Layers3, group: "学习" },
  { id: "quiz", label: "真题练习", Icon: CircleHelp, group: "练习" },
  { id: "essay", label: "主观题库", Icon: FileText, group: "练习" },
  { id: "practice", label: "选择自测", Icon: ClipboardList, group: "练习" },
  { id: "mock", label: "AI 模拟卷", Icon: Sparkles, group: "练习" },
  { id: "mistakes", label: "错题本", Icon: ClipboardList, group: "工具" },
  { id: "stats", label: "学习统计", Icon: LineChart, group: "工具" },
  { id: "search", label: "搜索", Icon: Search, group: "工具" },
  { id: "feynman", label: "费曼复述", Icon: Mic, group: "工具" },
  { id: "planner", label: "AI 学习计划", Icon: Sparkles, group: "工具" },
];

/** 某科目侧栏应显示的页面(已按可用性过滤)。 */
export function sidebarViews(subject: StudySubject): ViewInfo[] {
  return views.filter(view => viewAvailable(subject, view.id));
}
