import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { applyStudyBackup, collectStudyBackup, loadBackupCatalogs, summarizeStudyBackup, type BackupCatalogs, type BackupStorageKey, type BackupSummary, type StudyBackup } from "@/lib/study-backup";

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const recordLabels: Record<BackupStorageKey, string> = {
  "yantu-learning-session-v1": "全部科目的学习位置、费曼草稿、825 真题作答与学习计划要求",
  "yantu-srs-v1-333": "333 闪卡复习记录、范围与每日新卡配额",
  "yantu-srs-v1-825": "825 闪卡复习记录、范围与每日新卡配额",
  "yantu-srs-v1-politics": "政治闪卡复习记录、范围与每日新卡配额",
  "yantu-done": "333 章节完成标记", "yantu-done-825": "825 章节完成标记", "yantu-done-politics": "政治章节完成标记",
  "kaoyan.mock-practice.v1.333": "333 命题设置、完整模拟卷与作答",
  "kaoyan.mock-practice.v1.825": "825 命题设置、完整模拟卷与作答",
};
const subjects = { "333": "333 教育综合", "825": "825 英语专业基础", politics: "政治", english: "英语二" };
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
export function backupPdfFilename(createdAt: string): string {
  const date = new Date(createdAt), pad = (value: number) => String(value).padStart(2, "0");
  return `研途学习备份-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.pdf`;
}
function Summary({ summary }: { summary: BackupSummary }) {
  return <div className="backup-summary"><table><caption>包含的学习记录</caption><thead><tr><th>科目</th><th>已学卡</th><th>完成章</th><th>模拟题</th><th>草稿 / 要求</th></tr></thead><tbody>{Object.entries(subjects).map(([id, name]) => {
    const row = summary[id as keyof BackupSummary];
    return <tr key={id}><th scope="row">{name}</th><td>{row.studiedCards}</td><td>{row.completedChapters}</td><td>{row.mockQuestions}</td><td>{row.drafts}</td></tr>;
  })}</tbody></table></div>;
}

