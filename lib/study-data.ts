import { outlines } from "./outlines";
import { chapterHighlights } from "./chapter-highlights";
import pastQuestions from "./past-questions.json";

export type Card = { id: string; book: string; chapter: number; front: string; back: string; source: string };
export type Question = { id: string; year: number; book: string; chapter: number; stem: string; options: string[]; answer: number; explanation: string; source: string };

export const books = [
  { id: "principles", name: "教育学原理", short: "教原", tone: "#4976b6", chapters: ["教育及其产生与发展", "教育与社会发展", "教育与人的发展", "教育目的与培养目标", "教育制度", "课程", "教学", "德育"] },
  { id: "china", name: "中国教育史", short: "中教", tone: "#bc7856", chapters: ["官学制度的建立与“六艺”教育的形成", "私人讲学的兴起与传统教育思想的奠基", "儒学独尊与读经做官教育模式的初步形成", "封建国家教育体制的完善", "理学教育思想和学校的改革与发展", "理学教育思想的批判与反思", "近代教育的起步", "近代教育体系的建立", "近代教育体制的变革", "南京国民政府时期的教育", "新民主主义教育的发展", "现代教育家的教育理论与实践"] },
  { id: "foreign", name: "外国教育史", short: "外教", tone: "#719184", chapters: ["东方文明古国的教育", "古希腊教育", "古罗马教育", "西欧中世纪教育", "文艺复兴与宗教改革时期的教育", "英国的近现代教育制度", "法国的近现代教育制度", "德国的近现代教育制度", "俄国（苏联）的近现代教育制度", "美国的近现代教育制度", "日本的近现代教育制度", "近现代主要的教育家", "近现代超级重要的教育家", "近现代教育思潮"] },
  { id: "psychology", name: "教育心理学", short: "教心", tone: "#9478ad", chapters: ["心理发展与教育", "学习及其理论解释", "学习动机", "知识的建构", "技能的形成", "学习策略及其教学", "问题解决能力与创造性的培养", "社会规范学习、态度与品德发展"] },
] as const;

export const cards: Card[] = [
  { id: "p1", book: "principles", chapter: 1, front: "谢弗勒把教育语言陈述分为哪三类？", back: "教育定义、教育口号、教育隐喻。教育定义又可分为描述性、规定性、纲领性定义。", source: "《应试解析·教育学原理》对应章节（2027版）" },
  { id: "p2", book: "principles", chapter: 1, front: "教育口号有什么特点？", back: "在特定社会情境下提出，表达教育目的或理念；语言简练、明晰、通俗，具有宣传和鼓励作用。", source: "《应试解析·教育学原理》对应章节（2027版）" },
  { id: "p3", book: "principles", chapter: 1, front: "狭义教育主要指什么？", back: "主要指学校教育：依据社会要求和学生身心发展规律，有目的、有计划、有组织地培养人的活动。", source: "《应试解析·教育学原理》对应章节（2027版）" },
  { id: "p4", book: "principles", chapter: 3, front: "人的身心发展差异性对教育有什么要求？", back: "从学生实际出发，了解个体差异，因材施教。", source: "2024 年 333 真题及解析 PDF 第2页" },
  { id: "p5", book: "principles", chapter: 6, front: "“鱼稻共生”课程由教师、学生、家长和乡政府协商开发，体现哪种课程开发模式？", back: "实践模式；重视具体情境中的参与、协商与实践。", source: "2026 年 333 真题及解析 PDF 第3页" },
  { id: "c1", book: "china", chapter: 1, front: "西周“六艺”是哪六项？", back: "礼、乐、射、御、书、数。", source: "《应试解析·中国教育史》对应章节（2027版）" },
  { id: "c2", book: "china", chapter: 1, front: "“六艺”中的“大艺”和“小艺”如何区分？", back: "礼乐是中心，主要安排在大学；书数为文化基础知识技能，作为“小艺”主要安排在小学。", source: "《应试解析·中国教育史》对应章节（2027版）" },
  { id: "c3", book: "china", chapter: 2, front: "稷下学宫的基本特点是什么？", back: "学术自由：容纳百家、派别平等、来去自由、相互争鸣；兼具讲学、著述、育才和咨政议政功能。", source: "《应试解析·中国教育史》对应章节（2027版）" },
  { id: "f1", book: "foreign", chapter: 1, front: "苏美尔学校为什么被称为“泥板书舍”？", back: "泥板制成的“书”是主要教学和书写工具，因此得名。", source: "《应试解析·外国教育史》对应章节（2027版）" },
  { id: "f2", book: "foreign", chapter: 1, front: "古代埃及常见的学校类型有哪些？", back: "宫廷学校、僧侣学校、职官学校和文士学校。", source: "《应试解析·外国教育史》对应章节（2027版）" },
  { id: "f3", book: "foreign", chapter: 1, front: "古代印度佛教教育的重要场所是什么？", back: "寺院；寺院学校既是教育机构，也是学术研究场所。", source: "《应试解析·外国教育史》对应章节（2027版）" },
  { id: "y1", book: "psychology", chapter: 1, front: "皮亚杰和维果茨基的理论主要归入本书哪一节？", back: "第一章第二节“认知发展理论与教育”。复述时比较认知发展的内部建构与社会文化支持。", source: "《应试解析·教育心理学》对应章节（2027版）" },
  { id: "y2", book: "psychology", chapter: 2, front: "行为主义学习理论在本书中有哪些代表人物？", back: "巴甫洛夫、华生、桑代克、斯金纳、班杜拉。可按经典条件作用、操作性条件作用、观察学习来整理。", source: "《应试解析·教育心理学》对应章节（2027版）" },
  { id: "y3", book: "psychology", chapter: 3, front: "成败归因理论中，运气属于哪种归因？", back: "外部、不稳定、不可控。", source: "2024 年 333 真题及解析 PDF 第8页" },
  { id: "y4", book: "psychology", chapter: 6, front: "“由薄到厚”不断补充材料，属于哪种学习策略？", back: "精细加工策略：补充信息并建立联系，加深理解和记忆。", source: "2026 年 333 真题及解析 PDF 第8页" },
];

