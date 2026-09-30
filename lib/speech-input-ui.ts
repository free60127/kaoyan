import { appendSpeechText, createSpeechInputSession, type SpeechInputError, type SpeechInputStatus } from "./speech-input";

export type SpeechInputUiState = {
  status: SpeechInputStatus;
  interim: string;
  error: SpeechInputError | null;
};

export const speechStatusText: Record<SpeechInputStatus, string> = {
  idle: "等待开始语音输入。",
  starting: "正在启动语音识别，等待浏览器回应…",
  listening: "正在听，请开始复述。",
  stopping: "正在停止，等待最后的识别结果…",
};

/** Connect confirmed deltas to the latest editable answer, scoped to this UI's lifetime. */
export function createSpeechInputUi(options: {
  language: string;
  setAnswer: (update: (previous: string) => string) => void;
  onChange: (state: SpeechInputUiState) => void;
}) {
  let disposed = false;
  let state: SpeechInputUiState = { status: "idle", interim: "", error: null };
  const update = (patch: Partial<SpeechInputUiState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    options.onChange(state);
  };
  const session = createSpeechInputSession({
    language: options.language,
    onStatus: (status) => update({ status, ...(status === "idle" ? { interim: "" } : {}) }),
    onInterim: (interim) => update({ interim }),
    onError: (error) => update({ error }),
    onFinal: (delta) => {
      if (disposed) return;
      options.setAnswer((previous) => disposed ? previous : appendSpeechText(previous, delta, options.language));
    },
  });
  return {
    start() {
      if (disposed || session.getStatus() !== "idle") return false;
      update({ interim: "", error: null });
      return session.start();
    },
    stop() { if (!disposed) session.stop(); },
    dispose() {
      disposed = true;
      session.dispose();
    },
  };
}