export default function BackupPanel({ blockedReason, onBusyChange }: { blockedReason: string; onBusyChange: (busy: boolean) => void }) {
  const [catalogs, setCatalogs] = useState<BackupCatalogs>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [preview, setPreview] = useState<{ backup: StudyBackup; filename: string; size: number; summary: BackupSummary }>();
  const [exported, setExported] = useState<{ backup: StudyBackup; size: number; summary: BackupSummary; url: string; filename: string }>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true), operation = useRef(false);
  const exportUrl = useRef<string | null>(null);
  const latestBlocked = useRef(blockedReason); latestBlocked.current = blockedReason;
  useEffect(() => {
    alive.current = true;
    loadBackupCatalogs().then(value => { if (alive.current) setCatalogs(value); }).catch(cause => { if (alive.current) setError(cause instanceof Error ? cause.message : "学习目录加载失败，请关闭后重新打开。"); });
    return () => { alive.current = false; if (exportUrl.current) { URL.revokeObjectURL(exportUrl.current); exportUrl.current = null; } };
  }, []);
  function start(message: string) {
    if (!catalogs || operation.current || latestBlocked.current) return false;
    operation.current = true; setBusy(true); onBusyChange(true); setError(""); setStatus(message); return true;
  }
  function finish() { operation.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  async function exportPdf() {
    if (!catalogs || !start("正在整理学习记录并生成 PDF，首次导出会加载中文字体…")) return;
    try {
      const backup = collectStudyBackup(localStorage, catalogs, Date.now());
      const { exportStudyBackupPdf } = await import("@/lib/backup-pdf");
      const bytes = await exportStudyBackupPdf(backup, catalogs);
      if (!alive.current) return;
      if (latestBlocked.current) throw new Error("学习状态发生变化，请等待保存或 AI 请求完成后重新导出。");
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob), filename = backupPdfFilename(backup.createdAt), anchor = document.createElement("a");
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      exportUrl.current = url;
      anchor.href = url; anchor.download = filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setExported({ backup, size: bytes.byteLength, summary: summarizeStudyBackup(backup, catalogs), url, filename });
      setStatus("PDF 已生成；若未自动下载，请点击“下载 PDF 文件”，并保存好文件。");
    } catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : "PDF 导出失败，请重试。"); setStatus(""); } }
    finally { finish(); }
  }
  async function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !catalogs || !start("正在检查 PDF 备份…")) return;
    setPreview(undefined);
    try {
      if (file.size > MAX_PDF_BYTES) throw new Error("PDF 超过 32 MiB 上限，请选择较小的本站备份。");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { readStudyBackupPdf } = await import("@/lib/backup-pdf");
      const backup = await readStudyBackupPdf(bytes, catalogs);
      if (!alive.current) return;
      setPreview({ backup, filename: file.name, size: file.size, summary: summarizeStudyBackup(backup, catalogs) });
      setStatus("备份已校验，请检查以下内容。尚未修改本地记录。");
    } catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : "PDF 读取失败。"); setStatus(""); } }
    finally { finish(); }
  }
  function confirmImport() {
    if (!catalogs || !preview || !start("正在导入…")) return;
    try {
      applyStudyBackup(localStorage, preview.backup, catalogs);
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败。"); setStatus(""); finish(); }
  }
  const disabled = busy || !catalogs || Boolean(blockedReason);
  return <>
    <p className="backup-intro">学习记录会自动保存到当前浏览器。导出 PDF 可阅读学习记录、完整模拟卷与作答，也可在其他浏览器导入恢复。需要自己保存并传递文件。</p>
    <p className="mock-help">备份保留复习范围、每日新卡配额、未来到期时间、章节标记、学习位置与草稿；不包含 DeepSeek 密钥。</p>
    {blockedReason && <p className="error" role="alert">{blockedReason}</p>}
    {!catalogs && !error && <p role="status">正在加载学习目录…</p>}
    <div className="backup-actions"><button className="primary" disabled={disabled} onClick={exportPdf}>导出 PDF 备份</button><button className="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>选择 PDF 导入</button><input ref={inputRef} type="file" accept="application/pdf,.pdf" aria-label="选择本站 PDF 备份" hidden disabled={disabled} onChange={selectPdf}/></div>
    <p className="mock-help">仅支持本站生成的备份 PDF，普通试卷 PDF 无法恢复。文件上限 32 MiB。</p>
    {status && <p className="backup-status" role="status" aria-live="polite">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {exported && <div className="backup-export-info"><p><a href={exported.url} download={exported.filename}>下载 PDF 文件</a> · {exported.filename}</p><details><summary>上次导出：{new Date(exported.backup.createdAt).toLocaleString("zh-CN")} · {sizeLabel(exported.size)} · {Object.keys(exported.backup.records).length} 类记录</summary><Summary summary={exported.summary}/></details></div>}
    {preview && <section className="backup-preview" aria-labelledby="backup-preview-title"><h3 id="backup-preview-title">导入预览</h3><p className="backup-file">{preview.filename}</p><p>导出时间：{new Date(preview.backup.createdAt).toLocaleString("zh-CN")} · {sizeLabel(preview.size)} · {Object.keys(preview.backup.records).length} 类记录</p><Summary summary={preview.summary}/><b>确认后将替换以下整份记录，不合并：</b><ul>{Object.keys(preview.backup.records).map(key => <li key={key}>{recordLabels[key as BackupStorageKey]}</li>)}</ul><p>备份未包含的记录保持当前内容。建议先点击“导出 PDF 备份”保存当前记录，再确认导入。导入成功后页面会立即刷新。</p><div className="backup-actions"><button className="primary" disabled={disabled} onClick={confirmImport}>确认导入并刷新</button><button className="secondary" disabled={busy} onClick={() => { setPreview(undefined); setStatus("已取消导入，本地记录未修改。"); }}>取消导入</button></div></section>}
  </>;
}
