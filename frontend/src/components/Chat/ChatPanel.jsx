import React, { useState, useRef, useEffect } from 'react';
import useChat from '../../hooks/useChat';
import EditConfirmCard from './EditConfirmCard';
import BatchPlanCard from './BatchPlanCard';
import SlotOptionsCard from './SlotOptionsCard';
import './ChatPanel.css';

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatEventDateTime(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

// ─── IntentCard ───────────────────────────────────────────────────────────────

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

function ConflictCard({ payload, onConfirm, onCancel, onPickSuggestion }) {
  const { conflicts, intent, suggestions } = payload ?? {};
  const [status, setStatus] = useState('idle'); // idle | loading | done | error | dismissed
  const [errorMsg, setErrorMsg] = useState(null);
  const [doneData, setDoneData] = useState(null);

  if (!conflicts?.length || status === 'dismissed') return null;

  if (status === 'done') {
    const count = doneData?.invitesSent?.length || 0;
    return (
      <div className="confirm-card confirm-card--done">
        Scheduled!{count > 0 ? ` Invites sent to ${count} attendee${count > 1 ? 's' : ''}.` : ' Check your calendar.'}
      </div>
    );
  }
  if (status === 'error') {
    return <div className="confirm-card confirm-card--error">{errorMsg}</div>;
  }

  async function handleContinue() {
    if (!intent) { setStatus('dismissed'); return; }
    setStatus('loading');
    const result = await onConfirm(intent);
    if (result.success) { setDoneData(result); setStatus('done'); }
    else { setStatus('error'); setErrorMsg(result.error); }
  }

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
      {suggestions?.length > 0 && (
        <div className="conflict-suggestions">
          <div className="suggestions-label">Try one of these instead:</div>
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="suggestion-btn"
              onClick={() => onPickSuggestion?.(s, intent)}
              disabled={status === 'loading'}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="conflict-actions">
        <button
          className="conflict-btn conflict-btn--continue"
          onClick={handleContinue}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Scheduling…' : intent ? 'Schedule anyway' : 'Continue anyway'}
        </button>
        <button
          className="conflict-btn conflict-btn--cancel"
          onClick={() => { onCancel?.(); setStatus('dismissed'); }}
          disabled={status === 'loading'}
        >
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
  const [doneData, setDoneData] = useState(null);
  const { intent, hasConflicts } = payload;

  async function handleConfirm() {
    setStatus('loading');
    const result = await onConfirm(intent);
    if (result.success) {
      setDoneData(result);
      setStatus('done');
    } else {
      setStatus('error');
      setErrorMsg(result.error);
    }
  }

  if (status === 'done') {
    const count = doneData?.invitesSent?.length || 0;
    return (
      <div className="confirm-card confirm-card--done">
        Scheduled!{count > 0 ? ` Invites sent to ${count} attendee${count > 1 ? 's' : ''}.` : ' Check your calendar.'}
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

// ─── QueryResultCard ──────────────────────────────────────────────────────────

function QueryResultCard({ payload }) {
  const { events } = payload;
  if (!events?.length) return null;

  return (
    <div className="query-result-card">
      {events.map(ev => (
        <div key={ev.id} className="query-result-row">
          <div className="query-result-title">{ev.title}</div>
          {!ev.allDay && (
            <div className="query-result-time">
              {formatTime(ev.start)} – {formatTime(ev.end)}
            </div>
          )}
          {ev.allDay && <div className="query-result-time">All day</div>}
        </div>
      ))}
    </div>
  );
}

// ─── DeleteConfirmCard ────────────────────────────────────────────────────────

function DeleteConfirmCard({ payload, onConfirmDelete, onCancel }) {
  const { candidates } = payload;
  const [status, setStatus] = useState('idle'); // idle | loading | done | error | cancelled
  const [deletingId, setDeletingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  if (status === 'done') {
    return <div className="confirm-card confirm-card--done">Deleted! Check your calendar.</div>;
  }
  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }

  async function handleDelete(ev) {
    setDeletingId(ev.id);
    setStatus('loading');
    const result = await onConfirmDelete(ev.id);
    if (result.success) {
      setStatus('done');
    } else {
      setStatus('error');
      setErrorMsg(result.error);
      setDeletingId(null);
    }
  }

  return (
    <div className="confirm-card">
      {candidates.map(ev => (
        <div key={ev.id} className="delete-candidate-row">
          <div className="delete-candidate-info">
            <div className="delete-candidate-title">{ev.title}</div>
            {!ev.allDay && (
              <div className="delete-candidate-time">
                {formatEventDateTime(ev.start)} – {formatTime(ev.end)}
              </div>
            )}
          </div>
          <button
            className="confirm-btn confirm-btn--warn"
            onClick={() => handleDelete(ev)}
            disabled={status === 'loading'}
          >
            {deletingId === ev.id && status === 'loading' ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ))}
      {status === 'error' && (
        <div className="confirm-card--error" style={{ fontSize: 12 }}>{errorMsg}</div>
      )}
      <div className="confirm-actions">
        <button
          className="confirm-btn confirm-btn--cancel"
          onClick={() => { onCancel?.(); setStatus('cancelled'); }}
          disabled={status === 'loading'}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── UpdateCandidateCard ──────────────────────────────────────────────────────

function UpdateCandidateCard({ payload, onSelectCandidate, onCancel }) {
  const { candidates, intent } = payload ?? {};
  const [status, setStatus] = useState('idle'); // idle | loading | cancelled
  const [loadingId, setLoadingId] = useState(null);

  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }

  if (!candidates?.length) return null;

  async function handleSelect(ev) {
    setLoadingId(ev.id);
    setStatus('loading');
    await onSelectCandidate(ev, intent);
    setStatus('idle');
    setLoadingId(null);
  }

  return (
    <div className="confirm-card">
      {candidates.map(ev => (
        <div key={ev.id} className="delete-candidate-row">
          <div className="delete-candidate-info">
            <div className="delete-candidate-title">{ev.title}</div>
            {!ev.allDay && (
              <div className="delete-candidate-time">
                {formatEventDateTime(ev.start)} – {formatTime(ev.end)}
              </div>
            )}
          </div>
          <button
            className="confirm-btn confirm-btn--primary"
            onClick={() => handleSelect(ev)}
            disabled={status === 'loading'}
            style={{ flexShrink: 0 }}
          >
            {loadingId === ev.id && status === 'loading' ? 'Loading…' : 'Select'}
          </button>
        </div>
      ))}
      <div className="confirm-actions">
        <button
          className="confirm-btn confirm-btn--cancel"
          onClick={() => { onCancel?.(); setStatus('cancelled'); }}
          disabled={status === 'loading'}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, onConfirm, onConfirmDelete, onConfirmUpdate, onConfirmBatch, onConfirmSlot, onCancelDraft, onPickSuggestion, onSelectUpdateCandidate }) {
  const isUser = message.role === 'user';

  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      <div className={`msg-bubble ${isUser ? 'user' : 'assistant'}`}>
        {message.content && <p className="msg-content">{message.content}</p>}
        {message.type === 'intent' && (
          <IntentCard intent={message.payload} />
        )}
        {message.type === 'conflict' && (
          <ConflictCard
            payload={message.payload}
            onConfirm={onConfirm}
            onCancel={onCancelDraft}
            onPickSuggestion={onPickSuggestion}
          />
        )}
        {message.type === 'confirm' && (
          <ConfirmCard payload={message.payload} onConfirm={onConfirm} />
        )}
        {message.type === 'deleteConfirm' && (
          <DeleteConfirmCard
            payload={message.payload}
            onConfirmDelete={onConfirmDelete}
            onCancel={onCancelDraft}
          />
        )}
        {message.type === 'queryResult' && (
          <QueryResultCard payload={message.payload} />
        )}
        {message.type === 'editConfirm' && (
          <EditConfirmCard
            payload={message.payload}
            onConfirmUpdate={onConfirmUpdate}
            onCancel={onCancelDraft}
          />
        )}
        {message.type === 'batchPlan' && (
          <BatchPlanCard
            payload={message.payload}
            onConfirmBatch={onConfirmBatch}
            onCancel={onCancelDraft}
          />
        )}
        {message.type === 'slotOptions' && (
          <SlotOptionsCard
            payload={message.payload}
            onSelect={(slot) => onConfirmSlot(slot, message.payload)}
            onCancel={onCancelDraft}
          />
        )}
        {message.type === 'updateDisambig' && (
          <UpdateCandidateCard
            payload={message.payload}
            onSelectCandidate={onSelectUpdateCandidate}
            onCancel={onCancelDraft}
          />
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

const QUICK_CHIPS = [
  { label: 'Schedule meeting', fill: 'Schedule a meeting ' },
  { label: "Today's Brief", fill: "What's on my calendar today?" },
  { label: 'Reschedule…', fill: 'Reschedule ' },
];

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, loading, error, sendMessage, confirmEvent, confirmDelete, confirmUpdate, confirmBatch, confirmSlot, cancelDraft, pickSuggestion, selectUpdateCandidate } = useChat();
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
        <div className="chat-header-main">
          <div className="chat-avatar" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </div>
          <div className="chat-header-info">
            <span className="chat-title">Nudge AI</span>
            <div className="chat-status">
              <span className="chat-status-dot" />
              <span className="chat-subtitle">ACTIVE PARTNER</span>
            </div>
          </div>
        </div>
        <button className="chat-menu-btn" aria-label="More options">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
      </div>

      <div className="chat-messages">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onConfirm={confirmEvent}
            onConfirmDelete={confirmDelete}
            onConfirmUpdate={confirmUpdate}
            onConfirmBatch={confirmBatch}
            onConfirmSlot={confirmSlot}
            onCancelDraft={cancelDraft}
            onPickSuggestion={pickSuggestion}
            onSelectUpdateCandidate={selectUpdateCandidate}
          />
        ))}
        {loading && <TypingIndicator />}
        {error && <div className="chat-error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-chips">
        {QUICK_CHIPS.map(chip => (
          <button
            key={chip.label}
            className="chat-chip"
            type="button"
            disabled={loading}
            onClick={() => {
              setInput(chip.fill);
              textareaRef.current?.focus();
            }}
          >
            {chip.label}
          </button>
        ))}
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
