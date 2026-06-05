import React, { useState, useRef, useEffect } from 'react';
import './VoiceMode.css';

function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

const STATUS_LABELS = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  done: 'Done',
  error: 'Error',
};

export default function VoiceMode({ onClose }) {
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const recognitionRef = useRef(null);
  const abortRef = useRef(null);
  const loopActiveRef = useRef(false);
  const statusRef = useRef('idle');
  const voiceHistoryRef = useRef([]);

  function updateStatus(s) {
    statusRef.current = s;
    setStatus(s);
  }

  // Create SpeechRecognition instance once on mount
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;
    return () => {
      try { recognition.abort(); } catch (_) {}
    };
  }, []);

  // Cleanup loop on unmount
  useEffect(() => {
    return () => {
      loopActiveRef.current = false;
      try { recognitionRef.current?.abort(); } catch (_) {}
      window.speechSynthesis?.cancel();
      abortRef.current?.abort();
    };
  }, []);

  // ── Loop functions (function declarations — hoisted, safe to cross-reference) ──

  function stopLoop() {
    loopActiveRef.current = false;
    voiceHistoryRef.current = [];
    try { recognitionRef.current?.abort(); } catch (_) {}
    window.speechSynthesis?.cancel();
    abortRef.current?.abort();
    updateStatus('idle');
    setTranscript('');
  }

  function speakAndContinue(text, audioMetadata) {
    if (!loopActiveRef.current) return;
    updateStatus('speaking');
    setLastReply(text);

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;

    let afterSpeakCalled = false;
    const afterSpeak = () => {
      if (afterSpeakCalled || !loopActiveRef.current) return;
      afterSpeakCalled = true;
      clearTimeout(fallbackTimer);
      if (audioMetadata?.waitForInput && audioMetadata?.clearToListen) {
        playPing();
        setTimeout(() => {
          if (loopActiveRef.current) startListening();
        }, 300);
      } else {
        loopActiveRef.current = false;
        updateStatus('done');
      }
    };

    // Fallback timer guards against Chrome's intermittent utter.onend failure
    const estimatedMs = Math.max(2500, text.length * 65);
    const fallbackTimer = setTimeout(afterSpeak, estimatedMs);

    utter.onend = afterSpeak;
    utter.onerror = afterSpeak;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  async function sendToBackend(text) {
    if (!loopActiveRef.current) return;
    updateStatus('thinking');

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/assistant/voice-parse', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: voiceHistoryRef.current,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          localDatetime: new Date().toLocaleString(),
        }),
        signal: abort.signal,
      });

      if (!loopActiveRef.current) return;

      if (res.status === 401) {
        loopActiveRef.current = false;
        setErrorMsg('Session expired. Please reload and sign in again.');
        updateStatus('error');
        return;
      }

      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }

      const data = await res.json();
      if (!loopActiveRef.current) return;

      // Accumulate conversation history (capped at 10 turns = 20 entries)
      voiceHistoryRef.current = [
        ...voiceHistoryRef.current,
        { role: 'user', content: text },
        { role: 'assistant', content: data.speechReply || '' }
      ].slice(-20);

      speakAndContinue(data.speechReply, data.audioMetadata);
    } catch (err) {
      if (!loopActiveRef.current) return;
      if (err.name === 'AbortError') return;
      setErrorMsg(err.message || 'Network error. Check your connection.');
      updateStatus('error');
      loopActiveRef.current = false;
    }
  }

  function startListening() {
    const recognition = recognitionRef.current;
    if (!recognition || !loopActiveRef.current) return;

    updateStatus('listening');
    setTranscript('');

    let accumulatedFinal = '';
    let silenceTimer = null;
    let maxListenTimer = null;

    recognition.onresult = (e) => {
      clearTimeout(silenceTimer);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) accumulatedFinal += e.results[i][0].transcript;
      }
      // Show accumulated final + latest interim as live preview
      let interim = '';
      for (let i = e.results.length - 1; i >= 0; i--) {
        if (!e.results[i].isFinal) { interim = e.results[i][0].transcript; break; }
      }
      setTranscript((accumulatedFinal + interim).trim());

      // Silence timer: stop recognition 1.5s after last speech input
      silenceTimer = setTimeout(() => {
        try { recognition.stop(); } catch (_) {}
      }, 1500);
    };

    recognition.onerror = (e) => {
      clearTimeout(silenceTimer);
      clearTimeout(maxListenTimer);
      if (e.error === 'no-speech') return;
      if (e.error === 'aborted') return;
      loopActiveRef.current = false;
      setErrorMsg(`Microphone error: ${e.error}`);
      updateStatus('error');
    };

    recognition.onend = () => {
      clearTimeout(silenceTimer);
      clearTimeout(maxListenTimer);
      if (!loopActiveRef.current) return;
      if (statusRef.current !== 'listening') return;

      if (accumulatedFinal.trim()) {
        sendToBackend(accumulatedFinal.trim());
      } else {
        // No speech captured — restart after brief pause
        setTimeout(() => {
          if (loopActiveRef.current) startListening();
        }, 150);
      }
    };

    // Safety net: cap each listen session at 15s to avoid infinite mic hold
    maxListenTimer = setTimeout(() => {
      try { recognition.stop(); } catch (_) {}
    }, 15000);

    try {
      recognition.start();
    } catch (_) {
      clearTimeout(maxListenTimer);
      setTimeout(() => {
        if (loopActiveRef.current) startListening();
      }, 200);
    }
  }

  function startLoop() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErrorMsg('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      updateStatus('error');
      return;
    }
    loopActiveRef.current = true;
    setErrorMsg('');
    setLastReply('');
    startListening();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const isActive = status === 'listening' || status === 'thinking' || status === 'speaking';

  return (
    <div className="voice-mode" role="main" aria-label="Voice mode">
      <div className="voice-mode-header">
        <div className="voice-mode-logo">
          <span className="app-logo-mark">N</span>
          <span className="voice-mode-title">Voice Mode</span>
        </div>
        <button
          className="voice-mode-close"
          onClick={() => { stopLoop(); onClose?.(); }}
          aria-label="Exit voice mode"
        >
          ✕
        </button>
      </div>

      <div className="voice-mode-stage">
        <div
          className={`voice-status-ring voice-status-ring--${status}`}
          role="status"
          aria-label={STATUS_LABELS[status] || status}
        >
          <span className="voice-status-label">{STATUS_LABELS[status] || status}</span>
        </div>

        {transcript && (
          <p className="voice-transcript" aria-live="polite">
            &ldquo;{transcript}&rdquo;
          </p>
        )}

        {lastReply && (
          <p className="voice-reply" aria-live="polite">
            {lastReply}
          </p>
        )}

        {errorMsg && (
          <p className="voice-error" role="alert">
            {errorMsg}
          </p>
        )}
      </div>

      <div className="voice-mode-controls">
        {!isActive && (
          <button className="voice-start-btn" onClick={startLoop}>
            {status === 'done' ? 'Start Again' : status === 'error' ? 'Retry' : 'Start Voice Mode'}
          </button>
        )}
      </div>

      {isActive && (
        <button
          className="voice-stop-fab"
          onClick={stopLoop}
          aria-label="Stop voice mode"
        >
          &#9632;
        </button>
      )}
    </div>
  );
}
