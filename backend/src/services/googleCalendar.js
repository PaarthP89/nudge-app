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

  async createEvent(eventData) {
    throw new Error('not implemented');
  }

  async updateEvent(eventId, updates) {
    throw new Error('not implemented');
  }

  async deleteEvent(eventId) {
    throw new Error('not implemented');
  }

  async getFreeBusy(startDate, endDate) {
    throw new Error('not implemented');
  }
}

module.exports = GoogleCalendarService;
module.exports.normalizeEvent = normalizeEvent;
