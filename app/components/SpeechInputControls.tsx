import { useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Keyboard, Mic } from "lucide-react";
import { createSpeechInputUi, speechStatusText, type SpeechInputUiState } from "../../lib/speech-input-ui";

export function SpeechInputControls({ language, onLanguageChange, setAnswer, answerRef }: {
  language: string;
  onLanguageChange: (language: string) => void;
  setAnswer: Dispatch<SetStateAction<string>>;
  answerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [state, setState] = useState<SpeechInputUiState>({ status: "idle", interim: "", error: null });
  const [dictationHint, setDictationHint] = useState(false);
  const controller = useRef<ReturnType<typeof createSpeechInputUi> | null>(null);

  useLayoutEffect(() => {
    setState({ status: "idle", interim: "", error: null });
    setDictationHint(false);
    const current = createSpeechInputUi({ language, setAnswer, onChange: setState });
    controller.current = current;
    return () => {
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [language, setAnswer]);
  // 真实语音状态挂到根元素: SW 更新保护据此判断"正在语音输入"不可自动刷新
  useLayoutEffect(() => {
    const busy = state.status !== "idle";
    if (busy) document.documentElement.setAttribute("data-speech-busy", "true");
    else document.documentElement.removeAttribute("data-speech-busy");
    return () => { document.documentElement.removeAttribute("data-speech-busy"); };
  }, [state.status]);

  const active = state.status !== "idle";
  return <div className="speech-input-controls">
    <label className="speech-language">语音识别语言<select value={language} disabled={active} onChange={(event) => onLanguageChange(event.target.value)}>
      <option value="zh-CN">中文</option><option value="en-US">English</option>
    </select></label>
    <div className="speech-actions">
      <button type="button" className="secondary" disabled={state.status === "stopping"} onClick={() => {
        if (active) controller.current?.stop();
        else { setDictationHint(false); controller.current?.start(); }
      }}><Mic size={19}/>{state.status === "stopping" ? "正在停止…" : active ? "停止语音输入" : "开始语音输入"}</button>
      <button type="button" className="secondary" onClick={() => {
        controller.current?.stop();
        setDictationHint(true);
        answerRef.current?.focus();
      }}><Keyboard size={18}/>使用系统听写</button>
    </div>
    <p className="speech-status" role="status" aria-live="polite">{speechStatusText[state.status]}</p>
    <div className="speech-interim" aria-live="polite" aria-atomic="true">{state.interim && <><strong>临时识别（尚未写入复述）</strong><span>{state.interim}</span></>}</div>
    {state.error && <div className="speech-error-box" role="alert">
      <p className="error">{state.error.message}</p>
      {(state.error.code === "network" || state.error.code === "service-not-allowed" || state.error.code === "no-result-timeout") && <p className="speech-dictation-hint" role="status">浏览器内置的语音识别服务（Chrome/Edge 走 Google 服务）在国内网络常常不可用。<button type="button" className="text-button speech-dictation-button" onClick={() => { controller.current?.stop(); setDictationHint(true); answerRef.current?.focus(); }}>改用系统听写</button>（Windows 按 <kbd>Windows + H</kbd> 即可语音输入），或直接打字。系统听写不走网页服务，通常可用。</p>}
    </div>}
    {dictationHint && <p className="speech-dictation-hint" role="status">已定位到“我的复述”。请在 Windows 上按 <kbd>Windows + H</kbd>，再对着麦克风说话，听写文字会写入输入框。若系统听写不可用，可以直接打字。</p>}
    <small>网页识别依赖浏览器的语音识别服务和麦克风权限，可能需要网络连接。DeepSeek 只用于文字评分；你可以随时打字或修改已确认文字。</small>
  </div>;
}
