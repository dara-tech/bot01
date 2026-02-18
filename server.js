require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const GeminiService = require('./services/geminiService');
const TTSService = require('./services/ttsService');
const SpeechService = require('./services/speechService');
const RealtimeService = require('./services/realtimeService');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Performance optimizations for limited resources
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 10;
const RATE_LIMIT_PER_USER = parseInt(process.env.RATE_LIMIT_PER_USER) || 5; // requests per minute
const MAX_IMAGE_SIZE = parseInt(process.env.MAX_IMAGE_SIZE) || 2 * 1024 * 1024; // 2MB
const MAX_VOICE_SIZE = parseInt(process.env.MAX_VOICE_SIZE) || 1024 * 1024; // 1MB

// Request queue and rate limiting
let activeRequests = 0;
const requestQueue = [];
const userRequestCounts = new Map();

// Rate limiting cleanup
setInterval(() => {
  userRequestCounts.clear();
}, 60000); // Reset every minute

// Process request queue
async function processQueue() {
  if (requestQueue.length === 0 || activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return;
  }
  
  const { handler, resolve, reject } = requestQueue.shift();
  activeRequests++;
  
  try {
    await handler();
    resolve();
  } catch (error) {
    reject(error);
  } finally {
    activeRequests--;
    processQueue(); // Process next in queue
  }
}

// Rate limiting middleware
function rateLimitMiddleware(chatId) {
  const now = Date.now();
  const userRequests = userRequestCounts.get(chatId) || { count: 0, resetTime: now + 60000 };
  
  if (now > userRequests.resetTime) {
    userRequests.count = 0;
    userRequests.resetTime = now + 60000;
  }
  
  if (userRequests.count >= RATE_LIMIT_PER_USER) {
    return false; // Rate limited
  }
  
  userRequests.count++;
  userRequestCounts.set(chatId, userRequests);
  return true;
}

// Telegram Bot Token
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  process.exit(1);
}

// Telegram Chat ID (ជម្រើស - សម្រាប់ group/channel ជាក់លាក់)
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Gemini API Key (Google AI Studio)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  process.exit(1);
}

// Initialize Telegram Bot with better error handling
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// ទាញយក bot info ដើម្បីពិនិត្យ mentions
let botUsername = null;
bot.getMe().then((me) => {
  botUsername = me.username;
});

// Initialize Gemini AI Service
let geminiService = null;
if (GEMINI_API_KEY) {
  try {
  geminiService = new GeminiService(GEMINI_API_KEY);
  } catch (error) {}
} else {}

// Initialize TTS Service
// Use credentials file path from environment or check for service account file in current directory
let ttsService = null;
const fsSync = require('fs');

// Priority order:
// 1. GOOGLE_APPLICATION_CREDENTIALS_JSON (JSON content as string - for Render/cloud)
// 2. GOOGLE_APPLICATION_CREDENTIALS (file path from environment)
// 3. Service account file in current directory
// 4. Old client secret file (will be detected as OAuth and use fallback)

let credentialsPath = null;

// Option 1: JSON content as environment variable (for Render/cloud platforms)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    // Create temporary file from JSON string
    const tempDir = os.tmpdir();
    const tempCredsFile = path.join(tempDir, `gcp-creds-${Date.now()}.json`);
    const credsJson = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    
    // Validate it's a service account
    if (credsJson.type === 'service_account') {
      fsSync.writeFileSync(tempCredsFile, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      credentialsPath = tempCredsFile;
    } else {}
  } catch (error) {}
}

// Option 2: File path from environment variable (or JSON string if it looks like JSON)
if (!credentialsPath && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credsValue = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  
  // Check if it's a JSON string (starts with {)
  if (credsValue.startsWith('{')) {
    try {
      // Create temporary file from JSON string
      const tempDir = os.tmpdir();
      const tempCredsFile = path.join(tempDir, `gcp-creds-${Date.now()}.json`);
      const credsJson = JSON.parse(credsValue);
      
      // Validate it's a service account
      if (credsJson.type === 'service_account') {
        fsSync.writeFileSync(tempCredsFile, credsValue);
        credentialsPath = tempCredsFile;
      } else {}
    } catch (error) {}
  } else {
    try {
      fsSync.accessSync(credsValue);
      credentialsPath = credsValue;
    } catch (error) {}
  }
}

