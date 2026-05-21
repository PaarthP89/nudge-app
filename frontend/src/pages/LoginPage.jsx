import React from 'react';

export default function LoginPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <h1>Nudge</h1>
      <a href="/api/auth/google">
        <button>Sign in with Google</button>
      </a>
    </div>
  );
}
