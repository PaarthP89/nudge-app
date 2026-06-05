const { google } = require('googleapis');

function normalizeEvent(raw) {
  const isAllDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  return {
    id: raw.id,
    title: raw.summary || '(No title)',
    start: isAllDay ? raw.start.date : raw.start.dateTime,
    end: isAllDay ? raw.end.date : raw.end.dateTime,
    allDay: isAllDay,
    location: raw.location || null,
    description: raw.description || null,
    colorId: raw.colorId || null,
    attendees: (raw.attendees || []).map(a => ({
      email: a.email,
      displayName: a.displayName || null,
      self: Boolean(a.self)
    })),
    status: raw.status || null,
    recurringEventId: raw.recurringEventId || null
  };
}

class GoogleCalendarService {
  constructor(accessToken, refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    this.calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  }

  async listEvents(startDate, endDate) {
    const response = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    });
    return (response.data.items || []).map(normalizeEvent);
  }

  async createEvent(intent) {
    const startTime = intent.start_time;
    let endTime = intent.end_time;
    if (!endTime && intent.duration_minutes) {
      endTime = new Date(
        new Date(startTime).getTime() + intent.duration_minutes * 60 * 1000
      ).toISOString();
    }
    if (!endTime) {
      endTime = new Date(new Date(startTime).getTime() + 3600 * 1000).toISOString();
    }

    const resource = {
      summary: intent.title || 'New Event',
      start: { dateTime: startTime },
      end: { dateTime: endTime }
    };
    if (intent.location) resource.location = intent.location;
    const emailAttendees = (intent.attendees || []).filter(a => a.includes('@'));
    if (emailAttendees.length > 0) {
      resource.attendees = emailAttendees.map(email => ({ email }));
    }

    const response = await this.calendar.events.insert({
      calendarId: 'primary',
      resource,
      sendUpdates: 'none'
    });
    return normalizeEvent(response.data);
  }

  async updateEvent(eventId, patches) {
    const response = await this.calendar.events.patch({
      calendarId: 'primary',
      eventId,
      resource: patches,
      sendUpdates: 'all'
    });
    return normalizeEvent(response.data);
  }

  async deleteEvent(eventId) {
    await this.calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });
  }

  async getEvent(eventId) {
    const response = await this.calendar.events.get({
      calendarId: 'primary',
      eventId,
    });
    return normalizeEvent(response.data);
  }

  async getFreeBusy(startDate, endDate) {
    throw new Error('not implemented');
  }
}

function detectConflicts(events, intent) {
  if (!intent.start_time || intent.action !== 'create') return [];

  const intentStart = new Date(intent.start_time).getTime();
  const intentEnd = intent.end_time
    ? new Date(intent.end_time).getTime()
    : intentStart + (intent.duration_minutes ?? 60) * 60 * 1000;

  return events.filter(event => {
    if (event.allDay) return false;
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();
    return eventStart < intentEnd && eventEnd > intentStart;
  });
}

module.exports = GoogleCalendarService;
module.exports.normalizeEvent = normalizeEvent;
module.exports.detectConflicts = detectConflicts;
