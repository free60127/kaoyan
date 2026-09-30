export type SpeechInputStatus = "idle" | "starting" | "listening" | "stopping";
export type SpeechErrorCode =
  | "unsupported" | "insecure-context" | "start-failed"
  | "not-allowed" | "service-not-allowed" | "audio-capture" | "network"
  | "no-speech" | "aborted" | "language-not-supported" | "unknown"
  | "start-timeout" | "no-result-timeout" | "stop-timeout";
export type SpeechInputError = { code: SpeechErrorCode; message: string };

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
export interface SpeechInputTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface SpeechInputOptions {
  recognitionConstructor?: SpeechRecognitionConstructor | null;
  language?: string;
  isSecureContext?: boolean;
  onStatus?: (status: SpeechInputStatus) => void;
  /** Only newly confirmed text, followed by the confirmed transcript for this run. */
  onFinal?: (delta: string, transcript: string) => void;
  /** The current unconfirmed text; never included in onFinal until confirmed. */
  onInterim?: (text: string) => void;
  onError?: (error: SpeechInputError) => void;
  timers?: SpeechInputTimers;
  startTimeoutMs?: number;
  noResultTimeoutMs?: number;
  stopTimeoutMs?: number;
}
export interface SpeechInputSession {
  /** Returns true when a start request was accepted, before browser confirmation. */
  start(): boolean;
  stop(): void;
  /** Permanently disables this controller and all callbacks from its old run. */
  dispose(): void;
  getStatus(): SpeechInputStatus;
}

const errorMessages: Record<SpeechErrorCode, string> = {
  unsupported: "当前浏览器不支持网页语音识别。可以使用系统听写，或直接输入文字。",
  "insecure-context": "网页语音识别需要安全连接。请通过 HTTPS 或本机 localhost 打开页面，也可以使用系统听写。",
  "start-failed": "语音识别未能启动。请稍后重试，或使用系统听写。",
  "not-allowed": "麦克风访问被拒绝。请检查此网站的麦克风权限，或使用系统听写。",
  "service-not-allowed": "浏览器不允许使用语音识别服务。可以使用系统听写，或直接输入文字。",
  "audio-capture": "无法使用麦克风。请检查麦克风是否连接、被其他程序占用，以及系统的麦克风权限。",
  network: "无法连接浏览器的语音识别服务。请检查网络，或使用系统听写；麦克风开启不代表识别服务可用。",
  "no-speech": "没有识别到语音。请检查麦克风和输入音量，然后重试。",
  aborted: "语音识别被中断。可以重新开始，或使用系统听写。",
  "language-not-supported": "当前识别服务不支持所选语言。请选择其他语言，或使用系统听写。",
  unknown: "语音识别出现问题，已停止。请重试，或使用系统听写。",
  "start-timeout": "语音识别启动超过 12 秒仍未回应，已停止。请检查网站麦克风权限，或使用系统听写。",
  "no-result-timeout": "语音识别连续 30 秒没有返回文字，已请求停止。浏览器识别服务可能不可用，可以使用系统听写。",
  "stop-timeout": "语音识别未及时结束，已关闭本次识别。可以重新开始，或使用系统听写。",
};

export function getSpeechErrorMessage(code: string): string {
  return Object.hasOwn(errorMessages, code) ? errorMessages[code as SpeechErrorCode] : errorMessages.unknown;
}

