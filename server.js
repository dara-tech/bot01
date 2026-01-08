require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const GeminiService = require('./services/geminiService');
const TTSService = require('./services/ttsService');
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
  console.error('❌ ត្រូវការ TELEGRAM_BOT_TOKEN ក្នុង .env file!');
  process.exit(1);
}

// Telegram Chat ID (ជម្រើស - សម្រាប់ group/channel ជាក់លាក់)
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Gemini API Key (Google AI Studio)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ ត្រូវការ GEMINI_API_KEY ក្នុង .env file!');
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
  console.log(`🤖 Bot username: @${botUsername}`);
});

// Initialize Gemini AI Service
let geminiService = null;
if (GEMINI_API_KEY) {
  try {
  geminiService = new GeminiService(GEMINI_API_KEY);
    console.log('✅ Gemini AI Service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Gemini AI Service:', error.message);
  }
} else {
  console.warn('⚠️  GEMINI_API_KEY not found - Gemini AI features will not work');
}

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
      console.log(`📁 Found credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON (temp file created)`);
    } else {
      console.warn(`⚠️  GOOGLE_APPLICATION_CREDENTIALS_JSON is not a service account`);
    }
  } catch (error) {
    console.warn(`⚠️  Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${error.message}`);
  }
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
        console.log(`📁 Found credentials from GOOGLE_APPLICATION_CREDENTIALS (JSON string, temp file created)`);
      } else {
        console.warn(`⚠️  GOOGLE_APPLICATION_CREDENTIALS JSON is not a service account`);
  }
    } catch (error) {
      console.warn(`⚠️  Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON: ${error.message}`);
    }
  } else {
    // It's a file path
    try {
      fsSync.accessSync(credsValue);
      credentialsPath = credsValue;
      console.log(`📁 Found credentials from environment: ${credentialsPath}`);
    } catch (error) {
      console.warn(`⚠️  GOOGLE_APPLICATION_CREDENTIALS path not accessible: ${credsValue}`);
    }
  }
}

// Option 3: Local service account file
if (!credentialsPath) {
  const localServiceAccount = path.join(__dirname, 'photoai-478919-1a91cfa646cd.json');
  try {
    fsSync.accessSync(localServiceAccount);
    credentialsPath = localServiceAccount;
    console.log(`📁 Found local service account file: ${localServiceAccount}`);
  } catch (error) {
    // File doesn't exist, continue to next option
  }
}

// Initialize TTS service with found credentials or use fallback
if (credentialsPath) {
  ttsService = new TTSService(credentialsPath);
  console.log(`✅ TTS Service initialized with credentials: ${credentialsPath}`);
} else {
  ttsService = new TTSService(); // Will use free fallback
  console.warn('⚠️  TTS credentials file not found, using free TTS (female voice)');
  console.warn('⚠️  To enable Google Cloud TTS, set GOOGLE_APPLICATION_CREDENTIALS in .env or place service account JSON in project root');
}

// Initialize Real-time Event Service
const realtimeService = new RealtimeService();
console.log('✅ Real-time Event Service initialized');

// Express middleware
app.use(express.json());

// TTS function removed - now using TTSService module

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
    console.log(`🔗 Fetching URL: ${url}`);
    
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
    console.error(`❌ Error fetching URL ${url}:`, error.message);
    return {
      url,
      error: error.message
    };
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Rabica Bot កំពុងដំណើរការ!',
    bot: 'Telegram bot with Gemini AI'
  });
});