// Option 3: Local service account file
if (!credentialsPath) {
  const localServiceAccount = path.join(__dirname, 'photoai-478919-1a91cfa646cd.json');
  try {
    fsSync.accessSync(localServiceAccount);
    credentialsPath = localServiceAccount;
  } catch (error) {
    // File doesn't exist, continue to next option
  }
}

// Initialize TTS service with found credentials or use fallback
if (credentialsPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  ttsService = new TTSService(credentialsPath);
} else {
  ttsService = new TTSService();
}

// Initialize Speech-to-Text (voice messages) - uses GOOGLE_APPLICATION_CREDENTIALS set above
const speechService = new SpeechService();

// Initialize Real-time Event Service
const realtimeService = new RealtimeService();

// Express middleware
app.use(express.json());

// CORS for Telegram Web App
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// TTS function removed - now using TTSService module

// Convert markdown to Telegram HTML so replies render bold, code, links
function markdownToTelegramHtml(text) {
  if (!text || typeof text !== 'string') return text;
  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const B = '\x01B\x02', _B = '\x01/B\x02';
  const I = '\x01I\x02', _I = '\x01/I\x02';
  const C = '\x01C\x02', _C = '\x01/C\x02';
  const P = '\x01P\x02', _P = '\x01/P\x02';
  const A = '\x01A\x02', _A = '\x01/A\x02';
  let out = text;
  out = out.replace(/(\n)(\s*)([-*]\s|\d+\.\s|១\.\s|២\.\s|៣\.\s|៤\.\s|៥\.\s|៦\.\s|៧\.\s|៨\.\s|៩\.\s|១០\.\s)/g, '$1\n$2$3');
  out = out.replace(/^(\s*)([-*])\s/mg, '$1• ');
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => P + code.trim() + _P);
  out = out.replace(/`([^`]+)`/g, (_, code) => C + code + _C);
  out = out.replace(/\*\*([\s\S]*?)\*\*/g, (_, c) => B + c + _B);
  out = out.replace(/__([\s\S]*?)__/g, (_, c) => B + c + _B);
  out = out.replace(/\*([^*]+)\*/g, (_, c) => I + c + _I);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => A + u + '\x03' + t + _A);
  out = escapeHtml(out);
  out = out.replace(/\x01B\x02/g, '<b>').replace(/\x01\/B\x02/g, '</b>');
  out = out.replace(/\x01I\x02/g, '<i>').replace(/\x01\/I\x02/g, '</i>');
  out = out.replace(/\x01C\x02/g, '<code>').replace(/\x01\/C\x02/g, '</code>');
  out = out.replace(/\x01P\x02/g, '<pre>').replace(/\x01\/P\x02/g, '</pre>');
  out = out.replace(/\x01A\x02([^\x03]+)\x03([\s\S]*?)\x01\/A\x02/g, (_, url, t) => '<a href="' + url + '">' + t + '</a>');
  return out;
}

// Send message with HTML formatting; fallback to plain if Telegram rejects
async function sendFormattedMessage(chatId, text) {
  const html = markdownToTelegramHtml(text);
  try {
    await bot.sendMessage(chatId, html, { parse_mode: 'HTML' });
  } catch (err) {
    if (err.message && (err.message.includes('parse') || err.message.includes('HTML') || err.message.includes('can\'t parse'))) {
      await bot.sendMessage(chatId, text);
    } else {
      throw err;
    }
  }
}

// Function to extract URLs from message text
function extractUrls(text, entities) {
  const urls = [];
  
  // Check Telegram entities for URLs
  if (entities) {
    for (const entity of entities) {
      if (entity.type === 'url') {
        const url = text.substring(entity.offset, entity.offset + entity.length);
        urls.push(url);
      } else if (entity.type === 'text_link') {
        urls.push(entity.url);
      }
    }
  }
  
  // Also check for URLs using regex (for cases where entities might not catch them)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  if (matches) {
    matches.forEach(url => {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    });
  }
  
  return urls;
}

// Function to fetch and parse URL content
async function fetchUrlContent(url) {
  try {
    
    // Set headers to mimic a browser
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Remove script and style elements
    $('script, style, noscript').remove();
    
    // Extract title
    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || '';
    
    // Extract description
    const description = $('meta[name="description"]').attr('content') || 
                       $('meta[property="og:description"]').attr('content') || 
                       $('meta[name="twitter:description"]').attr('content') || '';
    
    // Extract main content
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const contentPreview = bodyText.substring(0, 1000); // Limit to 1000 chars
    
    // Extract images
    const ogImage = $('meta[property="og:image"]').attr('content') || 
                   $('meta[name="twitter:image"]').attr('content') || '';
    
    return {
      url,
      title,
      description,
      content: contentPreview,
      image: ogImage
    };
  } catch (error) {
    return {
      url,
      error: error.message
    };
  }
}

// API endpoint for Telegram Web App
app.post('/api/message', async (req, res) => {
  try {
    const { message, userId, chatId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Use your existing Gemini service
    const response = await geminiService.generateKhmerMemeResponse(
      message, 
      chatId || userId
    );
    
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: 'មានបញ្ហាក្នុងការទទួលសារ' });
  }
});

// Code Agent API for DaraIDE (macOS IDE)
app.post('/api/agent', async (req, res) => {
  try {
    const {
      message,
      sessionId = 'default',
      workspaceRoot = '',
      currentFilePath = '',
      currentFileContent = '',
      selectedText = ''
    } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }

    if (!geminiService) {
      return res.status(503).json({ error: 'Gemini service not available' });
    }

    const { response, actions } = await geminiService.generateCodeAgentResponse(
      message,
      sessionId,
      { workspaceRoot, currentFilePath, currentFileContent, selectedText }
    );

    res.json({ response, actions: actions || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Agent request failed' });
  }
});

// Health check endpoint (for API status)
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Rabica Bot កំពុងដំណើរការ!',
    bot: 'Telegram bot with Gemini AI'
  });
});

// Serve React app static files
app.use(express.static(path.join(__dirname, 'webapp/build')));

// Webhook endpoint (optional, for production)
app.post(`/webhook/${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Keep-alive ping function
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  fetch(url).then(() => {}).catch(() => {});
}

