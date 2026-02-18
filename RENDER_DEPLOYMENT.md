# Deploying to Render

This guide explains how to deploy your Dara Bot to Render with Google Cloud TTS credentials.

## Prerequisites

- Render account (free tier works)
- GitHub repository with your code
- Google Cloud service account JSON file

## Step 1: Prepare Your Credentials

You have the credentials file: `photoai-478919-1a91cfa646cd.json`

### Option A: Copy JSON Content (Recommended for Render)

1. Open `photoai-478919-1a91cfa646cd.json`
2. Copy the **entire JSON content** (all 14 lines)
3. You'll paste this into Render's environment variables

### Option B: Convert to Base64 (Alternative)

```bash
# On your local machine
cat photoai-478919-1a91cfa646cd.json | base64
```

Copy the base64 output (you won't need this method with the updated code).

## Step 2: Deploy to Render

### 2.1 Create New Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Select your `dara_bot` repository

### 2.2 Configure Build Settings

- **Name**: `dara-bot` (or any name you prefer)
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: Free (or paid if you need more resources)

### 2.3 Add Environment Variables

Click **"Environment"** tab and add these variables:

#### Required Variables:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

#### For TTS (Google Cloud Credentials):

**Option 1: JSON Content as String (Recommended)**

Add this environment variable. **Use your own service account JSON** — never commit real credentials to Git.

1. Open your service account JSON file (e.g. from Google Cloud Console → IAM → Service accounts → Create key).
2. Copy the **entire JSON** as a **single line** (remove line breaks, escape quotes as needed).
3. In Render, add:

```
GOOGLE_APPLICATION_CREDENTIALS_JSON=<paste your full JSON as one line here>
```

Example shape only (do not use this; it is not valid):
```
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"YOUR_PROJECT_ID","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com",...}
```

**Important**: 
- Paste the **entire JSON** as a single line (remove all line breaks)
- Make sure all quotes are properly escaped
- The value should be one continuous string

**Option 2: Using File Path (If Render supports file uploads)**

If Render allows file uploads in the future:
```
GOOGLE_APPLICATION_CREDENTIALS=/opt/render/project/src/photoai-478919-1a91cfa646cd.json
```

But for now, **Option 1 (JSON string) is recommended**.

### 2.4 Optional Variables

```
TELEGRAM_CHAT_ID=-1003606758795  # Optional: restrict to specific chat
PORT=3000  # Optional: default is 3000
```

## Step 3: Deploy

1. Click **"Create Web Service"**
2. Render will:
   - Clone your repository
   - Run `npm install`
   - Start your bot with `npm start`
3. Wait for deployment to complete (usually 2-5 minutes)

## Step 4: Verify Deployment

1. Check the **"Logs"** tab in Render dashboard
2. You should see:
   ```
   ✅ TTS: Gemini TTS initialized
   📁 Found credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON (temp file created)
   🚀 Server កំពុងដំណើរការនៅ port 3000
   🤖 Telegram bot សកម្ម!
   ```

3. Test your bot on Telegram - it should respond with voice messages when requested!

## Troubleshooting

### Bot not responding?
- Check Render logs for errors
- Verify all environment variables are set correctly
- Make sure `TELEGRAM_BOT_TOKEN` is correct

### TTS not working?
- Check if `GOOGLE_APPLICATION_CREDENTIALS_JSON` is set correctly
- Verify the JSON is valid (no line breaks, proper escaping)
- Check logs for TTS initialization messages

### Service crashes?
- Check Render logs
- Verify all required environment variables are set
- Make sure Node.js version is compatible (v14+)

## Security Notes

✅ **DO:**
- Use environment variables for secrets
- Keep credentials out of Git
- Rotate credentials if exposed

❌ **DON'T:**
- Commit credentials to Git
- Share credentials publicly
- Use the same credentials for multiple projects

## Render Free Tier Limitations

- Service may sleep after 15 minutes of inactivity
- Consider upgrading to paid plan for 24/7 uptime
- Or use a keep-alive service to ping your bot

Your bot is now deployed! 🎉

