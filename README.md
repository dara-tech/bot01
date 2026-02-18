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
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Google Cloud service account JSON file (optional, for TTS and voice message transcription)
- `SPEECH_LANGUAGE` - Language code for voice message transcription (default: `km-KH` for Khmer). Use `en-US` for English.
- `MAX_VOICE_SIZE` - Max voice message size in bytes (default: 1048576 = 1MB)

## Text-to-Speech (TTS) Setup

The bot supports voice messages using Google Cloud Text-to-Speech. To enable it:

### Option 1: Using Environment Variable (Recommended)
1. Get your Google Cloud service account JSON key file from [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Place the file somewhere secure on your machine (NOT in the project directory)
3. Set the environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
   ```
   Or add to your `.env` file:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
   ```

### Option 2: Local File (Development Only)
1. Place your service account JSON file in the project root directory
2. The bot will automatically detect it (but it won't be committed to Git)

**Important Security Notes:**
- ✅ The credentials file should exist **locally** on the machine where the bot runs
- ❌ The credentials file should **NEVER** be committed to Git (it's in `.gitignore`)
- 🔄 If credentials were exposed, **rotate/regenerate** them immediately
- 🚀 For production, use environment variables or secure secret management

**Without credentials:** The bot will use a free TTS fallback (female voice only)

## Voice messages (Speech-to-Text)

The bot can **read** incoming voice messages: it transcribes them with Google Cloud Speech-to-Text (same credentials as TTS) and then replies as if the user had typed the transcribed text. Send a voice note in the chat and the bot will respond.

- Uses the same `GOOGLE_APPLICATION_CREDENTIALS` as TTS.
- Default is Khmer (`km-KH`); English is tried as alternative for mixed speech. Set `SPEECH_LANGUAGE=en-US` for English-only. If transcription fails, the user is asked to try again or type instead.
- Voice messages over 1MB are rejected (use `MAX_VOICE_SIZE` to change).

## DaraIDE – Code Agent IDE (macOS)

A native Swift/SwiftUI macOS app in the `DaraIDE/` folder that uses this server as a code agent: open a workspace, chat with the agent, and apply suggested edits. See [DaraIDE/README.md](DaraIDE/README.md) for setup and usage.

- **Backend:** `POST /api/agent` — body: `message`, `sessionId`, `workspaceRoot`, `currentFilePath`, `currentFileContent`, `selectedText`. Returns `{ response, actions }` where `actions` can be `edit` (path, oldText, newText) or `run` (command).

## Notes

- The bot uses polling mode by default (suitable for development)
- If `TELEGRAM_CHAT_ID` is set, the bot will only respond to messages in that specific chat/group
- For production, consider using webhooks instead
- Make sure to keep your API keys secure and never commit them to version control

## License

ISC

