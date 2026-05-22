import React, { useState, useRef, useEffect } from 'react';
import useChat from '../../hooks/useChat';
import './ChatPanel.css';

// ─── IntentCard ───────────────────────────────────────────────────────────────
// Renders the structured scheduling intent extracted by the AI.
// Only shown when confidence >= 0.5 and action is a real scheduling action.

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function IntentCard({ intent }) {
  if (!intent || intent.confidence < 0.5 || intent.action === 'unknown') return null;

  const rows = [];

  if (intent.title) {
    rows.push({ label: 'Event', value: intent.title });
  }
  if (intent.start_time && intent.time_known) {
    const d = new Date(intent.start_time);
    rows.push({
      label: 'When',
      value: d.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      })
    });
  }
  if (intent.duration_minutes) {
    rows.push({ label: 'Duration', value: formatDuration(intent.duration_minutes) });
  }
  if (intent.attendees?.length > 0) {
    rows.push({ label: 'With', value: intent.attendees.join(', ') });
  }
  if (intent.location) {
    rows.push({ label: 'Where', value: intent.location });
  }

  if (rows.length === 0) return null;

  return (
    <div className="intent-card">
      {rows.map(r => (
        <div key={r.label} className="intent-row">
          <span className="intent-label">{r.label}</span>
          <span className="intent-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── ConflictCard ─────────────────────────────────────────────────────────────

function formatTimeRange(start, end) {
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  const startStr = new Date(start).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', ...timeOpts
  });
  const endStr = new Date(end).toLocaleTimeString(undefined, timeOpts);
  return `${startStr} – ${endStr}`;
}

function ConflictCard({ conflicts, onCancel }) {
  const [dismissed, setDismissed] = useState(false);
  if (!conflicts?.length || dismissed) return null;
  return (
    <div className="conflict-card">
      <div className="conflict-header">
        {conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`}
      </div>
      {conflicts.map(ev => (
        <div key={ev.id} className="conflict-event">
          <span className="conflict-event-title">{ev.title}</span>
          <span className="conflict-event-time">{formatTimeRange(ev.start, ev.end)}</span>
        </div>
      ))}
      <div className="conflict-actions">
        <button className="conflict-btn conflict-btn--continue" onClick={() => setDismissed(true)}>
          Continue anyway
        </button>
        <button className="conflict-btn conflict-btn--cancel" onClick={() => { onCancel?.(); setDismissed(true); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── ConfirmCard ──────────────────────────────────────────────────────────────

function ConfirmCard({ payload, onConfirm }) {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error | cancelled
  const [errorMsg, setErrorMsg] = useState(null);
  const { intent, hasConflicts } = payload;

  async function handleConfirm() {
    setStatus('loading');
    const result = await onConfirm(intent);
    if (result.success) {
      setStatus('done');
    } else {
      setStatus('error');
      setErrorMsg(result.error);
    }
  }

  if (status === 'done') {
    return (
      <div className="confirm-card confirm-card--done">
        Scheduled! Check your calendar.
      </div>
    );
  }
  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }
  if (status === 'error') {
    return <div className="confirm-card confirm-card--error">{errorMsg}</div>;
  }

  return (
    <div className="confirm-card">
      <p className="confirm-prompt">
        {hasConflicts ? 'Schedule anyway?' : 'Ready to add this to your calendar?'}
      </p>
      <div className="confirm-actions">
        <button
          className={`confirm-btn confirm-btn--primary${hasConflicts ? ' confirm-btn--warn' : ''}`}
          onClick={handleConfirm}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Scheduling…' : hasConflicts ? 'Schedule anyway' : 'Schedule it'}
        </button>
        <button
          className="confirm-btn confirm-btn--cancel"
          onClick={() => setStatus('cancelled')}
          disabled={status === 'loading'}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────
// Branches on message.type for extensibility:
//   'text'         — plain assistant text (welcome, errors)
//   'intent'       — parsed intent + summary text (this objective)
//   'confirm'      — confirmation card   (Objective 7, payload = event draft)
//   'conflict'     — conflict warning    (Objective 6, payload = conflict list)
//   'alternatives' — slot suggestions   (Phase 2)

function MessageBubble({ message, onConfirm, onCancelDraft }) {
  const isUser = message.role === 'user';

  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      <div className={`msg-bubble ${isUser ? 'user' : 'assistant'}`}>
        {message.content && <p className="msg-content">{message.content}</p>}
        {message.type === 'intent' && (
          <IntentCard intent={message.payload} />
        )}
        {message.type === 'conflict' && (
          <ConflictCard conflicts={message.payload} onCancel={onCancelDraft} />
        )}
        {message.type === 'confirm' && (
          <ConfirmCard payload={message.payload} onConfirm={onConfirm} />
        )}
        <span className="msg-time">
          {message.timestamp.toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit'
          })}
        </span>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="msg-row assistant">
      <div className="msg-bubble assistant typing-bubble">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, loading, error, sendMessage, confirmEvent, cancelDraft } = useChat();
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendMessage(trimmed);
    setInput('');
    textareaRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Nudge</span>
        <span className="chat-subtitle">AI scheduling assistant</span>
      </div>

      <div className="chat-messages">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} onConfirm={confirmEvent} onCancelDraft={cancelDraft} />
        ))}
        {loading && <TypingIndicator />}
        {error && <div className="chat-error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Schedule something… (Enter to send)"
          rows={1}
          disabled={loading}
          aria-label="Message input"
        />
        <button
          type="submit"
          className="chat-send"
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