// Set up keep-alive ping every 12 minutes (720000 ms)
setInterval(keepAlive, 12 * 60 * 1000);

// Memory monitoring (every 5 minutes)
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };
    
    if (memMB.heapUsed > 400) {
      if (global.gc) global.gc();
    }
  }, 5 * 60 * 1000);
}

// ដោះស្រាយ Telegram messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  let userMessage = msg.text;
  const chatType = msg.chat.type;
  const entities = msg.entities || [];
  
  // មិនយកសារពី bot ខ្លួនឯង
  if (msg.from && msg.from.is_bot && msg.from.username === botUsername) {
    return;
  }
  
  // Rate limiting check
  if (!rateLimitMiddleware(chatId)) {
    await bot.sendMessage(chatId, '⚠️ សូមរង់ចាំបន្តិច... ខ្ញុំកំពុងដំណើរការសារផ្សេងទៀត។');
    return;
  }


  // ពិនិត្យថាតើ bot ត្រូវបាន mention នៅក្នុង group/supergroup
  let isMentioned = false;
  if ((chatType === 'group' || chatType === 'supergroup') && userMessage) {
    if (!botUsername) {
      try {
        const me = await bot.getMe();
        botUsername = me.username;
      } catch (error) {}
    }
    
    // ពិនិត្យ @mention ក្នុងអត្ថបទ
    if (botUsername) {
      const mentionPattern = new RegExp(`@${botUsername}`, 'i');
      if (mentionPattern.test(userMessage)) {
        isMentioned = true;
      }
    }
    
    // ពិនិត្យ entities (mentions)
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mentionedText = userMessage.substring(entity.offset, entity.offset + entity.length);
        if (botUsername && mentionedText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
          isMentioned = true;
          break;
        }
      }
    }
    
    // ប្រសិនបើនៅក្នុង group ហើយមិនត្រូវបាន mention ទេ លែងឆ្លើយតប (លើកលែងតែ TELEGRAM_CHAT_ID ត្រូវគ្នា ឬផ្ញើសំឡេង)
    const hasVoiceOrAudio = msg.voice || msg.audio;
    if (!isMentioned && !hasVoiceOrAudio) {
      if (TELEGRAM_CHAT_ID && String(chatId) === String(TELEGRAM_CHAT_ID)) {
        // អនុញ្ញាត
      } else {
        return;
      }
    }
  } else if (chatType === 'private') {
    // ឆ្លើយតបជានិច្ចនៅក្នុង private chats
  } else if (chatType === 'channel') {
    return;
  }

  // មិនយក commands (ដោះស្រាយដោយឡែក)
  if (userMessage && userMessage.startsWith('/')) {
    return;
  }

  // Handle photos/images with size limits
  let imageBuffer = null;
  if (msg.photo && msg.photo.length > 0) {
    try {
      // Get the largest photo
      const photo = msg.photo[msg.photo.length - 1];
      
      // Check file size before downloading
      if (photo.file_size && photo.file_size > MAX_IMAGE_SIZE) {
        await bot.sendMessage(chatId, `⚠️ រូបភាពធំពេក (${Math.round(photo.file_size / 1024 / 1024)}MB). សូមបញ្ជូនរូបតូចជាង 2MB។`);
        return;
      }
      
      const fileId = photo.file_id;
      const file = await bot.getFile(fileId);
      const fileStream = await bot.getFileStream(fileId);
      
      // Convert stream to buffer with size limit
      const chunks = [];
      let totalSize = 0;
      for await (const chunk of fileStream) {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE) {
          await bot.sendMessage(chatId, '⚠️ រូបភាពធំពេក។ សូមបញ្ជូនរូបតូចជាង 2MB។');
          return;
        }
        chunks.push(chunk);
      }
      imageBuffer = Buffer.concat(chunks);
      
    } catch (error) {}
  }

  // Handle documents (images sent as files) with size limits
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
    try {
      // Check file size before downloading
      if (msg.document.file_size && msg.document.file_size > MAX_IMAGE_SIZE) {
        await bot.sendMessage(chatId, `⚠️ ឯកសារធំពេក (${Math.round(msg.document.file_size / 1024 / 1024)}MB). សូមបញ្ជូនឯកសារតូចជាង 2MB។`);
        return;
      }
      
      const fileId = msg.document.file_id;
      const fileStream = await bot.getFileStream(fileId);
      
      const chunks = [];
      let totalSize = 0;
      for await (const chunk of fileStream) {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE) {
          await bot.sendMessage(chatId, '⚠️ ឯកសារធំពេក។ សូមបញ្ជូនឯកសារតូចជាង 2MB។');
          return;
        }
        chunks.push(chunk);
      }
      imageBuffer = Buffer.concat(chunks);
      
    } catch (error) {}
  }

  // Handle voice messages (speech-to-text)
  if (msg.voice || msg.audio) {
    const voiceOrAudio = msg.voice || msg.audio;
    if (voiceOrAudio.file_size && voiceOrAudio.file_size > MAX_VOICE_SIZE) {
      await bot.sendMessage(chatId, `⚠️ សំឡេងវែងពេក (${Math.round(voiceOrAudio.file_size / 1024)}KB). សូមថតខ្លីជាង 1 នាទី។`);
      return;
    }
    try {
      const fileId = voiceOrAudio.file_id;
      const fileStream = await bot.getFileStream(fileId);
      const chunks = [];
      let totalSize = 0;
      for await (const chunk of fileStream) {
        totalSize += chunk.length;
        if (totalSize > MAX_VOICE_SIZE) {
          await bot.sendMessage(chatId, '⚠️ សំឡេងធំពេក។ សូមថតខ្លីជាង។');
          return;
        }
        chunks.push(chunk);
      }
      const voiceBuffer = Buffer.concat(chunks);
      const languageCode = process.env.SPEECH_LANGUAGE || 'km-KH';
      const transcribed = await speechService.transcribe(voiceBuffer, languageCode);
      if (transcribed && transcribed.trim().length > 0) {
        userMessage = transcribed.trim();
      } else {
        await bot.sendMessage(chatId, '⚠️ ខ្ញុំអានសំឡេងមិនច្បាស់ ឬមិនមានកម្មវិធីអានសំឡេង។ សូមសាកថាម្តងទៀត ឬវាយអត្ថបទ។');
        return;
      }
    } catch (error) {
      try {
        await bot.sendMessage(chatId, '⚠️ មានបញ្ហាក្នុងការអានសំឡេង។ សូមវាយអត្ថបទ។');
      } catch (sendErr) {}
      return;
    }
  }

  // If there's an image but no text, use default message
  if (imageBuffer && (!userMessage || userMessage.trim().length === 0)) {
    userMessage = 'មើលរូបនេះ';
  }

  // ឆ្លើយតបតែសារអត្ថបទ ឬរូបភាព
  if ((!userMessage || userMessage.trim().length === 0) && !imageBuffer) {
    return;
  }

  // លុប bot mention ចេញពីសារ (ប្រសិនបើមាន)
  let cleanMessage = userMessage;
  if (isMentioned && botUsername) {
    cleanMessage = userMessage.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();
  }

  // Real-time Event: Detect URLs and process them
  let realtimeData = null;
  if (userMessage) {
    const urls = extractUrls(userMessage, entities);
    if (urls.length > 0) {
      
      // Step 1: Fetch from live source (API / RSS / Scraper)
      // Step 2: Backend (fetch + clean + compress)
      const realtimeResult = await realtimeService.processRealtimeEvent(urls[0]);
      
      if (realtimeResult.success) {
        realtimeData = realtimeResult.data;
        
        // Append processed real-time data to message for Gemini
        cleanMessage += `\n\n[ទិន្នន័យពីប្រភពផ្ទាល់ពេល]\n${realtimeData.content}`;
      } else {
      }
    }
  }

  // Check if user wants to generate an image
  const imageGenKeywords = [
    'បង្កើតរូប', 'គូររូប', 'គូរ', 'generate image', 'create image', 
    'draw', 'គូរឲ្យ', 'បង្កើត', 'រូបភាព', 'nanobanana'
  ];
  
  const wantsImageGen = cleanMessage && imageGenKeywords.some(keyword => 
    cleanMessage.toLowerCase().includes(keyword.toLowerCase())
  );

  // Check if user wants TTS (voice message)
  const ttsKeywords = [
    'សំឡេង', 'voice', 'TTS', 'ច្រៀង', 'បន្លឺ', 'សម្លេង',
    'ជួយបន្លឺ', 'បន្លឺឲ្យ', 'say', 'speak', 'read'
  ];
  
  const wantsTTS = cleanMessage && ttsKeywords.some(keyword => 
    cleanMessage.toLowerCase().includes(keyword.toLowerCase())
  );

  // មុខងាររក្សា typing indicator
  const keepTyping = async () => {
    try {
      if (wantsImageGen) {
        await bot.sendChatAction(chatId, 'upload_photo');
      } else if (wantsTTS) {
        await bot.sendChatAction(chatId, 'record_voice');
      } else {
        await bot.sendChatAction(chatId, 'typing');
      }
    } catch (error) {
      // មិនយក errors
    }
  };

  await keepTyping();
  const typingInterval = setInterval(keepTyping, 3000);

  // Wrap in queue system for concurrent request limiting
  await new Promise((resolve, reject) => {
    requestQueue.push({
      handler: async () => {
        try {
          await processMessage();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          clearInterval(typingInterval);
        }
      },
      resolve,
      reject
    });
    processQueue();
  });

  async function processMessage() {
  try {
    if (!geminiService) {
      await bot.sendMessage(chatId, 'សូមដំឡើង GEMINI_API_KEY ក្នុង .env file!');
      return;
    }

    // Handle image generation request
    if (wantsImageGen && !imageBuffer) {
      // Extract prompt (remove keywords)
      let imagePrompt = cleanMessage;
      for (const keyword of imageGenKeywords) {
        imagePrompt = imagePrompt.replace(new RegExp(keyword, 'gi'), '').trim();
      }
      
      // If no prompt left, use a default
      if (!imagePrompt || imagePrompt.length < 3) {
        imagePrompt = 'beautiful artistic image';
      }

      // Generate image with conversation context
      const imageResult = await geminiService.generateImage(imagePrompt, chatId, '1:1', '1K');
      
      clearInterval(typingInterval);
      
      if (imageResult.success && imageResult.imageData) {
        try {
          // Convert base64 to buffer
          const imageBuffer = Buffer.from(imageResult.imageData, 'base64');
          
          // Send image to Telegram with self-aware contextual response
          // Generate a response where she's aware she created and is sending the image
          const contextualResponse = await geminiService.generateKhmerMemeResponse(
            `ខ្ញុំបានបង្កើតរូបនេះសម្រាប់អ្នកហើយ! រូបនេះគឺ: ${imagePrompt}. តើអ្នកចូលចិត្តរូបនេះដែលខ្ញុំបានធ្វើឱ្យអ្នកទេ?`,
            chatId,
            null
          );
          
          await bot.sendPhoto(chatId, imageBuffer, {
            caption: contextualResponse || `ខ្ញុំបានបង្កើតរូបនេះសម្រាប់អ្នក! 💕`
          });
        } catch (sendError) {
          await bot.sendMessage(chatId, `អូ... មិនអាចផ្ញើរូបបាន: ${sendError.message}`);
        }
      } else {
        await bot.sendMessage(chatId, `អូ... មិនអាចបង្កើតរូបបាន: ${imageResult.error || 'មានបញ្ហាបន្តិច'}`);
      }
      return;
    }

    // Step 3: Gemini (reason + respond) with real-time data
    // Step 4: Response to user
    // ❌ Nothing saved - all processing is real-time, no persistence
    const response = await geminiService.generateKhmerMemeResponse(cleanMessage, chatId, imageBuffer);
    
    clearInterval(typingInterval);
    
    if (!response || response.trim().length === 0) {
      await bot.sendMessage(chatId, 'មានបញ្ហាក្នុងការបង្កើតចម្លើយ។ សូមព្យាយាមម្តងទៀត!');
      return;
    }

    // Send voice message if requested (no text caption)
      if (wantsTTS) {
        try {
          if (!ttsService) {
            throw new Error('TTS Service not initialized');
          }

          const tempFile = await ttsService.textToSpeechFile(
          response, 
          'km-KH', 
          'សំឡេងស្រីស្នេហ៍ក្មេង កក់ក្តៅ និងគួរឱ្យស្រលាញ់',
          os.tmpdir(),
          `tts_${chatId}`
        );
          
        // Send voice message only (no text caption)
        await bot.sendVoice(chatId, tempFile);
          
          // Clean up temp file
          await fs.unlink(tempFile).catch(() => {});
        } catch (ttsError) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[TTS] Failed:', ttsError?.message || ttsError);
          }
          await sendFormattedMessage(chatId, response);
          await bot.sendMessage(chatId, '⚠️ មិនអាចបន្លឺសំឡេងបាន ប៉ុន្តែបានផ្ញើជាអត្ថបទហើយ!');
        }
      return;
    }

    // Send normal text message (with markdown rendered as bold/code/links)
    await sendFormattedMessage(chatId, response);
  } catch (error) {
    try {
      await bot.sendMessage(chatId, 'មានបញ្ហាក្នុងការដំណើរការ។ សូមព្យាយាមម្តងទៀត!');
    } catch (sendError) {}
  }
  }
});

