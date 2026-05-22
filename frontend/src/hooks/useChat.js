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

  const confirmEvent = useCallback(async (intent) => {
    try {
      const res = await axios.post(
        '/api/assistant/confirm',
        { intent },
        { withCredentials: true }
      );
      draftRef.current = null;
      setTimeout(() => window.dispatchEvent(new CustomEvent('nudge:event-created')), 500);
      return { success: true, event: res.data.event };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error || 'Failed to create event.'
      };
    }
  }, []);

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages(prev => [...prev, makeMessage('user', trimmed)]);
    setLoading(true);
    setError(null);

    const messageToSend = withDraftContext(trimmed, draftRef.current);

    try {
      const res = await axios.post(
        '/api/assistant/parse',
        { message: messageToSend },
        { withCredentials: true }
      );
      const { intent, reply, conflicts } = res.data;

      const draft = mergeDraft(draftRef.current, intent);
      draftRef.current = draft;

      const isConversational = draft.action === 'unknown' || draft.confidence < 0.5;
      const newMessages = [
        makeMessage('assistant', reply, isConversational ? 'text' : 'intent', isConversational ? null : draft)
      ];

      const hasConflicts = conflicts?.length > 0;
      if (hasConflicts) {
        const count = conflicts.length;
        const blurb = count === 1
          ? 'Heads up — there\'s already an event in that time slot.'
          : `Heads up — there are ${count} events in that time slot.`;
        newMessages.push(makeMessage('assistant', blurb, 'conflict', conflicts));
      }

      // Show confirm only when all three pieces are confirmed
      const readyToConfirm =
        draft.action === 'create' &&
        draft.title &&
        draft.date_known &&
        draft.time_known &&
        draft.start_time &&
        draft.confidence >= 0.5;

      if (readyToConfirm) {
        newMessages.push(makeMessage('assistant', '', 'confirm', { intent: draft, hasConflicts }));
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
  }, []);

  return { messages, loading, error, sendMessage, confirmEvent, cancelDraft };
}
