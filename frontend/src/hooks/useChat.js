import { useState, useCallback, useRef } from 'react';
import axios from 'axios';

function makeMessage(role, content, type = 'text', payload = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    type,
    content,
    payload,
    timestamp: new Date()
  };
}

// Combine a known date (from dateIso) with a known time (from timeIso) into one ISO string.
// Both are in local time so we extract their components directly.
function combineDateAndTime(dateIso, timeIso) {
  const d = new Date(dateIso);
  const t = new Date(timeIso);
  return new Date(
    d.getFullYear(), d.getMonth(), d.getDate(),
    t.getHours(), t.getMinutes(), 0, 0
  ).toISOString();
}

// Accumulates fields across turns. New values win; previously known values are preserved
// when the new parse didn't re-extract them. date_known / time_known are OR'd so they
// only go from false→true, never backwards.
function mergeDraft(draft, incoming) {
  if (!draft) return incoming;
  if (incoming.action === 'unknown' && incoming.confidence < 0.3) return draft;

  const dateKnown = incoming.date_known || draft.date_known;
  const timeKnown = incoming.time_known || draft.time_known;

  // Resolve start_time from the combination of what's now known
  let startTime;
  if (incoming.date_known && incoming.time_known) {
    startTime = incoming.start_time;                          // fully resolved by new message
  } else if (incoming.time_known && !incoming.date_known && draft.date_known && draft.start_time && incoming.start_time) {
    startTime = combineDateAndTime(draft.start_time, incoming.start_time); // draft date + new time
  } else if (incoming.date_known && !incoming.time_known && draft.time_known && draft.start_time && incoming.start_time) {
    startTime = combineDateAndTime(incoming.start_time, draft.start_time); // new date + draft time
  } else if (incoming.date_known) {
    startTime = incoming.start_time;                          // new date (time still unknown)
  } else {
    startTime = draft.start_time;                             // keep draft value
  }

  return {
    action:           incoming.action !== 'unknown' ? incoming.action : draft.action,
    title:            incoming.title            ?? draft.title,
    start_time:       startTime                 ?? null,
    end_time:         incoming.end_time         ?? draft.end_time,
    duration_minutes: incoming.duration_minutes ?? draft.duration_minutes,
    attendees:        incoming.attendees?.length ? incoming.attendees : (draft.attendees ?? []),
    location:         incoming.location         ?? draft.location,
    confidence:       incoming.confidence,
    date_known:       dateKnown,
    time_known:       timeKnown,
  };
}

// Injects the running draft as context so the model understands follow-up messages.
// Prefix is clearly marked as metadata so the model doesn't extract it as event content.
function withDraftContext(text, draft) {
  if (!draft) return text;
  const parts = [];
  if (draft.title) parts.push(`title="${draft.title}"`);
  if (draft.date_known && draft.time_known && draft.start_time) {
    parts.push(`datetime=${draft.start_time}`);
  } else if (draft.date_known && draft.start_time) {
    parts.push(`date=${draft.start_time.split('T')[0]}`);
  }
  if (draft.duration_minutes) parts.push(`duration=${draft.duration_minutes}min`);
  if (draft.location)          parts.push(`location="${draft.location}"`);
  if (draft.attendees?.length) parts.push(`attendees=${draft.attendees.join(',')}`);
  if (parts.length === 0) return text;
  return `[DRAFT:${parts.join(' ')}] ${text}`;
}

const WELCOME = makeMessage(
  'assistant',
  'Hi! I\'m Nudge. Tell me what you\'d like to schedule — for example: "Schedule a 1-hour meeting with Alice tomorrow at 2pm"'
);

