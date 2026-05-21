class GmailService {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  async sendInvite(to, subject, body, eventDetails) {
    throw new Error('not implemented');
  }
}

module.exports = GmailService;
