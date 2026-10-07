import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { MAX_BACKUP_BYTES, buildBackupDocument, validateStudyBackup, type BackupCatalogs, type StudyBackup } from "./study-backup";

export const MAX_BACKUP_PDF_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_PDF_PAGES = 3000;
const MARKER = PDFName.of("YantuStudyBackup");
const ATTACHMENT_NAME = "yantu-study-backup.json";
const PAGE_WIDTH = 595.28, PAGE_HEIGHT = 841.89, MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.12, 0.17, 0.22), MUTED = rgb(0.38, 0.44, 0.49), ACCENT = rgb(0.08, 0.31, 0.42);
const error = (message: string): never => { throw new Error(`学习备份 PDF：${message}。`); };

async function loadFont(): Promise<Uint8Array> {
  // Honor Vite's configured base, including GitHub Pages' /kaoyan/ path.
  const base = import.meta.env.BASE_URL;
  let response: Response;
  try { response = await fetch(`${base}fonts/yantu-pdf/YantuPdfSC-Regular.ttf`); }
  catch { return error("中文字体加载失败，请检查网络后重试"); }
  if (!response.ok) return error("中文字体加载失败，请检查网络后重试");
  return new Uint8Array(await response.arrayBuffer());
}

/** Show every unsupported character explicitly; the attachment retains the original. */
function printable(text: string, supported: Set<number>): string {
  return Array.from(text.replace(/\r\n?/g, "\n"), character => {
    if (character === "\n") return character;
    if (character === "\t") return "    ";
    const point = character.codePointAt(0)!;
    return point >= 32 && point !== 127 && supported.has(point)
      ? character
      : `[U+${point.toString(16).toUpperCase().padStart(4, "0")}]`;
  }).join("");
}

/** Keep ordinary Latin words together, splitting oversized tokens without loss. */
function wrap(text: string, font: PDFFont, size: number, widths: Map<string, number>): string[] {
  const width = (value: string) => {
    let result = 0;
    for (const character of value) {
      let unit = widths.get(character);
      if (unit === undefined) { unit = font.widthOfTextAtSize(character, 1); widths.set(character, unit); }
      result += unit * size;
    }
    return result;
  };
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "", used = 0;
    const rawTokens = paragraph.match(/[A-Za-z0-9][A-Za-z0-9._:@/+%\-]*|[^\S\n]+|[^\s]/gu) || [];
    const tokens: string[] = [];
    for (const token of rawTokens) {
      const previous = tokens.at(-1);
      // Keep closing punctuation with the preceding character and opening
      // punctuation with the following one, so quotes do not sit alone.
      if (previous && previous.length < 1000 && !/^\s+$/u.test(token) &&
        (/^[、。，：；？！》）〕】〉」』”’.,:;!?\])}]+$/u.test(token) || /^[《（〔【〈「『“‘\[({]+$/u.test(previous))) {
        tokens[tokens.length - 1] += token;
      } else tokens.push(token);
    }
    for (const token of tokens) {
      const tokenWidth = width(token);
      if (tokenWidth <= CONTENT_WIDTH) {
        if (line && used + tokenWidth > CONTENT_WIDTH) { lines.push(line); line = ""; used = 0; }
        line += token; used += tokenWidth;
      } else {
        for (const character of token) {
          const characterWidth = width(character);
          if (line && used + characterWidth > CONTENT_WIDTH) { lines.push(line); line = ""; used = 0; }
          line += character; used += characterWidth;
        }
      }
    }
    lines.push(line);
    if (lines.length > MAX_BACKUP_PDF_PAGES * 50) error("内容超过 3000 页上限，请减少记录后重试");
  }
  return lines;
}

function embedBackup(pdf: PDFDocument, payload: Uint8Array): void {
  // Deliberately uncompressed: restoration never decodes arbitrary PDF filters.
  const stream = pdf.context.stream(payload, {
    Type: "EmbeddedFile", Subtype: "application/json", Params: { Size: payload.byteLength },
  });
  const streamRef = pdf.context.register(stream);
  const fileRef = pdf.context.register(pdf.context.obj({
    Type: "Filespec", F: PDFString.of(ATTACHMENT_NAME), UF: PDFHexString.fromText(ATTACHMENT_NAME),
    Desc: PDFHexString.fromText("研途学习记录与模拟卷恢复数据"),
    AFRelationship: "Data", EF: { F: streamRef, UF: streamRef },
  }));
  pdf.catalog.set(PDFName.of("Names"), pdf.context.obj({
    EmbeddedFiles: { Names: [PDFString.of(ATTACHMENT_NAME), fileRef] },
  }));
  pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([fileRef]));
  pdf.catalog.set(MARKER, fileRef);
}

