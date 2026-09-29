# 825 语言学目录与闪卡审计

审计日期：2026-09-29。工作分支：`task/825-linguistics`；基线提交：`7dd8708e5dc7f77c82c606652eee2c1430a84fdc`。结果保持未提交，交由主线程检查完整 diff。

## 范围与结果

本次整理覆盖《27版高分笔记·语言学》5 个只读扫描 PDF，共 123 页，目录覆盖 Chapter 1–12。逐页 OCR 缓存位于仓库外 `D:\kao yan\ocr-825-cache\linguistics\`，扫描原件位于 `D:\kao yan\825\27版高分笔记\语言学\`；仓库内没有保存扫描 PDF、页面图像或完整 OCR 文本。公开数据为改写后的问答卡与章节目录。

| 原始 PDF | PDF 页数 | OCR 页数 |
|---|---:|---:|
| `01 语言学Chapter1.pdf` | 12 | 12 |
| `02语言学Chapter2.3.pdf` | 15 | 15 |
| `03语言学Chapter4.5.pdf` | 29 | 29 |
| `04语言学Chapter6.7.pdf` | 30 | 30 |
| `05语言学Chapter8-12.pdf` | 37 | 37 |
| **合计** | **123** | **123** |

数据文件含 12 章、308 节、445 张卡。结构检查通过：JSON 可解析、卡片 ID 445/445 唯一、每节至少有一张卡、卡片来源文件与 PDF 页码有效、来源文案页码与结构化页码一致，且每张卡的来源页落在对应章节的 PDF 范围内。分章数量及页面图像抽查如下；页码均为所列 PDF 的 PDF 页码，不是书内页码。

| 章 | 章节标题 | 节数 | 卡数 | PDF 与页面图像抽查 |
|---:|---|---:|---:|---|
| 1 | Language and Linguistics | 38 | 42 | `01 语言学Chapter1.pdf`，1–12 页；抽查 1、3、4、12 页 |
| 2 | Phonetics: The Study of Speech Sounds | 20 | 30 | `02语言学Chapter2.3.pdf`，1–7 页；抽查 2–6 页 |
| 3 | Phonology: The Study of Sound Systems and Patterns | 25 | 30 | 同上，8–15 页；抽查 8、10、12、14 页（第 12 页另以 5× 分辨率复核） |
| 4 | Morphology: The Study of Word Structure | 26 | 28 | `03语言学Chapter4.5.pdf`，1–9 页；抽查 3–8 页 |
| 5 | Syntax: The Analysis of Sentence Structure | 47 | 54 | 同上，10–29 页；抽查 12、20、22、23、27 页 |
| 6 | Semantics: The Analysis of Meaning | 26 | 53 | `04语言学Chapter6.7.pdf`，1–16 页；抽查 9、11、14 页 |
| 7 | Pragmatics: The Analysis of Meaning in Context | 45 | 62 | 同上，17–30 页；抽查 22、30 页 |
| 8 | Text Analysis: Exploring Principles of Text Construction | 19 | 35 | `05语言学Chapter8-12.pdf`，1–9 页；抽查 3、4 页 |
| 9 | Language and Society | 16 | 24 | 同上，10–16 页；抽查 12 页 |
| 10 | Language and Culture | 14 | 25 | 同上，17–23 页；抽查 21 页 |
| 11 | Second Language Acquisition | 17 | 35 | 同上，24–31 页；抽查 28–31 页 |
| 12 | Linguistics and Foreign Language Teaching | 15 | 27 | 同上，32–37 页；抽查 37 页 |

## 来源核对与修正

对全部 445 张卡运行了核心英文词项扫描：在每张卡的节名/题面中抽取英文术语或例词，与引用页及前后相邻页 OCR 文本比对。7 张卡中的 8 个词项未被 OCR 文本精确命中，逐一检查了引用页面图像，均可在图像中确认：`linguistics-k1-040`（syntagmatic）、`linguistics-k5-009`（adequacy；transformational-generative）、`linguistics-k5-042`（theses）、`linguistics-k6-036`（anomaly）、`linguistics-k6-048`（similarity）、`linguistics-k8-015`（reiteration）、`linguistics-k11-035`（hypothesis-testing）。因此 OCR 字串层面的未命中为 7 卡/8 词项，图像复核后未确认的核心术语为 0。

对正反面全部英文词项做宽口径 OCR 检索（剔除常见虚词与通用词）后，发现 19 种词形、22 次 OCR 未命中。该集合还包括 OCR 拼写误识、术语变体及引用元数据；所有词项都做了页面图像核对或独立出处核准。自动未命中只作为图像复核队列，不直接视作卡片缺乏来源。

修正与重点核对记录：

- `linguistics-k11-031`：第 30 页原扫描将 Schumann 印作 “Schuman”。卡片同时保留原页拼写说明，并采用通行拼写 **John H. Schumann**。Wiley 出版社的 1976 年论文页面将作者列作 John H. Schumann：[Social Distance as a Factor in Second Language Acquisition](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-1770.1976.tb00265.x)。此为 1 项经外部一手出处核准的姓名更正。
- `linguistics-k2-030`：补齐“清音与浊音”节此前缺少的卡片，依据第 4 页图像核对声带振动区别。
- `linguistics-k3-020`：第 12 页高分辨率复核确认该段可读。卡片改为有效对比问答：systematic gaps 是英语音系不允许的音序，原页例为 `/fpr/`；accidental gaps 是音系允许但尚未出现在英语中的音序，例为 `/klib/`。
- `linguistics-k3-016`：卡片仅采用第 12 页可读的规则文字和 water、butter、writer、rider 例词；题目不依赖公式符号。
- `linguistics-k4-007`：按图像复核补充复数词尾在齿擦音后的变体及发音条件。

## 低置信与来源风险

OCR 置信度低于 0.60 的行至少出现在 58/123 页。此指标是识别器逐行置信度，不等同于页面内容不可读；页脚、页码、音标和低清小字尤其容易造成低值。所有章节均已做页面图像抽查；PDF 2 第 12 页另以 5× 分辨率重渲染，确认 `/fpr/` 与 `/klib/` 两例。并未对每个 OCR 字符逐一人工转录。

| 卡片 ID | 页码 | 风险或处理 |
|---|---|---|
| `linguistics-k1-007` | PDF 1 第 3–4 页 | 第 3 页练习题将 referent 与 Saussure 的符号组成联系；第 4 页理论说明则明确 signified 是 concept。卡片保留 signified 与外部 referent 的区别，来源页之间的措辞不一致仍需读者留意。 |
| `linguistics-k5-052` | PDF 3 第 27 页 | 原页将 SVOO 项印作 “cause-receive construction”。图像可确认该拼写，但术语疑似原书误植；卡片保留原页写法并标注风险。 |
| `linguistics-k11-031` | PDF 5 第 30 页 | 原页姓名少一个 n；卡片注明原页拼作 Schuman，并采用经 Wiley 论文作者页核准的通行拼写 John H. Schumann。 |

未处理页数：0。未覆盖目录节：0（308/308 个有效节均有至少一张卡）。仍需留意的材料问题有两项：k1-007 的跨页术语表述不一致，以及 k5-052 疑似误植；k11-031 的原页姓名错误已用外部一手来源核实并在卡片中明确说明。

## 仓库改动

- `lib/825/linguistics.json`：章节、节目录与问答卡数据。
- `docs/audits/825-linguistics.md`：本审计报告。
- `scripts/ocr-825-linguistics.py`：可选 OCR 复现脚本；只读原始 PDF，并将页级 OCR 输出写入仓库外缓存。

完整 OCR 文本和 PDF 页面图像只保存在本地缓存，不进入公开仓库。
