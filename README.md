# Dara Bot - Telegram Bot with Gemini AI

A Telegram bot that uses Google's Gemini AI to generate Khmer (Cambodian) meme-style text responses.

## Features

- 🤖 Telegram bot integration
- 🧠 Powered by Google Gemini AI
- 🇰🇭 Responds in Khmer language
- 😄 Meme-style, human-like conversations
- 🚀 Built with Express.js

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Telegram Bot Token (already provided)
- Google Gemini API Key

## Setup

1. **Clone or navigate to the project directory**
   ```bash
   cd dara_bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Get your Gemini API Key**
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the API key

4. **Create .env file**
   ```bash
   cp .env.example .env
   ```

5. **Edit .env file**
   - Add your Gemini API key:
     ```
     GEMINI_API_KEY=your_actual_api_key_here
     ```
   - Add your Telegram chat ID (optional - restricts bot to specific chat/group):
     ```
     TELEGRAM_CHAT_ID=-1003606758795
     ```
   - The Telegram bot token is already set, but you can change it if needed

## Running the Bot

### Development mode (with auto-reload)
```bash
npm run dev
```

### Production mode
```bash
npm start
```

The bot will start and begin listening for messages on Telegram!

## Usage

1. Open Telegram and search for your bot (using the bot token's associated username)
2. Send `/start` to begin
3. Send any message and the bot will respond in Khmer with a meme-style, human-like response!

## Commands

- `/start` - Start the bot and see welcome message
- `/help` - Get help information

## Project Structure

```
dara_bot/
├── server.js          # Main server and bot logic
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variables template
├── .gitignore        # Git ignore file
└── README.md         # This file
```

## Environment Variables

- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token (required)
- `GEMINI_API_KEY` - Your Google Gemini API key (required)
- `TELEGRAM_CHAT_ID` - Optional chat/group ID to restrict bot responses to a specific chat
- `PORT` - Server port (defaults to 3000)

## Notes

- The bot uses polling mode by default (suitable for development)
- If `TELEGRAM_CHAT_ID` is set, the bot will only respond to messages in that specific chat/group
- For production, consider using webhooks instead
- Make sure to keep your API keys secure and never commit them to version control

## License

ISC