export async function exportStudyBackupPdf(
  input: StudyBackup,
  catalogs: BackupCatalogs,
  options: { fontBytes?: Uint8Array } = {},
): Promise<Uint8Array> {
  const backup = validateStudyBackup(input, catalogs);
  const payload = new TextEncoder().encode(JSON.stringify(backup));
  if (payload.byteLength > MAX_BACKUP_BYTES) return error("恢复数据超过 8 MiB 上限");
  const document = buildBackupDocument(backup, catalogs);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  let font: PDFFont;
  try { font = await pdf.embedFont(options.fontBytes ?? await loadFont(), { subset: true }); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("学习备份 PDF：")) throw cause;
    return error("中文字体无效，无法导出");
  }
  const supported = new Set(font.getCharacterSet()), widths = new Map<string, number>();
  const HEX_RGB = /^#([0-9a-fA-F]{6})$/;
  const styledColor = (hex: string | undefined): ReturnType<typeof rgb> | null => {
    if (!hex || !HEX_RGB.test(hex)) return null;
    const value = parseInt(hex.slice(1), 16);
    return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  };
  const widthOf = (value: string, size: number) => {
    let total = 0;
    for (const character of value) {
      let unit = widths.get(character);
      if (unit === undefined) { unit = font.widthOfTextAtSize(character, 1); widths.set(character, unit); }
      total += unit * size;
    }
    return total;
  };
  pdf.setTitle(document.title); pdf.setAuthor("研途");
  pdf.setSubject("学习记录与模拟卷备份（含可恢复数据）");
  pdf.setCreator("Yantu study backup");
  pdf.setCreationDate(new Date(backup.createdAt));
  pdf.setModificationDate(new Date(backup.createdAt));
  let page: PDFPage, y = 0;
  const newPage = () => {
    if (pdf.getPageCount() >= MAX_BACKUP_PDF_PAGES) error("内容超过 3000 页上限，请减少记录后重试");
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    if (pdf.getPageCount() > 1) {
      page.drawText(document.title, { x: MARGIN, y: PAGE_HEIGHT - 30, size: 8, font, color: MUTED });
    }
  };
  const drawBlock = (text: string, size: number, lineHeight: number, heading = false, style?: { color?: string; hl?: string }) => {
    const lines = wrap(printable(text, supported), font, size, widths);
    // Avoid leaving a heading alone at the foot of a page.
    if (heading && y - lineHeight * Math.min(lines.length + 1, 3) < MARGIN) newPage();
    const textColor = (!heading && styledColor(style?.color)) || null;
    const highlight = styledColor(style?.hl);
    for (const line of lines) {
      if (y - lineHeight < MARGIN) newPage();
      y -= lineHeight;
      if (!line) continue;
      if (highlight) {
        // 底纹: 文字行背后的浅色矩形, 高度略小于行距
        page.drawRectangle({ x: MARGIN - 2, y: y - size * 0.3, width: Math.min(widthOf(line, size) + 6, CONTENT_WIDTH + 4), height: size * 1.25, color: highlight });
      }
      page.drawText(line, { x: MARGIN, y, size, font, color: textColor || (heading ? ACCENT : INK) });
    }
    y -= heading ? 9 : 7;
  };
  newPage();
  drawBlock(document.title, 20, 28, true);
  drawBlock("本文件包含可阅读的学习记录及内嵌恢复数据，可在研途导入恢复。", 10, 16);
  drawBlock("字体未支持的字符会显示为 [U+码点]；恢复数据保留原始文字。", 9, 15);
  for (const block of document.blocks) {
    if (block.type === "heading") { y -= 7; drawBlock(block.text, 14, 21, true); }
    else drawBlock(block.text, 10, 16, false, block.color || block.hl ? { color: block.color, hl: block.hl } : undefined);
  }
  const count = pdf.getPageCount();
  pdf.getPages().forEach((current, index) => {
    const footer = `研途学习备份  |  ${index + 1} / ${count}`;
    current.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.5, color: rgb(0.8, 0.83, 0.85) });
    current.drawText(footer, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(footer, 8), y: 25, size: 8, font, color: MUTED });
  });
  embedBackup(pdf, payload);
  const bytes = await pdf.save();
  if (bytes.byteLength > MAX_BACKUP_PDF_BYTES) return error("文件超过 32 MiB 上限，请减少记录后重试");
  return bytes;
}

/** Only restore the direct, uncompressed attachment written by our exporter. */
export async function readStudyBackupPdf(bytes: Uint8Array, catalogs: BackupCatalogs): Promise<StudyBackup> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BACKUP_PDF_BYTES) return error("文件超过 32 MiB 上限或格式无效");
  if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70 || bytes[4] !== 45) return error("不是有效的 PDF 文件");
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch { return error("文件损坏或已加密，无法读取"); }
  if (pdf.isEncrypted) return error("不支持加密文件");
  try {
    if (pdf.getPageCount() > MAX_BACKUP_PDF_PAGES) return error("文件超过 3000 页上限");
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("学习备份 PDF：")) throw cause;
    return error("文件页面结构损坏");
  }
  let payload: Uint8Array;
  try {
    const spec = pdf.context.lookup(pdf.catalog.get(MARKER));
    if (!(spec instanceof PDFDict) || spec.get(PDFName.of("Type")) !== PDFName.of("Filespec")) return error("文件未包含兼容的研途恢复数据");
    const ef = pdf.context.lookup(spec.get(PDFName.of("EF")));
    if (!(ef instanceof PDFDict)) return error("恢复数据附件无效");
    const stream = pdf.context.lookup(ef.get(PDFName.of("F")));
    if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of("Type")) !== PDFName.of("EmbeddedFile") || stream.dict.get(PDFName.of("Subtype")) !== PDFName.of("application/json")) return error("恢复数据附件无效");
    if (stream.dict.has(PDFName.of("Filter"))) return error("恢复数据不支持压缩或过滤格式");
    payload = stream.getContents();
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("学习备份 PDF：")) throw cause;
    return error("恢复数据附件损坏");
  }
  // Inspect the actual stream, never trust its declared Length or Params.Size.
  if (payload.byteLength > MAX_BACKUP_BYTES) return error("恢复数据超过 8 MiB 上限");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)); }
  catch { return error("恢复数据 JSON 损坏或文字编码无效"); }
  return validateStudyBackup(value, catalogs);
}
