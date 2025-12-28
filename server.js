require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const GeminiService = require('./services/geminiService');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

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
  geminiService = new GeminiService(GEMINI_API_KEY);
}

// Express middleware
app.use(express.json());

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
    message: 'Dara Bot កំពុងដំណើរការ!',
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

  // Detect URLs in message
  let urlContent = null;
  if (userMessage) {
    const urls = extractUrls(userMessage, entities);
    if (urls.length > 0) {
      console.log(`🔗 Found ${urls.length} URL(s) in message`);
      // Fetch the first URL (or you could fetch all)
      const fetchedContent = await fetchUrlContent(urls[0]);
      if (fetchedContent && !fetchedContent.error) {
        urlContent = fetchedContent;
        console.log(`✅ Fetched content from URL: ${fetchedContent.title || 'No title'}`);
      }
    }
  }

  // លុប bot mention ចេញពីសារ (ប្រសិនបើមាន)
  let cleanMessage = userMessage;
  if (isMentioned && botUsername) {
    cleanMessage = userMessage.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();
  }
  
  // Fetch image from URL if available (and no image already attached)
  if (urlContent && !urlContent.error && urlContent.image && !imageBuffer) {
    try {
      console.log(`🖼️  Fetching image from URL: ${urlContent.image}`);
      const imageResponse = await fetch(urlContent.image);
      if (imageResponse.ok) {
        const imageArrayBuffer = await imageResponse.arrayBuffer();
        imageBuffer = Buffer.from(imageArrayBuffer);
        console.log(`✅ Fetched image from URL (${imageBuffer.length} bytes)`);
      }
    } catch (error) {
      console.error('❌ Error fetching image from URL:', error.message);
    }
  }
  
  // Append URL content to message if available
  if (urlContent && !urlContent.error) {
    let urlInfo = `\n\n[អត្ថបទពីគេហទំព័រ]\n`;
    if (urlContent.title) {
      urlInfo += `ចំណងជើង: ${urlContent.title}\n`;
    }
    if (urlContent.description) {
      urlInfo += `បរិយាយ: ${urlContent.description}\n`;
    }
    if (urlContent.content) {
      urlInfo += `មាតិកា: ${urlContent.content.substring(0, 500)}...`;
    }
    cleanMessage += urlInfo;
  }

  // Check if user wants to generate an image
  const imageGenKeywords = [
    'បង្កើតរូប', 'គូររូប', 'គូរ', 'generate image', 'create image', 
    'draw', 'គូរឲ្យ', 'បង្កើត', 'រូបភាព', 'nanobanana'
  ];
  
  const wantsImageGen = cleanMessage && imageGenKeywords.some(keyword => 
    cleanMessage.toLowerCase().includes(keyword.toLowerCase())
  );

  // មុខងាររក្សា typing indicator
  const keepTyping = async () => {
    try {
      await bot.sendChatAction(chatId, wantsImageGen ? 'upload_photo' : 'typing');
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
      
      // Generate image
      const imageResult = await geminiService.generateImage(imagePrompt, '1:1', '1K');
      
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
          
          // Send image to Telegram
          await bot.sendPhoto(chatId, imageBuffer, {
            caption: `✅ រូបដែលបង្កើតដោយ: "${imagePrompt}"`
          });
          console.log(`✅ Image generated and sent successfully!`);
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

    // Normal text response
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
  const helpMessage = `📖 ជំនួយ:\n\n• ផ្ញើសារមកខ្ញុំ ហើយខ្ញុំនឹងឆ្លើយតបជាភាសាខ្មែរដោយប្រើប្រាស់រចនាប័ទ្ម meme!\n• ខ្ញុំប្រើប្រាស់ Gemini AI ដើម្បីបង្កើតចម្លើយ\n• ខ្ញុំអាចចងចាំការសន្ទនារបស់យើង!\n• 🎨 បង្កើតរូប: សរសេរ "បង្កើតរូប..." ឬ "គូររូប..." ដើម្បីបង្កើតរូបដោយ AI\n• ប្រើ /start ដើម្បីចាប់ផ្តើមការសន្ទនាថ្មី\n• គ្រាន់តែជជែកជាមួយខ្ញុំដូចជាមិត្តភក្តិ! 😊`;
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
        '🤖 Dara Bot បានចាប់ផ្តើមដំណើរការ! ខ្ញុំរួមចំណែកហើយ! 😄'
      );
    } catch (error) {
      console.log('⚠️  មិនអាចផ្ញើសារចាប់ផ្តើម');
    }
  }
});
