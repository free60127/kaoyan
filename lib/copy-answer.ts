export type AnswerClipboard = { writeText(text: string): Promise<void> };

/** Preserve the learner's text exactly, including whitespace and line breaks. */
export async function copyAnswer(text: string, clipboard?: AnswerClipboard): Promise<void> {
  if (!text.trim()) throw new Error("请先填写或选择答案。");
  if (!clipboard) throw new Error("剪贴板不可用，请手动复制。");
  await clipboard.writeText(text);
}

export function selectedAnswer(options: readonly string[], choice: number | null | undefined): string {
  return choice !== null && choice !== undefined && Number.isInteger(choice) && choice >= 0 && choice < options.length
    ? `${String.fromCharCode(65 + choice)}. ${options[choice]}` : "";
}