export default function useChat() {
  const [messages, setMessages] = useState([WELCOME]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Accumulates scheduling info across turns. Cleared only on successful confirm.
  const draftRef = useRef(null);
  // Tracks conversation turns for AI context — appended each turn, capped at 10.
  const historyRef = useRef([]);

  const confirmDelete = useCallback(async (eventId) => {
    try {
      await axios.delete(`/api/calendar/events/${eventId}`, { withCredentials: true });
      draftRef.current = null;
      historyRef.current = [];
      setTimeout(() => window.dispatchEvent(new CustomEvent('nudge:event-deleted')), 500);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to delete event.' };
    }
  }, []);

  const confirmUpdate = useCallback(async (eventId, patches) => {
    try {
      const res = await axios.patch(
        `/api/calendar/events/${eventId}`,
        patches,
        { withCredentials: true }
      );
      draftRef.current = null;
      historyRef.current = [];
      setTimeout(() => window.dispatchEvent(new CustomEvent('nudge:event-updated')), 500);
      return { success: true, event: res.data };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to update event.' };
    }
  }, []);

  const confirmBatch = useCallback(async (events) => {
    try {
      const res = await axios.post(
        '/api/assistant/confirm-batch',
        { events },
        { withCredentials: true }
      );
      draftRef.current = null;
      historyRef.current = [];
      setTimeout(() => window.dispatchEvent(new CustomEvent('nudge:batch-created')), 500);
      return { success: true, summary: res.data.summary };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to create events.' };
    }
  }, []);

  const confirmEvent = useCallback(async (intent) => {
    try {
      const res = await axios.post(
        '/api/assistant/confirm',
        { intent },
        { withCredentials: true }
      );
      draftRef.current = null;
      setTimeout(() => window.dispatchEvent(new CustomEvent('nudge:event-created')), 500);
      return {
        success: true,
        event: res.data.event,
        invitesSent: res.data.invitesSent || []
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error || 'Failed to create event.'
      };
    }
  }, []);

  const pickSuggestion = useCallback((suggestion, baseIntent) => {
    if (!baseIntent) return;
    const updatedDraft = {
      ...baseIntent,
      start_time: suggestion.start_time,
      end_time: suggestion.end_time,
      time_known: true,
      date_known: true,
    };
    draftRef.current = updatedDraft;

    const d = new Date(suggestion.start_time);
    const timeStr = d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });

    setMessages(prev => [
      ...prev,
      makeMessage('assistant', `Switched to ${timeStr} — ready to schedule?`, 'intent', updatedDraft),
      makeMessage('assistant', '', 'confirm', { intent: updatedDraft, hasConflicts: false })
    ]);
  }, []);

  const CANCEL_RE = /^(nevermind|never mind|cancel|stop|forget it|abort|reset|nope|no thanks|start over)\.?!?$/i;

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages(prev => [...prev, makeMessage('user', trimmed)]);

    // Handle abort phrases without calling the AI — prevents draft context from confusing the model.
    if (CANCEL_RE.test(trimmed)) {
      draftRef.current = null;
      historyRef.current = [];
      setMessages(prev => [
        ...prev,
        makeMessage('assistant', "No problem — starting fresh. What would you like to schedule?")
      ]);
      return;
    }

    setLoading(true);
    setError(null);

    const messageToSend = withDraftContext(trimmed, draftRef.current);
    const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const clientNow = new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    }); // e.g. "Friday, May 22, 2026 at 8:09 PM PDT" — unambiguously local

    try {
      const res = await axios.post(
        '/api/assistant/parse',
        { message: messageToSend, history: historyRef.current, now: clientNow, timezone: clientTimezone },
        { withCredentials: true }
      );
      const { intent, reply, conflicts, suggestions, candidates, queryResults, updateProposal, batchPlan } = res.data;

      const draft = mergeDraft(draftRef.current, intent);
      draftRef.current = draft;

      // Append this turn to history for future AI context
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-10);

      const isConversational = draft.action === 'unknown' || draft.confidence < 0.5;
      const newMessages = [
        makeMessage('assistant', reply, isConversational ? 'text' : 'intent', isConversational ? null : draft)
      ];

      const hasConflicts = conflicts?.length > 0;

      const readyToConfirm =
        draft.action === 'create' &&
        draft.title &&
        draft.date_known &&
        draft.time_known &&
        draft.start_time &&
        draft.confidence >= 0.5;

      if (hasConflicts) {
        const count = conflicts.length;
        const blurb = count === 1
          ? 'Heads up — there\'s already an event in that time slot.'
          : `Heads up — there are ${count} events in that time slot.`;
        // Pass intent so "Schedule anyway" can schedule directly — no second confirm card needed.
        newMessages.push(makeMessage('assistant', blurb, 'conflict', {
          conflicts,
          suggestions: suggestions || [],
          intent: readyToConfirm ? draft : null,
        }));
      }

      // Batch plan — show BatchPlanCard instead of single confirm.
      if (batchPlan) {
        newMessages.push(makeMessage('assistant', '', 'batchPlan', batchPlan));
      }

      // Only show confirm card when there are no conflicts and it's not a batch.
      if (readyToConfirm && !hasConflicts && !batchPlan) {
        newMessages.push(makeMessage('assistant', '', 'confirm', { intent: draft, hasConflicts: false }));
      }

      // Delete confirmation — show found candidates for user to confirm.
      if (intent.action === 'delete' && candidates?.length > 0) {
        newMessages.push(makeMessage('assistant', '', 'deleteConfirm', { candidates }));
      }

      // Query results — show fetched events as a list.
      if (intent.action === 'query' && queryResults?.length > 0) {
        newMessages.push(makeMessage('assistant', '', 'queryResult', { events: queryResults }));
      }

      // Update proposal — show before/after diff for user to confirm.
      if (intent.action === 'update' && updateProposal) {
        newMessages.push(makeMessage('assistant', '', 'editConfirm', updateProposal));
      }

      setMessages(prev => [...prev, ...newMessages]);
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Session expired. Please log in again.');
      } else if (err.response?.status === 429) {
        setError('Rate limit reached — please wait a moment and try again.');
      } else if (err.response?.status === 400) {
        setError(err.response.data?.error || 'Invalid request.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelDraft = useCallback(() => {
    draftRef.current = null;
    historyRef.current = [];
  }, []);

  return { messages, loading, error, sendMessage, confirmEvent, confirmDelete, confirmUpdate, confirmBatch, cancelDraft, pickSuggestion };
}
