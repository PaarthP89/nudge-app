import React, { useState } from 'react';

export default function ChatPanel() {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setInput('');
  };

  return (
    <div>
      <p>Chat with Nudge</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Nudge..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
