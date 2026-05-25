import React, { useState } from 'react';

function formatEventTime(dateStr) {
  if (!dateStr) return '?';
  return new Date(dateStr).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

export default function EditConfirmCard({ payload, onConfirmUpdate, onCancel }) {
  const { candidate, patches, after, conflicts } = payload;
  const [status, setStatus] = useState('idle'); // idle | loading | done | error | cancelled
  const [errorMsg, setErrorMsg] = useState(null);

  const titleChanged = after.title !== candidate.title;
  const timeChanged  = after.start !== candidate.start;

  async function handleConfirm() {
    setStatus('loading');
    const result = await onConfirmUpdate(candidate.id, patches);
    if (result.success) setStatus('done');
    else { setStatus('error'); setErrorMsg(result.error); }
  }

  if (status === 'done') {
    return <div className="confirm-card confirm-card--done">Updated! Check your calendar.</div>;
  }
  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }
  if (status === 'error') {
    return <div className="confirm-card confirm-card--error">{errorMsg}</div>;
  }

  return (
    <div className="confirm-card">
      <div className="intent-card">
        <div className="intent-row">
          <span className="intent-label">Event</span>
          <span className="intent-value">
            {titleChanged ? (
              <><span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{candidate.title}</span>{' → '}{after.title}</>
            ) : (
              candidate.title
            )}
          </span>
        </div>
        <div className="intent-row">
          <span className="intent-label">Time</span>
          <span className="intent-value">
            {timeChanged ? (
              <><span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{formatEventTime(candidate.start)}</span>{' → '}{formatEventTime(after.start)}</>
            ) : (
              formatEventTime(candidate.start)
            )}
          </span>
        </div>
      </div>
      {conflicts?.length > 0 && (
        <div style={{ fontSize: 12, color: '#e07b54', marginBottom: 8 }}>
          Warning: conflicts with {conflicts.map(c => c.title).join(', ')}
        </div>
      )}
      <div className="confirm-actions">
        <button
          className="confirm-btn confirm-btn--primary"
          onClick={handleConfirm}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Updating…' : 'Update'}
        </button>
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
