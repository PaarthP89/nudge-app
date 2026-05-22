import { useState, useCallback } from 'react';
import axios from 'axios';

function makeMessage(role, content, type = 'text', payload = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,    // 'user' | 'assistant'
    type,    // 'text' | 'intent' | 'confirm' | 'conflict' | 'alternatives'
    content,
    payload, // structured data for future rich message types
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

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages(prev => [...prev, makeMessage('user', trimmed)]);
    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(
        '/api/assistant/chat',
        { message: trimmed },
        { withCredentials: true }
      );
      setMessages(prev => [...prev, makeMessage('assistant', res.data.reply)]);
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, loading, error, sendMessage };
}
