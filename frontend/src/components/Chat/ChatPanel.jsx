import React, { useState, useRef, useEffect } from 'react';
import useChat from '../../hooks/useChat';
import './ChatPanel.css';

function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  // message.type is extensible: 'text' | 'intent' | 'confirm' | 'conflict' | 'alternatives'
  // Future objectives will branch here to render confirmation cards, conflict warnings, etc.
  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      <div className={`msg-bubble ${isUser ? 'user' : 'assistant'}`}>
        <p className="msg-content">{message.content}</p>
        <span className="msg-time">
          {message.timestamp.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
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

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, loading, error, sendMessage } = useChat();
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
          <MessageBubble key={msg.id} message={msg} />
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
