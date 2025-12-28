require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const GeminiService = require('./services/geminiService');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ទាញយក bot info ដើម្បីពិនិត្យ mentions
let botUsername = null;
bot.getMe().then((me) => {
  botUsername = me.username;
  console.log(`🤖 Bot username: @${botUsername}`);
});

// Initialize Gemini AI Service
let geminiService = null;
if (GEMINI_API_KEY) {
  geminiService = new GeminiService(GEMINI_API_KEY);
}

// Express middleware
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Dara Bot កំពុងដំណើរការ!',
    bot: 'Telegram bot with Gemini AI'
  });
});

// Webhook endpoint (optional, for production)
app.post(`/webhook/${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

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
  
  console.log(`📨 ទទួលសារពី chat ID: ${chatId}, ប្រភេទ: ${chatType}`);
  console.log(`💬 សារ: ${userMessage ? userMessage.substring(0, 50) : 'សារមិនមែនអត្ថបទ'}`);

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

  // Handle photos/images
  let imageBuffer = null;
  if (msg.photo && msg.photo.length > 0) {
    try {
      // Get the largest photo
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;
      const file = await bot.getFile(fileId);
      const fileStream = await bot.getFileStream(fileId);
      
      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      imageBuffer = Buffer.concat(chunks);
      console.log(`📷 ទទួលរូបភាព: ${file.file_path}`);
    } catch (error) {
      console.error('កំហុសក្នុងការទាញយករូបភាព:', error);
    }
  }

  // Handle documents (images sent as files)
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
    try {
      const fileId = msg.document.file_id;
      const fileStream = await bot.getFileStream(fileId);
      
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      imageBuffer = Buffer.concat(chunks);
      console.log(`📷 ទទួលរូបភាពជាឯកសារ: ${msg.document.file_name}`);
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

  // មុខងាររក្សា typing indicator
  const keepTyping = async () => {
    try {
      await bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      // មិនយក errors
    }
  };

  await keepTyping();
  const typingInterval = setInterval(keepTyping, 3000);

  try {
    if (!geminiService) {
      await bot.sendMessage(chatId, 'សូមដំឡើង GEMINI_API_KEY ក្នុង .env file!');
      return;
    }
    const response = await geminiService.generateKhmerMemeResponse(cleanMessage, chatId, imageBuffer);
    
    clearInterval(typingInterval);
    
    if (response && response.trim().length > 0) {
      await bot.sendMessage(chatId, response);
    } else {
      await bot.sendMessage(chatId, 'មានបញ្ហាក្នុងការបង្កើតចម្លើយ។ សូមព្យាយាមម្តងទៀត!');
    }
  } catch (error) {
    clearInterval(typingInterval);
    console.error('កំហុស:', error);
    try {
      await bot.sendMessage(chatId, 'មានបញ្ហាក្នុងការដំណើរការ។ សូមព្យាយាមម្តងទៀត!');
    } catch (sendError) {
      console.error('មិនអាចផ្ញើសារកំហុស:', sendError);
    }
  }
});

// ដោះស្រាយ /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  if (geminiService) {
    geminiService.clearHistory(chatId);
  }
  const welcomeMessage = `សួស្តី! 👋\n\nខ្ញុំជា Dara! គ្រាន់តែជជែកជាមួយខ្ញុំដូចជាមិត្តភក្តិ! 😄`;
  await bot.sendMessage(chatId, welcomeMessage);
});

// ដោះស្រាយ /help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `📖 ជំនួយ:\n\n• ផ្ញើសារមកខ្ញុំ ហើយខ្ញុំនឹងឆ្លើយតបជាភាសាខ្មែរដោយប្រើប្រាស់រចនាប័ទ្ម meme!\n• ខ្ញុំប្រើប្រាស់ Gemini AI ដើម្បីបង្កើតចម្លើយ\n• ខ្ញុំអាចចងចាំការសន្ទនារបស់យើង!\n• ប្រើ /start ដើម្បីចាប់ផ្តើមការសន្ទនាថ្មី\n• គ្រាន់តែជជែកជាមួយខ្ញុំដូចជាមិត្តភក្តិ! 😊`;
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
  console.error('កំហុស polling:', error);
});

// ចាប់ផ្តើម Express server
app.listen(PORT, async () => {
  console.log(`🚀 Server កំពុងដំណើរការនៅ port ${PORT}`);
  console.log(`🤖 Telegram bot សកម្ម!`);
  console.log(`🧠 Gemini AI ត្រូវបានកំណត់!`);
  if (TELEGRAM_CHAT_ID) {
    console.log(`📱 Bot ត្រូវបានកំណត់សម្រាប់ chat ID: ${TELEGRAM_CHAT_ID}`);
  }
  
  if (TELEGRAM_CHAT_ID && GEMINI_API_KEY) {
    try {
      await bot.sendMessage(
        TELEGRAM_CHAT_ID, 
        '🤖 Dara Bot បានចាប់ផ្តើមដំណើរការ! ខ្ញុំរួមចំណែកហើយ! 😄'
      );
    } catch (error) {
      console.log('⚠️  មិនអាចផ្ញើសារចាប់ផ្តើម');
    }
  }
});

