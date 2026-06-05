import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CalendarView from '../components/Calendar/CalendarView';
import ChatPanel from '../components/Chat/ChatPanel';
import VoiceMode from '../components/Voice/VoiceMode';
import useAuth from '../hooks/useAuth';

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  if (loading) return <div className="app-loading">Loading…</div>;

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="app-nav-left">
          <div className="app-logo">
            <span className="app-logo-mark">N</span>
            <span className="app-logo-name">Nudge</span>
          </div>
          <div className="app-nav-tabs">
            <button className="app-nav-tab active">Calendar</button>
          </div>
        </div>
        <div className="app-nav-right">
          <button
            className="app-nav-new-event"
            onClick={() => document.querySelector('.chat-input')?.focus()}
          >
            New Event
          </button>
          <button
            className="app-nav-icon"
            aria-label="Voice mode"
            onClick={() => {
              window.dispatchEvent(new Event('nudge:event-created'));
              setVoiceOpen(true);
            }}
            title="Voice mode"
          >
            <MicIcon />
          </button>
          <button className="app-nav-icon" aria-label="Notifications">
            <BellIcon />
          </button>
          <button className="app-nav-icon" aria-label="Account">
            <AccountIcon />
          </button>
        </div>
      </nav>

      {voiceOpen && <VoiceMode onClose={() => setVoiceOpen(false)} />}

      <div className="app-body">
        <aside className="app-sidebar">
          <ChatPanel />
        </aside>
        <main className="app-main">
          <CalendarView />
        </main>
      </div>
    </div>
  );
}