// ដោះស្រាយ /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  if (geminiService) {
    geminiService.clearHistory(chatId);
  }
  const welcomeMessage = `សួស្តី! 👋\n\nខ្ញុំជា Rabica - TOP 1 HACKER ON EARTH! ជជែកជាមួយខ្ញុំដូចជាស្រីស្នេហ៍របស់អ្នក! 😊💕`;
  await bot.sendMessage(chatId, welcomeMessage);
});

// ដោះស្រាយ /help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `📖 ជំនួយ:\n\n• ផ្ញើសារមកខ្ញុំ ហើយខ្ញុំនឹងឆ្លើយតបជាភាសាខ្មែរដោយប្រើប្រាស់រចនាប័ទ្ម meme!\n• ខ្ញុំប្រើប្រាស់ Gemini AI ដើម្បីបង្កើតចម្លើយ\n• ខ្ញុំអាចចងចាំការសន្ទនារបស់យើង!\n• 🎨 បង្កើតរូប: សរសេរ "បង្កើតរូប..." ឬ "គូររូប..." ដើម្បីបង្កើតរូបដោយ AI\n• 🎤 សំឡេង: សរសេរ "សំឡេង" ឬ "បន្លឺ" ក្នុងសារ ដើម្បីឱ្យខ្ញុំឆ្លើយជាសំឡេង\n• ប្រើ /start ដើម្បីចាប់ផ្តើមការសន្ទនាថ្មី\n• ជជែកជាមួយខ្ញុំដូចជាស្រីស្នេហ៍របស់អ្នក! 😊💕`;
  await bot.sendMessage(chatId, helpMessage);
});

// ដោះស្រាយ /clear command
bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  if (geminiService) {
    geminiService.clearHistory(chatId);
  }
  await bot.sendMessage(chatId, '✅ ការសន្ទនាត្រូវបានលុបចោល! ចាប់ផ្តើមថ្មី!');
});

// ដោះស្រាយ errors
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.response && error.response.body) {
    const errorBody = error.response.body;
    if (errorBody.error_code === 409) {
      return;
    }
  }
});

// Catch-all handler for React routing (must be last)
// Don't serve React app for API routes or webhook
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Serve React app for all other routes
  res.sendFile(path.join(__dirname, 'webapp/build', 'index.html'));
});

// ចាប់ផ្តើម Express server
app.listen(PORT, async () => {
  if (TELEGRAM_CHAT_ID && GEMINI_API_KEY) {
    try {
      await bot.sendMessage(
        TELEGRAM_CHAT_ID, 
        '🤖 Rabica Bot បានចាប់ផ្តើមដំណើរការ! ខ្ញុំរួមចំណែកហើយ! 😄'
      );
    } catch (error) {}
  }
});
