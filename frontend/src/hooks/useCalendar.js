import { useState } from 'react';

export default function useCalendar() {
  const [events] = useState([]);
  const [loading] = useState(false);
  const [error] = useState(null);

  return { events, loading, error };
}
