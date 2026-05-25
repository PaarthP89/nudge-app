import React, { useState } from 'react';

function formatSlotTime(slot) {
  const start = new Date(slot.start_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const end   = new Date(slot.end_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const date  = new Date(slot.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} · ${start} – ${end}`;
}

export default function SlotOptionsCard({ payload, onSelect, onCancel }) {
  const { slots, title, attendees } = payload ?? {};
  const [status, setStatus]     = useState('idle'); // idle | loading | done | error | cancelled
  const [errorMsg, setErrorMsg] = useState(null);
  const [loadingIdx, setLoadingIdx] = useState(null);

  if (!slots?.length && status === 'idle') {
    return (
      <div className="confirm-card">
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
          No free windows found in that period. Try a different day?
        </p>
        <div className="confirm-actions" style={{ marginTop: 8 }}>
          <button className="confirm-btn confirm-btn--cancel" onClick={() => { onCancel?.(); setStatus('cancelled'); }}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (status === 'done') {
    return <div className="confirm-card confirm-card--done">Scheduled! Check your calendar.</div>;
  }
  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }
  if (status === 'error') {
    return <div className="confirm-card confirm-card--error">{errorMsg}</div>;
  }

  async function handleSelect(slot, idx) {
    setLoadingIdx(idx);
    setStatus('loading');
    const result = await onSelect(slot);
    if (result.success) {
      setStatus('done');
    } else {
      setStatus('error');
      setErrorMsg(result.error);
    }
  }

  return (
    <div className="confirm-card">
      {(title || attendees?.length > 0) && (
        <div style={{ marginBottom: 8, fontSize: 14 }}>
          {title && <div style={{ fontWeight: 600 }}>{title}</div>}
          {attendees?.length > 0 && (
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
              With: {attendees.join(', ')}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {slots.map((slot, i) => (
          <button
            key={i}
            className="suggestion-btn"
            style={{ textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px' }}
            onClick={() => handleSelect(slot, i)}
            disabled={status === 'loading'}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>{formatSlotTime(slot)}</span>
            {slot.label && (
              <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
                {loadingIdx === i && status === 'loading' ? 'Scheduling…' : slot.label}
              </span>
            )}
          </button>
        ))}
      </div>
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
