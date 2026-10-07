/** 个人编辑层: 教材卡的修改/补充/样式(overlay) 与新建个人卡(cards)。
 *  原则: 教材数据不动——个人内容独立存储、按 卡片ID 关联、带版本号;
 *  复习排期继续用原卡 ID, 不因编辑重置。多标签页用 rev 乐观锁防互覆。 */

import { sanitizeRuns, type RichContent, type RichRun } from "./rich-text";

export const personalStorageKey = "yantu-personal-v1";
export type PersonalSubject = "333" | "825" | "politics";

const HEX = /^#[0-9a-fA-F]{6}$/;

export type PersonalOverlay = {
  rev: number;
  updatedAt: string;
  /** 编辑时的教材原文指纹: 原文更新后可检测冲突 */
  baseHash: string;
  /** 修改后的问题/答案(text 已重注入教材标记; runs 以纯文本偏移) */
  q?: RichContent;
  a?: RichContent;
  /** 我的补充: 独立于教材答案 */
  note?: RichContent;
  /** 整卡浅色背景 */
  bg?: string;
  /** 可恢复隐藏 */
  hidden?: boolean;
};

export type PersonalCard = {
  id: string;
  subject: PersonalSubject;
  /** 归属是独立字段, 不依赖题面前的〔第几节〕文本 */
  book: string;
  chapter: number;
  section: string;
  front: RichContent;
  back: RichContent;
  note?: RichContent;
  bg?: string;
  hidden?: boolean;
  createdAt: string;
  rev: number;
};

export type PersonalStore = { version: 1; seq: number; overlays: Record<string, PersonalOverlay>; cards: PersonalCard[] };

export const overlayKey = (subject: string, cardId: string) => `${subject}:${cardId}`;
const MAX_CARDS = 2000, MAX_TEXT = 20_000;

export function contentHash(text: string): string {
  // djb2: 冲突检测用的原文指纹, 非安全哈希
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function parseContent(value: unknown): RichContent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.text !== "string" || row.text.length > MAX_TEXT) return undefined;
  return { text: row.text, runs: sanitizeRuns(row.runs as RichRun[], row.text.length) };
}

function parseStore(raw: string | null): PersonalStore {
  const empty: PersonalStore = { version: 1, seq: 0, overlays: {}, cards: [] };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const row = parsed as Record<string, unknown>;
    if (row.version !== 1) return empty;
    const store: PersonalStore = { version: 1, seq: Number.isInteger(row.seq) && (row.seq as number) >= 0 ? row.seq as number : 0, overlays: {}, cards: [] };
    const overlays = row.overlays && typeof row.overlays === "object" && !Array.isArray(row.overlays) ? row.overlays as Record<string, unknown> : {};
    for (const [key, entry] of Object.entries(overlays)) {
      if (!key || key.length > 260 || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const overlay: PersonalOverlay = {
        rev: Number.isInteger(item.rev) && (item.rev as number) > 0 ? item.rev as number : 1,
        updatedAt: typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt : new Date(0).toISOString(),
        baseHash: typeof item.baseHash === "string" ? item.baseHash.slice(0, 64) : "",
        q: parseContent(item.q),
        a: parseContent(item.a),
        note: parseContent(item.note),
        bg: isHexColor(item.bg),
        hidden: item.hidden === true ? true : undefined,
      };
      if (overlay.q || overlay.a || overlay.note || overlay.bg || overlay.hidden) store.overlays[key] = overlay;
    }
    if (Array.isArray(row.cards)) {
      for (const entry of row.cards.slice(0, MAX_CARDS)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const item = entry as Record<string, unknown>;
        const subject = item.subject as PersonalSubject;
        if (!["333", "825", "politics"].includes(subject)) continue;
        if (typeof item.id !== "string" || !item.id.startsWith("mine-") || item.id.length > 80) continue;
        const front = parseContent(item.front), back = parseContent(item.back);
        if (!front || !back) continue;
        const chapter = Number(item.chapter);
        store.cards.push({
          id: item.id,
          subject,
          book: typeof item.book === "string" ? item.book.slice(0, 60) : "",
          chapter: Number.isInteger(chapter) && chapter > 0 ? chapter : 1,
          section: typeof item.section === "string" ? item.section.slice(0, 200) : "",
          front, back,
          note: parseContent(item.note),
          bg: isHexColor(item.bg),
          hidden: item.hidden === true ? true : undefined,
          createdAt: typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : new Date(0).toISOString(),
          rev: Number.isInteger(item.rev) && (item.rev as number) > 0 ? item.rev as number : 1,
        });
      }
    }
    return store;
  } catch { return empty; }
}

