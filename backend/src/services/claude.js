const Anthropic = require('@anthropic-ai/sdk');

class ClaudeService {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async parseIntent(userInput, calendarContext) {
    throw new Error('not implemented');
  }

  async generateResponse(intent, conflicts) {
    throw new Error('not implemented');
  }

  async suggestSlots(constraints, existingEvents) {
    throw new Error('not implemented');
  }

  async chat(messages, systemContext) {
    throw new Error('not implemented');
  }
}

module.exports = ClaudeService;
