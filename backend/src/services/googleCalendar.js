class GoogleCalendarService {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  async listEvents(startDate, endDate) {
    throw new Error('not implemented');
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
