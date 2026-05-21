import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import CalendarView from '../components/Calendar/CalendarView';
import ChatPanel from '../components/Chat/ChatPanel';
import useAuth from '../hooks/useAuth';

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: '320px', borderRight: '1px solid #e5e7eb' }}>
        <ChatPanel />
      </aside>
      <main style={{ flex: 1 }}>
        <CalendarView />
      </main>
    </div>
  );
}
