import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export default function useCalendar(startDate, endDate) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const startISO = startDate?.toISOString();
  const endISO = endDate?.toISOString();

  const fetchEvents = useCallback(async () => {
    if (!startISO || !endISO) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/calendar/events', {
        params: { start: startISO, end: endISO },
        withCredentials: true
      });
      setEvents(res.data.events);
    } catch (err) {
      if (err.response?.status === 401) {
        setError({ type: 'auth', message: 'Session expired. Please log in again.' });
      } else {
        setError({ type: 'fetch', message: 'Failed to load calendar events.' });
      }
    } finally {
      setLoading(false);
    }
  }, [startISO, endISO]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