// Webhook endpoint (optional, for production)
app.post(`/webhook/${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Keep-alive ping function
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  fetch(url)
    .then(response => {
      console.log(`🏓 Keep-alive ping successful: ${response.status}`);
    })
    .catch(error => {
      console.log(`⚠️  Keep-alive ping failed: ${error.message}`);
    });
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
    
    if (memMB.heapUsed > 400) { // Warn if using more than 400MB
      console.warn(`⚠️  High memory usage: ${memMB.heapUsed}MB / ${memMB.heapTotal}MB`);
      if (global.gc) global.gc(); // Force GC if available
    } else {
      console.log(`💾 Memory: ${memMB.heapUsed}MB / ${memMB.heapTotal}MB | Active conversations: ${geminiService?.conversationHistory?.size || 0}`);
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

  // Only log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📨 ទទួលសារពី chat ID: ${chatId}, ប្រភេទ: ${chatType}`);
  }

  // ពិនិត្យថាតើ bot ត្រូវបាន mention នៅក្នុង group/supergroup
  let isMentioned = false;
  if ((chatType === 'group' || chatType === 'supergroup') && userMessage) {
    if (!botUsername) {
      try {
        const me = await bot.getMe();
        botUsername = me.username;
        console.log(`🤖 Bot username: @${botUsername}`);
      } catch (error) {
        console.error('កំហុសក្នុងការទាញយក bot info:', error);
      }
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
    
    // ប្រសិនបើនៅក្នុង group ហើយមិនត្រូវបាន mention ទេ លែងឆ្លើយតប (លើកលែងតែ TELEGRAM_CHAT_ID ត្រូវគ្នា)
    if (!isMentioned) {
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
      
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📷 ទទួលរូបភាព: ${file.file_path} (${imageBuffer.length} bytes)`);
      }
    } catch (error) {
      console.error('កំហុសក្នុងការទាញយករូបភាព:', error);
    }
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
      
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📷 ទទួលរូបភាពជាឯកសារ: ${msg.document.file_name}`);
      }
    } catch (error) {
      console.error('កំហុសក្នុងការទាញយកឯកសាររូបភាព:', error);
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
      console.log(`🔄 Real-time event detected: ${urls.length} URL(s)`);
      
      // Step 1: Fetch from live source (API / RSS / Scraper)
      // Step 2: Backend (fetch + clean + compress)
      const realtimeResult = await realtimeService.processRealtimeEvent(urls[0]);
      
      if (realtimeResult.success) {
        realtimeData = realtimeResult.data;
        console.log(`✅ Real-time data processed: ${realtimeData.type} (${realtimeData.content.length} chars)`);
        
        // Append processed real-time data to message for Gemini
        cleanMessage += `\n\n[ទិន្នន័យពីប្រភពផ្ទាល់ពេល]\n${realtimeData.content}`;
      } else {
        console.warn(`⚠️  Real-time processing failed: ${realtimeResult.error}`);
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

      console.log(`🎨 Image generation requested: ${imagePrompt}`);
      
      // Generate image with conversation context
      const imageResult = await geminiService.generateImage(imagePrompt, chatId, '1:1', '1K');
      
      clearInterval(typingInterval);
      
      console.log(`📊 Image generation result:`, {
        success: imageResult.success,
        hasImageData: !!imageResult.imageData,
        imageDataLength: imageResult.imageData?.length || 0,
        error: imageResult.error
      });
      
      if (imageResult.success && imageResult.imageData) {
        try {
          // Convert base64 to buffer
          const imageBuffer = Buffer.from(imageResult.imageData, 'base64');
          console.log(`✅ Converted to buffer: ${imageBuffer.length} bytes`);
          
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
          console.log(`✅ Image generated and sent successfully with contextual response!`);
        } catch (sendError) {
          console.error('❌ Error sending image to Telegram:', sendError);
          await bot.sendMessage(chatId, `អូ... មិនអាចផ្ញើរូបបាន: ${sendError.message}`);
        }
      } else {
        console.log(`❌ Image generation failed: ${imageResult.error || 'Unknown error'}`);
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

          console.log('🎤 Converting text to speech...');
          const tempFile = await ttsService.textToSpeechFile(
          response, 
          'en-US', 
          'សំឡេងស្រីស្នេហ៍ក្មេង កក់ក្តៅ និងគួរឱ្យស្រលាញ់',
          os.tmpdir(),
          `tts_${chatId}`
        );
          
        // Send voice message only (no text caption)
        await bot.sendVoice(chatId, tempFile);
          
          // Clean up temp file
          await fs.unlink(tempFile).catch((err) => {
            console.warn('⚠️  Could not delete temp file:', err.message);
          });
        
          console.log('✅ Voice message sent successfully!');
        } catch (ttsError) {
          console.error('❌ TTS Error:', ttsError);
          // Fallback to text message if TTS fails
          await bot.sendMessage(chatId, response);
          await bot.sendMessage(chatId, '⚠️ មិនអាចបន្លឺសំឡេងបាន ប៉ុន្តែបានផ្ញើជាអត្ថបទហើយ!');
        }
      return;
    }

    // Send normal text message
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error('កំហុស:', error);
    try {
      await bot.sendMessage(chatId, 'មានបញ្ហាក្នុងការដំណើរការ។ សូមព្យាយាមម្តងទៀត!');
    } catch (sendError) {
      console.error('មិនអាចផ្ញើសារកំហុស:', sendError);
    }
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
      console.error('⚠️  មាន bot instance ផ្សេងកំពុងដំណើរការរួចហើយ!');
      console.error('⚠️  សូមបិទ instance ផ្សេងទៀត ឬរង់ចាំសិន...');
      // Don't exit, just log - the bot will retry
      return;
    }
  }
  console.error('កំហុស polling:', error.message || error);
});

// ចាប់ផ្តើម Express server
app.listen(PORT, async () => {
  console.log(`🚀 Server កំពុងដំណើរការនៅ port ${PORT}`);
  console.log(`🤖 Telegram bot សកម្ម!`);
  console.log(`🧠 Gemini AI ត្រូវបានកំណត់!`);
  console.log(`🏓 Keep-alive ping scheduled every 12 minutes`);
  if (TELEGRAM_CHAT_ID) {
    console.log(`📱 Bot ត្រូវបានកំណត់សម្រាប់ chat ID: ${TELEGRAM_CHAT_ID}`);
  }
  
  if (TELEGRAM_CHAT_ID && GEMINI_API_KEY) {
    try {
      await bot.sendMessage(
        TELEGRAM_CHAT_ID, 
        '🤖 Rabica Bot បានចាប់ផ្តើមដំណើរការ! ខ្ញុំរួមចំណែកហើយ! 😄'
      );
    } catch (error) {
      console.log('⚠️  មិនអាចផ្ញើសារចាប់ផ្តើម');
    }
  }
});
