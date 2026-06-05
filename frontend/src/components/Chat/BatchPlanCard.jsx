import React, { useState } from 'react';

function formatInstanceTime(inst) {
  return new Date(inst.start_time).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

export default function BatchPlanCard({ payload, onConfirmBatch, onCancel }) {
  const { instances, summary } = payload;
  const [status, setStatus] = useState('idle'); // idle | loading | done | error | cancelled
  const [errorMsg, setErrorMsg] = useState(null);
  const [doneMsg, setDoneMsg] = useState(null);

  const conflicted = instances.filter(i => i.conflicts?.length > 0);
  const clean = instances.filter(i => !i.conflicts?.length);

  async function handleConfirm(eventsToCreate) {
    setStatus('loading');
    const result = await onConfirmBatch(eventsToCreate);
    if (result.success) {
      setDoneMsg(result.summary);
      setStatus('done');
    } else {
      setErrorMsg(result.error);
      setStatus('error');
    }
  }

  if (status === 'done') {
    return <div className="confirm-card confirm-card--done">{doneMsg || 'Done! Check your calendar.'}</div>;
  }
  if (status === 'cancelled') {
    return <div className="confirm-card confirm-card--cancelled">Cancelled.</div>;
  }
  if (status === 'error') {
    return <div className="confirm-card confirm-card--error">{errorMsg}</div>;
  }

  return (
    <div className="confirm-card">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{summary}</div>
      <div style={{ marginBottom: 12 }}>
        {instances.map((inst, i) => (
          <div
            key={i}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 0', fontSize: 13,
              opacity: inst.conflicts?.length ? 0.85 : 1,
            }}
          >
            <span>{formatInstanceTime(inst)}</span>
            {inst.conflicts?.length > 0 && (
              <span style={{ color: '#e07b54', fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
                ⚠ conflict
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="confirm-actions" style={{ flexDirection: 'column', gap: 6 }}>
        <button
          className="confirm-btn confirm-btn--primary"
          onClick={() => handleConfirm(instances)}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Creating…' : `Confirm all ${instances.length}`}
        </button>
        {conflicted.length > 0 && clean.length > 0 && (
          <button
            className="confirm-btn"
            onClick={() => handleConfirm(clean)}
            disabled={status === 'loading'}
          >
            Skip {conflicted.length} conflicted, confirm {clean.length}
          </button>
        )}
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