for (const book of books) {
  outlines[book.id]?.forEach((sections, index) => {
    if (sections.length < 2) return;
    cards.push({
      id: `outline-${book.id}-${index + 1}`,
      book: book.id,
      chapter: index + 1,
      front: `不看书，回忆《${book.name}》第 ${index + 1} 章的学习框架：主要分为哪几节？`,
      back: sections.map((section, i) => `${i + 1}. ${section}`).join("；"),
      source: `《27KC 333 应试解析·${book.name}》目录框架卡（2027版 OCR 核对）`,
    });
  });
}

for (const book of books) {
  chapterHighlights[book.id]?.forEach((entry, index) => {
    cards.push({
      id: `framework-${book.id}-${index + 1}`,
      book: book.id,
      chapter: index + 1,
      front: entry.front,
      back: entry.back,
      source: `《27KC 333 应试解析·${book.name}》2027版 PDF 第${entry.page}页 · 知识框架 OCR 后人工核对`,
    });
  });
}

export const questions: Question[] = [
  { id: "q24-4", year: 2024, book: "principles", chapter: 1, stem: "下列故事所叙述的行为或行动中，称得上教育的是？", options: ["曹冲称象", "程门立雪", "岳母刺字", "公车上书"], answer: 2, explanation: "解析将“岳母刺字”归为有目的地影响人的教育活动。", source: "2024 教育综合 333 统考真题及解析 PDF 第2页，第4题" },
  { id: "q25-27", year: 2025, book: "psychology", chapter: 2, stem: "娜娜发现系上安全带后警示音停止，于是养成系安全带习惯。警示音停止属于？", options: ["替代强化", "负强化", "惩罚", "正强化"], answer: 1, explanation: "取消厌恶刺激，使目标行为增加，是负强化。", source: "2025 考研教育学 333 真题及参考答案 PDF 第7页，第27题" },
  { id: "q25-18", year: 2025, book: "china", chapter: 6, stem: "黄宗羲关于学校职能的新认识，最能由哪句话体现？", options: ["子产不毁乡校", "无人才则无政事", "公其非是于学校", "政立而厉教可施焉"], answer: 2, explanation: "他主张学校成为议论政事、评判是非的场所。", source: "2025 考研教育学 333 真题及参考答案 PDF 第5页，第18题" },
  { id: "q26-1", year: 2026, book: "principles", chapter: 1, stem: "“我们教孩子，而不教科目。”该教育陈述属于？", options: ["教育定义", "教育隐喻", "教育口号", "教育规范"], answer: 2, explanation: "这是一句简短、具有倡导作用的教育口号。", source: "2026 年全国 333 真题及凯程解析 PDF 第1页，第1题；与扫描版 OCR 核对" },
  { id: "q26-4", year: 2026, book: "principles", chapter: 2, stem: "根据人力资本理论，个人对教育投资的主要动机是？", options: ["获得更高社会声誉", "满足个人兴趣爱好", "增加未来收入潜力", "满足用人单位要求"], answer: 2, explanation: "人力资本理论强调教育提高能力并带来预期收入。", source: "2026 年全国 333 真题及凯程解析 PDF 第2页，第4题；与扫描版 OCR 核对" },
  { id: "q26-9", year: 2026, book: "principles", chapter: 6, stem: "“鱼稻共生”校本课程由多方讨论、协同开发，这属于哪种课程开发模式？", options: ["目标模式", "过程模式", "实践模式", "批判模式"], answer: 2, explanation: "重视教师、学生和家长的参与及具体实践。", source: "2026 年全国 333 真题及凯程解析 PDF 第3页，第9题" },
  { id: "q26-30", year: 2026, book: "psychology", chapter: 6, stem: "华罗庚主张读书“由薄到厚”，不断补充参考材料。这属于？", options: ["组块策略", "元认知策略", "精细加工策略", "资源管理策略"], answer: 2, explanation: "通过补充信息、建立联系对材料深度加工。", source: "2026 年全国 333 真题及凯程解析 PDF 第8页，第30题" },
];

const manuallyMapped = new Set(["2024-4", "2025-18", "2025-27", "2026-1", "2026-4", "2026-9", "2026-30"]);
for (const question of pastQuestions) {
  const number = Number(question.id.split("-").at(-1));
  if (!manuallyMapped.has(`${question.year}-${number}`)) questions.push(question);
}
