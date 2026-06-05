import React from 'react';

export default function LoginPage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#fbf9f8',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #e3e2e2',
        borderRadius: 8,
        padding: '40px 36px',
        width: 340,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{
          width: 48,
          height: 48,
          background: '#0f62fe',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 22,
          fontWeight: 700,
        }}>N</div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#313333', marginBottom: 6 }}>Nudge</h1>
          <p style={{ fontSize: 14, color: '#5e5f5f', lineHeight: 1.5 }}>
            AI-powered scheduling assistant
          </p>
        </div>
        <a href={`${import.meta.env.VITE_API_URL}/api/auth/google`} style={{ width: '100%', textDecoration: 'none' }}>
          <button style={{
            width: '100%',
            background: '#0f62fe',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Sign in with Google
          </button>
        </a>
      </div>
    </div>
  );
}