function isHexColor(value: unknown): string | undefined {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
}

export function readPersonal(): PersonalStore {
  try { return parseStore(localStorage.getItem(personalStorageKey)); } catch { return parseStore(null); }
}

function writeStore(store: PersonalStore): { ok: true } | { ok: false; reason: "storage" } {
  try {
    localStorage.setItem(personalStorageKey, JSON.stringify(store));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("yantu-personal-changed"));
    }
    return { ok: true };
  } catch { return { ok: false, reason: "storage" }; }
}

export type OverlayPatch = {
  /** null = 清除该字段(恢复原文); undefined = 不动 */
  q?: RichContent | null;
  a?: RichContent | null;
  note?: RichContent | null;
  bg?: string | null;
  hidden?: boolean;
  /** 编辑基线: 与教材原文指纹比对, 原文更新后提示冲突 */
  originalText?: string;
};

export type SaveResult = { ok: true; store: PersonalStore } | { ok: false; reason: "conflict" | "storage" | "invalid"; message?: string; store: PersonalStore };

const nextQ = (patch: OverlayPatch, existing?: PersonalOverlay) => patch.q === null ? undefined : patch.q !== undefined ? patch.q : existing?.q;
const nextA = (patch: OverlayPatch, existing?: PersonalOverlay) => patch.a === null ? undefined : patch.a !== undefined ? patch.a : existing?.a;
const nextNote = (patch: OverlayPatch, existing?: PersonalOverlay) => patch.note === null ? undefined : patch.note !== undefined ? patch.note : existing?.note;

/** 保存前内容校验: 与读取过滤同一套上限, 超长在入口明确报错而不是读回时静默丢卡(F03)。 */
function validateContents(entries: [string, RichContent | undefined][]): string[] {
  const errors: string[] = [];
  for (const [field, content] of entries) {
    if (!content) continue;
    if (typeof content.text !== "string" || !content.text.trim()) errors.push(`${field}不能为空`);
    else if (content.text.length > MAX_TEXT) errors.push(`${field}已有 ${content.text.length} 字，超过 ${MAX_TEXT} 字上限，请删减后再保存`);
  }
  return errors;
}

