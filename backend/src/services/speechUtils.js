const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function getOrdinal(n) {
  const v = n % 100;
  const suffixes = ['th', 'st', 'nd', 'rd'];
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n+/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

function normalizeVocalDate(isoString, timezone) {
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).formatToParts(date);

  const get = type => parts.find(p => p.type === type)?.value ?? '';
  const day = parseInt(get('day'));
  return `${get('weekday')}, ${get('month')} ${getOrdinal(day)} at ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}

function extractTime(isoString) {
  const match = isoString.match(/T(\d{2}):(\d{2})/);
  if (!match) return isoString;
  let h = parseInt(match[1]);
  const m = match[2];
  const period = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  else if (h === 0) h = 12;
  return m === '00' ? `${h} ${period}` : `${h}:${m} ${period}`;
}

function flattenOptionsToSpeech(optionsArray, type = 'slots', timezone = 'UTC') {
  if (!optionsArray || optionsArray.length === 0) {
    return "I couldn't find any options.";
  }

  const count = optionsArray.length;
  const countWord = NUMBER_WORDS[count] || String(count);
  const noun = type === 'slots'
    ? (count === 1 ? 'opening' : 'openings')
    : (count === 1 ? 'event' : 'events');

  const items = optionsArray.map((option, i) => {
    const num = NUMBER_WORDS[i + 1] || String(i + 1);
    const isLast = i === count - 1;
    const prefix = isLast && count > 1 ? 'And option' : 'Option';

    let detail;
    if (type === 'slots') {
      const rawTime = option.start_time || '';
      if (rawTime) {
        try {
          detail = normalizeVocalDate(rawTime, timezone);
        } catch (_) {
          detail = `at ${extractTime(rawTime)}`;
        }
      } else {
        detail = 'an unknown time';
      }
    } else {
      const title = option.summary || option.title || 'an event';
      // Support both {start:{dateTime:'...'}} (calendar API raw) and {start:'...'} (normalized) and {start_time:'...'}
      const rawTime = (typeof option.start === 'object' ? option.start?.dateTime : option.start) || option.start_time || '';
      if (rawTime) {
        try {
          detail = `${title} on ${normalizeVocalDate(rawTime, timezone)}`;
        } catch (_) {
          detail = `${title} at ${extractTime(rawTime)}`;
        }
      } else {
        detail = title;
      }
    }

    return `${prefix} ${num} is ${detail}.`;
  });

  const closing = count === 1 ? 'Would you like to go with that?' : 'Which one works?';
  return `I found ${countWord} ${noun}. ${items.join(' ')} ${closing}`;
}

module.exports = { stripMarkdown, normalizeVocalDate, flattenOptionsToSpeech };
