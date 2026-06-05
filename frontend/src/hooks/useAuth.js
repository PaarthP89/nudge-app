import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/auth/me')
      .then((res) => setUser(res.data))
      .catch((err) => {
        if (err.response?.status === 401) {
          setUser(null);
        } else {
          setError(err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, error };
}
