import React, { useState, useMemo, useRef, useEffect } from 'react';
import useCalendar from '../../hooks/useCalendar';
import './CalendarView.css';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_HEIGHT = 60; // 1 px per minute
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── date helpers ────────────────────────────────────────────────────────────

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getWeekStart(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMonthLabel(date) {
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function formatWeekLabel(start) {
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  return (
    `${start.toLocaleString(undefined, { month: 'short' })} ${start.getDate()} – ` +
    `${end.toLocaleString(undefined, { month: 'short' })} ${end.getDate()}, ${end.getFullYear()}`
  );
}

function formatHour(h) {
  if (h === 0) return '';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// Greedy column assignment for overlapping events within a single day.
// Returns Map<eventId, { col, totalCols }>.
function computeLayouts(events) {
  const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
  const colEnds = [];
  const assigned = new Map();

  sorted.forEach(ev => {
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.end).getTime();
    let col = colEnds.findIndex(e => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); }
    else colEnds[col] = Math.max(colEnds[col], end);
    assigned.set(ev.id, col);
  });

  const totalCols = Math.max(1, colEnds.length);
  const result = new Map();
  assigned.forEach((col, id) => result.set(id, { col, totalCols }));
  return result;
}

// ─── WeekView ─────────────────────────────────────────────────────────────────

function WeekView({ days, events, today }) {
  const scrollRef = useRef(null);

  // Scroll so ~2 hours before now are visible on mount.
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    scrollRef.current.scrollTop = Math.max(0, now.getHours() * HOUR_HEIGHT - 2 * HOUR_HEIGHT);
  }, []);

  const allDayEvents = events.filter(ev => ev.allDay);
  const timedEvents  = events.filter(ev => !ev.allDay);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  function getAllDayForDay(day) {
    const dayStr = toLocalDateString(day);
    return allDayEvents.filter(ev => ev.start <= dayStr && ev.end > dayStr);
  }

  function getTimedForDay(day) {
    return timedEvents.filter(ev => isSameDay(new Date(ev.start), day));
  }

  function eventStyle(ev, col, totalCols) {
    const start = new Date(ev.start);
    const end   = new Date(ev.end);
    const startMins    = start.getHours() * 60 + start.getMinutes();
    const durationMins = Math.max(30, (end - start) / 60000);
    const widthPct = 100 / totalCols;
    return {
      top:    `${startMins}px`,
      height: `${durationMins}px`,
      left:   `calc(${col * widthPct}% + 2px)`,
      width:  `calc(${widthPct}% - 4px)`,
    };
  }

  const hasAllDay = days.some(d => getAllDayForDay(d).length > 0);

  return (
    <div className="week-view">
      {/* Sticky day-of-week + date header */}
      <div className="week-day-header">
        <div className="week-gutter-spacer" />
        {days.map(day => {
          const isToday = isSameDay(day, today);
          return (
            <div key={day.toISOString()} className={`week-col-header${isToday ? ' today' : ''}`}>
              <span className="week-col-dow">{DAYS_OF_WEEK[day.getDay()]}</span>
              <span className={`week-col-date${isToday ? ' today-circle' : ''}`}>
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day strip — only rendered when all-day events exist */}
      {hasAllDay && (
        <div className="week-allday-row">
          <div className="week-gutter-spacer week-allday-label">all-day</div>
          {days.map(day => (
            <div key={day.toISOString()} className="week-allday-cell">
              {getAllDayForDay(day).map(ev => (
                <div key={ev.id} className="week-allday-event" title={ev.title}>
                  {ev.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div className="week-scroll" ref={scrollRef}>
        <div className="week-time-grid">
          {/* Hour labels */}
          <div className="week-hour-gutter">
            {HOURS.map(h => (
              <div key={h} className="week-hour-label" style={{ top: `${h * HOUR_HEIGHT}px` }}>
                {formatHour(h)}
              </div>
            ))}
          </div>

          {/* One column per day */}
          {days.map(day => {
            const isToday   = isSameDay(day, today);
            const dayEvents = getTimedForDay(day);
            const layouts   = computeLayouts(dayEvents);

            return (
              <div key={day.toISOString()} className={`week-day-col${isToday ? ' today' : ''}`}>
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="week-hour-line" style={{ top: `${h * HOUR_HEIGHT}px` }} />
                ))}
                {/* Half-hour lines */}
                {HOURS.map(h => (
                  <div key={`hh${h}`} className="week-half-line" style={{ top: `${h * HOUR_HEIGHT + 30}px` }} />
                ))}

                {/* Current-time indicator */}
                {isToday && (
                  <div className="week-now" style={{ top: `${nowMinutes}px` }} />
                )}

                {/* Timed events */}
                {dayEvents.map(ev => {
                  const { col, totalCols } = layouts.get(ev.id);
                  return (
                    <div
                      key={ev.id}
                      className="week-event"
                      style={eventStyle(ev, col, totalCols)}
                      title={ev.title}
                    >
                      <div className="week-event-title">{ev.title}</div>
                      <div className="week-event-time">
                        {formatTime(ev.start)} – {formatTime(ev.end)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────

function getEventsForDay(events, day) {
  const dayStr = toLocalDateString(day);
  return events.filter(ev => {
    if (ev.allDay) return ev.start <= dayStr && ev.end > dayStr;
    return isSameDay(new Date(ev.start), day);
  });
}

function MonthView({ gridDays, currentMonth, events, today }) {
  return (
    <>
      <div className="day-labels">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="day-label">{d}</div>
        ))}
      </div>
      <div className="calendar-grid month">
        {gridDays.map(day => {
          const dayEvents     = getEventsForDay(events, day);
          const isToday       = isSameDay(day, today);
          const isOutside     = day.getMonth() !== currentMonth;
          const visibleEvents = dayEvents.slice(0, 3);
          const overflow      = dayEvents.length - 3;

          return (
            <div
              key={day.toISOString()}
              className={[
                'calendar-cell',
                isToday  ? 'today'         : '',
                isOutside ? 'outside-month' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="cell-date">
                {isToday
                  ? <span className="today-circle">{day.getDate()}</span>
                  : <span>{day.getDate()}</span>}
              </div>
              <div className="cell-events">
                {visibleEvents.map(ev => (
                  <div
                    key={ev.id}
                    className={`event-chip${ev.allDay ? ' all-day' : ''}`}
                    title={ev.title}
                  >
                    {!ev.allDay && <span className="event-time">{formatTime(ev.start)}</span>}
                    <span className="event-title">{ev.title}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="overflow-count">+{overflow} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── CalendarView (root) ──────────────────────────────────────────────────────

export default function CalendarView() {
  const today = useMemo(() => startOfDay(new Date()), []);

  const [viewMode,    setViewMode]    = useState('month');
  const [anchorDate,  setAnchorDate]  = useState(() => startOfDay(new Date()));

  const { visibleStart, visibleEnd, gridDays, currentMonth } = useMemo(() => {
    if (viewMode === 'month') {
      const monthStart = getMonthStart(anchorDate);
      const gridStart  = getWeekStart(monthStart);
      const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
      return {
        visibleStart: gridStart,
        visibleEnd:   addDays(days[41], 1),
        gridDays:     days,
        currentMonth: monthStart.getMonth(),
      };
    }
    const weekStart = getWeekStart(anchorDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return {
      visibleStart: weekStart,
      visibleEnd:   addDays(weekStart, 7),
      gridDays:     days,
      currentMonth: null,
    };
  }, [viewMode, anchorDate]);

  const { events, loading, error } = useCalendar(visibleStart, visibleEnd);

  function navigate(dir) {
    setAnchorDate(prev => {
      if (viewMode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      }
      return addDays(prev, dir * 7);
    });
  }

  function goToday() {
    setAnchorDate(startOfDay(new Date()));
  }

  const periodLabel =
    viewMode === 'month'
      ? formatMonthLabel(getMonthStart(anchorDate))
      : formatWeekLabel(getWeekStart(anchorDate));

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <div className="calendar-controls">
          <button className="nav-btn" onClick={() => navigate(-1)}>&#8249;</button>
          <button className="today-btn" onClick={goToday}>Today</button>
          <button className="nav-btn" onClick={() => navigate(1)}>&#8250;</button>
        </div>
        <h2 className="period-label">{periodLabel}</h2>
        <div className="view-toggle">
          <button
            className={`toggle-btn${viewMode === 'month' ? ' active' : ''}`}
            onClick={() => setViewMode('month')}
          >Month</button>
          <button
            className={`toggle-btn${viewMode === 'week' ? ' active' : ''}`}
            onClick={() => setViewMode('week')}
          >Week</button>
        </div>
      </div>

      {error && (
        <div className={`calendar-error${error.type === 'auth' ? ' auth-error' : ''}`}>
          {error.message}
          {error.type === 'auth' && <a href="/login"> Log in</a>}
        </div>
      )}

      {loading ? (
        <div className="calendar-loading">Loading events…</div>
      ) : viewMode === 'month' ? (
        <MonthView
          gridDays={gridDays}
          currentMonth={currentMonth}
          events={events}
          today={today}
        />
      ) : (
        <WeekView
          days={gridDays}
          events={events}
          today={today}
        />
      )}
    </div>
  );
}
