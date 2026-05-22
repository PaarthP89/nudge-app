import { useState, useCallback } from 'react';
import axios from 'axios';

function makeMessage(role, content, type = 'text', payload = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,    // 'user' | 'assistant'
    type,    // 'text' | 'intent' | 'confirm' | 'conflict' | 'alternatives'
    content,
    payload, // structured data for rich message types
    timestamp: new Date()
  };
}

const WELCOME = makeMessage(
  'assistant',
  'Hi! I\'m Nudge. Tell me what you\'d like to schedule — for example: "Schedule a 1-hour meeting with Alice tomorrow at 2pm"'
);

export default function useChat() {
  const [messages, setMessages] = useState([WELCOME]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const confirmEvent = useCallback(async (intent) => {
    try {
      const res = await axios.post(
        '/api/assistant/confirm',
        { intent },
        { withCredentials: true }
      );
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

    try {
      const res = await axios.post(
        '/api/assistant/parse',
        { message: trimmed },
        { withCredentials: true }
      );
      const { intent, reply, conflicts } = res.data;
      const newMessages = [makeMessage('assistant', reply, 'intent', intent)];

      const hasConflicts = conflicts?.length > 0;
      if (hasConflicts) {
        const count = conflicts.length;
        const blurb = count === 1
          ? 'Heads up — there\'s already an event in that time slot.'
          : `Heads up — there are ${count} events in that time slot.`;
        newMessages.push(makeMessage('assistant', blurb, 'conflict', conflicts));
      }

      if (intent.action === 'create' && intent.start_time && intent.confidence >= 0.5) {
        newMessages.push(makeMessage('assistant', '', 'confirm', { intent, hasConflicts }));
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

  return { messages, loading, error, sendMessage, confirmEvent };
}
