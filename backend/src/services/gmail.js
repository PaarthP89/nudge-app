const { google } = require('googleapis');

class GmailService {
  constructor(accessToken, refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async sendInvite(to, eventDetails) {
    const { title, start, end, location } = eventDetails;

    const startDate = new Date(start);
    const endDate = new Date(end);
    const dateStr = startDate.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    const endStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Google Calendar quick-add URL — recipient clicks to add to their own calendar.
    const gcalDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const gcalParams = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${gcalDate(startDate)}/${gcalDate(endDate)}`,
      ...(location ? { location } : {}),
    });
    const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

    const subject = `Invitation: ${title}`;
    const html = [
      '<div style="font-family:sans-serif;max-width:600px;padding:20px">',
      `<h2 style="color:#1d4ed8;margin:0 0 16px">${title}</h2>`,
      `<p><strong>When:</strong> ${dateStr} – ${endStr}</p>`,
      location ? `<p><strong>Where:</strong> ${location}</p>` : '',
      '<p style="margin-top:24px">',
      `<a href="${gcalUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Add to Google Calendar</a>`,
      '</p>',
      '<p style="color:#6b7280;font-size:13px;margin-top:20px">Sent via Nudge, your AI scheduling assistant.</p>',
      '</div>'
    ].join('');

    const rawEmail = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html
    ].join('\r\n');

    const encoded = Buffer.from(rawEmail).toString('base64url');

    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded }
    });
  }
}

module.exports = GmailService;