/** Preserve Chinese adjacency and put spaces between English words or sentences. */
export function appendSpeechText(existing: string, incoming: string, language = "zh-CN"): string {
  const next = incoming.trim();
  if (!next) return existing;
  if (!existing) return next;
  // Keep paragraph breaks and spaces the user has already put in the answer.
  if (/\s$/.test(existing)) return existing + next;
  const previous = existing;
  const punctuation = /^[,.;:!?，。；：！？、）)\]}]/.test(next);
  const opening = /[（(\[{]$/.test(previous);
  const needsSpace = !punctuation && !opening &&
    (!/^(zh|ja|ko)(-|$)/i.test(language) || /[a-z0-9]$/i.test(previous) && /^[a-z0-9]/i.test(next));
  return previous + (needsSpace ? " " : "") + next;
}

function classifyError(code: string): SpeechErrorCode {
  return Object.hasOwn(errorMessages, code) ? code as SpeechErrorCode : "unknown";
}

function classifyStartException(error: unknown): SpeechErrorCode {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  if (name === "NotFoundError" || name === "NotReadableError") return "audio-capture";
  if (name === "NetworkError") return "network";
  if (name === "NotSupportedError") return "unsupported";
  if (name === "AbortError") return "aborted";
  return "start-failed";
}

type Run = {
  recognition: SpeechRecognitionLike;
  startTimer?: unknown;
  resultTimer?: unknown;
  stopTimer?: unknown;
  confirmed: Set<number>;
  pending: Map<number, string>;
  transcript: string;
  interim: string;
  hasResults: boolean;
  requestedStop: boolean;
  reportedError: boolean;
};

export function createSpeechInputSession(options: SpeechInputOptions = {}): SpeechInputSession {
  const language = options.language?.trim() || "zh-CN";
  const browser = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    isSecureContext?: boolean;
  };
  const Recognition = options.recognitionConstructor === undefined
    ? browser.SpeechRecognition ?? browser.webkitSpeechRecognition
    : options.recognitionConstructor;
  const secure = options.isSecureContext ?? browser.isSecureContext ?? true;
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, milliseconds: number) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let status: SpeechInputStatus = "idle";
  let active: Run | undefined;
  let disposed = false;
  const isCurrent = (run: Run) => !disposed && active === run;
  const setStatus = (next: SpeechInputStatus) => {
    if (status === next) return;
    status = next;
    if (!disposed) options.onStatus?.(next);
  };
  const clearTimer = (run: Run, key: "startTimer" | "resultTimer" | "stopTimer") => {
    if (run[key] !== undefined) timers.clearTimeout(run[key]);
    run[key] = undefined;
  };
  const report = (code: SpeechErrorCode, run?: Run) => {
    if (disposed || run && (!isCurrent(run) || run.reportedError)) return;
    if (run) run.reportedError = true;
    options.onError?.({ code, message: getSpeechErrorMessage(code) });
  };
  const clearInterim = (run: Run) => {
    run.pending.clear();
    if (run.interim) {
      run.interim = "";
      if (!disposed) options.onInterim?.("");
    }
  };
  const finish = (run: Run, abort: boolean) => {
    if (!isCurrent(run)) return;
    active = undefined; // Invalidate even already queued callbacks before aborting.
    clearTimer(run, "startTimer");
    clearTimer(run, "resultTimer");
    clearTimer(run, "stopTimer");
    const recognition = run.recognition;
    recognition.onstart = recognition.onend = recognition.onresult = recognition.onerror = null;
    if (abort) {
      try { recognition.abort(); } catch { /* The browser may already have ended. */ }
    }
    clearInterim(run);
    setStatus("idle");
  };
  const stopRun = (run: Run) => {
    if (!isCurrent(run) || status === "stopping") return;
    run.requestedStop = true;
    clearTimer(run, "startTimer");
    clearTimer(run, "resultTimer");
    setStatus("stopping");
    if (!isCurrent(run)) return;
    run.stopTimer = timers.setTimeout(() => {
      if (!isCurrent(run)) return;
      report("stop-timeout", run);
      finish(run, true);
    }, options.stopTimeoutMs ?? 3000);
    try { run.recognition.stop(); }
    catch { finish(run, true); }
  };
  const armResultTimer = (run: Run) => {
    clearTimer(run, "resultTimer");
    if (!isCurrent(run) || status !== "listening") return;
    run.resultTimer = timers.setTimeout(() => {
      if (!isCurrent(run)) return;
      report("no-result-timeout", run);
      stopRun(run);
    }, options.noResultTimeoutMs ?? 30000);
  };

  return {
    getStatus: () => status,
    start() {
      if (disposed || status !== "idle") return false;
      if (!secure) { report("insecure-context"); return false; }
      if (!Recognition) { report("unsupported"); return false; }
      let recognition: SpeechRecognitionLike;
      try { recognition = new Recognition(); }
      catch (error) { report(classifyStartException(error)); return false; }
      const run: Run = {
        recognition, confirmed: new Set(), pending: new Map(), transcript: "", interim: "",
        hasResults: false, requestedStop: false, reportedError: false,
      };
      active = run;
      recognition.onstart = () => {
        if (!isCurrent(run) || status !== "starting") return;
        clearTimer(run, "startTimer");
        setStatus("listening");
        armResultTimer(run);
      };
      recognition.onresult = (event) => {
        if (!isCurrent(run)) return;
        let delta = "";
        let receivedText = false;
        for (const index of run.pending.keys()) {
          if (index >= event.results.length) run.pending.delete(index);
        }
        for (let index = Math.max(0, event.resultIndex); index < event.results.length; index++) {
          const result = event.results[index];
          const text = result[0]?.transcript?.trim() || "";
          if (text) receivedText = true;
          if (result.isFinal) {
            run.pending.delete(index);
            if (!run.confirmed.has(index)) {
              run.confirmed.add(index);
              delta = appendSpeechText(delta, text, language);
            }
          } else if (!run.confirmed.has(index)) {
            run.pending.set(index, text);
          }
        }
        if (receivedText) { run.hasResults = true; armResultTimer(run); }
        if (delta) {
          run.transcript = appendSpeechText(run.transcript, delta, language);
          options.onFinal?.(delta, run.transcript);
        }
        if (!isCurrent(run)) return;
        const interim = [...run.pending.entries()].sort(([a], [b]) => a - b)
          .reduce((text, [, segment]) => appendSpeechText(text, segment, language), "");
        if (interim !== run.interim) {
          run.interim = interim;
          options.onInterim?.(interim);
        }
      };
      recognition.onerror = (event) => {
        if (!isCurrent(run)) return;
        if (!(event.error === "aborted" && run.requestedStop)) report(classifyError(event.error), run);
        finish(run, true);
      };
      recognition.onend = () => {
        if (!isCurrent(run)) return;
        if (!run.hasResults && !run.requestedStop) report("no-speech", run);
        finish(run, false);
      };
      setStatus("starting");
      if (!isCurrent(run) || run.requestedStop) return false;
      run.startTimer = timers.setTimeout(() => {
        if (!isCurrent(run)) return;
        report("start-timeout", run);
        finish(run, true);
      }, options.startTimeoutMs ?? 12000);
      try {
        recognition.lang = language;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.start();
        return isCurrent(run);
      } catch (error) {
        report(classifyStartException(error), run);
        finish(run, true);
        return false;
      }
    },
    stop() { if (active) stopRun(active); },
    dispose() {
      if (disposed) return;
      // No UI callbacks during navigation/unmount, including the final idle status.
      const run = active;
      disposed = true;
      if (run) {
        active = undefined;
        clearTimer(run, "startTimer");
        clearTimer(run, "resultTimer");
        clearTimer(run, "stopTimer");
        run.recognition.onstart = run.recognition.onend = run.recognition.onresult = run.recognition.onerror = null;
        try { run.recognition.abort(); } catch { /* Disposal is still complete. */ }
      }
      status = "idle";
    },
  };
}