/** 保存一张教材卡的覆盖层。expectedRev 是调用方读到的版本; 不一致=另一标签页已修改。 */
export function saveOverlay(subject: PersonalSubject, cardId: string, patch: OverlayPatch, originalFront: string, originalBack: string, expectedRev: number | null): SaveResult {
  const current = readPersonal();
  const key = overlayKey(subject, cardId);
  const existing = current.overlays[key];
  // F02: expectedRev === null 只表示"打开编辑器时该卡尚无覆盖层";
  // 若期间已被(另一标签)创建, 必须冲突, 不能无条件覆盖
  if (expectedRev === null && existing) return { ok: false, reason: "conflict", store: current };
  if (expectedRev !== null && (!existing || existing.rev !== expectedRev)) return { ok: false, reason: "conflict", store: current };
  const invalid = validateContents([["问题", nextQ(patch, existing)], ["答案", nextA(patch, existing)], ["我的补充", nextNote(patch, existing)]]);
  if (invalid.length) return { ok: false, reason: "invalid", message: invalid.join("；"), store: current };
  const baseHash = contentHash(`${contentHash(originalFront)}|${contentHash(originalBack)}`);
  const next: PersonalOverlay = {
    rev: (existing?.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    baseHash: existing ? existing.baseHash : baseHash,
    q: nextQ(patch, existing),
    a: nextA(patch, existing),
    note: nextNote(patch, existing),
    bg: patch.bg === null ? undefined : patch.bg !== undefined ? patch.bg : existing?.bg,
    hidden: patch.hidden === undefined ? existing?.hidden : patch.hidden,
  };
  if (next.q || next.a || next.note || next.bg || next.hidden) current.overlays[key] = next;
  else delete current.overlays[key];
  current.seq += 1;
  const written = writeStore(current);
  return written.ok ? { ok: true, store: current } : { ok: false, reason: "storage", store: current };
}

export type NewPersonalCardInput = {
  subject: PersonalSubject;
  book: string;
  chapter: number;
  section: string;
  front: RichContent;
  back: RichContent;
  note?: RichContent;
  bg?: string;
};

export function newPersonalCardId(now: Date = new Date()): string {
  return `mine-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addPersonalCard(input: NewPersonalCardInput): SaveResult {
  const current = readPersonal();
  if (current.cards.length >= MAX_CARDS) return { ok: false, reason: "storage", message: "个人卡数量已达上限。", store: current };
  const invalid = validateContents([["问题", input.front], ["答案", input.back], ["我的补充", input.note]]);
  if (invalid.length) return { ok: false, reason: "invalid", message: invalid.join("；"), store: current };
  const card: PersonalCard = {
    id: newPersonalCardId(),
    subject: input.subject,
    book: input.book,
    chapter: input.chapter,
    section: input.section,
    front: input.front,
    back: input.back,
    note: input.note,
    bg: input.bg,
    createdAt: new Date().toISOString(),
    rev: 1,
  };
  current.cards.push(card);
  current.seq += 1;
  const written = writeStore(current);
  return written.ok ? { ok: true, store: current } : { ok: false, reason: "storage", store: current };
}

export function updatePersonalCard(id: string, patch: Partial<Omit<PersonalCard, "id" | "subject">>, expectedRev: number): SaveResult {
  const current = readPersonal();
  const card = current.cards.find(item => item.id === id);
  if (!card) return { ok: false, reason: "conflict", store: current };
  if (card.rev !== expectedRev) return { ok: false, reason: "conflict", store: current };
  const invalid = validateContents([["问题", patch.front ?? card.front], ["答案", patch.back ?? card.back], ["我的补充", patch.note === undefined ? card.note : patch.note]]);
  if (invalid.length) return { ok: false, reason: "invalid", message: invalid.join("；"), store: current };
  Object.assign(card, patch, { rev: card.rev + 1 });
  current.seq += 1;
  const written = writeStore(current);
  return written.ok ? { ok: true, store: current } : { ok: false, reason: "storage", store: current };
}

export function setPersonalCardHidden(id: string, hidden: boolean): SaveResult {
  const current = readPersonal();
  const card = current.cards.find(item => item.id === id);
  if (!card) return { ok: false, reason: "conflict", store: current };
  card.hidden = hidden || undefined;
  card.rev += 1;
  current.seq += 1;
  const written = writeStore(current);
  return written.ok ? { ok: true, store: current } : { ok: false, reason: "storage", store: current };
}

export function deletePersonalCard(id: string): SaveResult {
  const current = readPersonal();
  current.cards = current.cards.filter(item => item.id !== id);
  current.seq += 1;
  const written = writeStore(current);
  return written.ok ? { ok: true, store: current } : { ok: false, reason: "storage", store: current };
}

/** 有效内容: 覆盖层应用后的显示文本(答案带教材标记; 补充/问题为纯文本+runs)。 */
export function effectiveText(base: string, overlay: PersonalOverlay | undefined, field: "q" | "a"): { text: string; runs: RichRun[] } {
  if (field === "q") return overlay?.q ? overlay.q : { text: base, runs: [] };
  return overlay?.a ? overlay.a : { text: base, runs: [] };
}

/** 与备份/校验共用: 不依赖 localStorage 的解析入口。 */
export const parsePersonalStore = parseStore;
