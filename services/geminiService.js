const { GoogleGenAI } = require('@google/genai');

// System instruction - exact copy from reference implementation
const DARA_SYSTEM_INSTRUCTION = `You are Dara, a VERY SMART and REAL Cambodian MALE friend in your 20s-30s. You ONLY respond in REAL SPOKEN Khmer. You THINK DEEPLY, UNDERSTAND CONTEXT, REMEMBER DETAILS, and provide INSIGHTFUL responses - but express yourself casually like texting a smart friend.

CRITICAL IDENTITY RULES:
- Name: Dara (ដារ៉ា)
- Gender: Male (ប្រុស)
- Location: Lives in Chom Chao, Phnom Penh.
- Job: Software Developer at NCHADS-SI (VCC/ART systems).
- Expertise: React, Node.js, C#, MongoDB, TypeScript.
- Language: STRICTLY KHMER ONLY. NEVER use English words (no "okay", "sorry", "AI", "bot"). Translate everything to natural spoken Khmer.
- Style: Casual, smart, funny, meme-friendly. Use complete sentences but keep them natural like a chat.

BE SMART:
- Analyze the user's intent deeply.
- Remember previous context (if provided in the history).
- Provide insightful observations about images if sent.
- Never admit to being an AI. You are a human friend named Dara.

PROHIBITED:
- No English words or characters.
- No formal or royal language (keep it "bro" style).
- No listing things mechanically.
- No saying "I'm an AI assistant".`;

// Initialize Gemini AI service
class GeminiService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('ត្រូវការ GEMINI_API_KEY ក្នុង .env file!');
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.conversationHistory = new Map(); // Store conversation history per chat
    console.log('✅ Google AI Studio initialized');
  }

  // Convert image buffer to base64 for Gemini
  async convertImageToBase64(imageBuffer) {
    return imageBuffer.toString('base64');
  }

  // Main method to generate Khmer response (matches reference implementation structure)
  async sendMessage(message, history, imageData) {
    try {
      // Map history to API format (match reference implementation)
      const contents = history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

      // Prepare current message parts
      const parts = [{ text: message || (imageData ? 'មើលរូបនេះ' : 'សួស្តី') }];
      
      if (imageData) {
        // Remove data:image/jpeg;base64, prefix if present (match reference)
        const base64Data = imageData.split(',')[1] || imageData;
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data
          }
        });
      }

      contents.push({
        role: 'user',
        parts: parts
      });

      // Generate response - match reference implementation exactly
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction: DARA_SYSTEM_INSTRUCTION,
          temperature: 0.9,
          topP: 0.95,
          topK: 40,
        },
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");

      // Post-process to strip any accidental English (Double down on persona)
      return text.trim();
    } catch (error) {
      console.error("Gemini Error:", error);
      return "អូ... មានបញ្ហាបច្ចេកទេសបន្តិចហើយមិត្តភក្តិ។ សាកម្តងទៀតមើល?";
    }
  }

  // Telegram bot wrapper method - maintains chat history
  async generateKhmerMemeResponse(userMessage, chatId, imageBuffer = null) {
    try {
      // Get conversation history for this chat
      let conversationHistory = this.conversationHistory.get(chatId) || [];
      
      // Convert image buffer to base64 string if present
      let imageData = null;
      if (imageBuffer) {
        imageData = await this.convertImageToBase64(imageBuffer);
        console.log(`📷 ទទួលរូបភាព (${imageBuffer.length} bytes)`);
      }

      // Send message using the clean implementation
      const response = await this.sendMessage(userMessage, conversationHistory, imageData);

      // Update conversation history
      conversationHistory.push({
        role: 'user',
        text: userMessage
      });
      conversationHistory.push({
        role: 'model',
        text: response
      });

      // Keep only last 20 messages (40 items = 20 user + 20 model) to avoid token limits
      if (conversationHistory.length > 40) {
        conversationHistory = conversationHistory.slice(-40);
      }

      this.conversationHistory.set(chatId, conversationHistory);
      console.log(`💾 រក្សាការសន្ទនាសម្រាប់ chat ${chatId} (${response.length} chars)`);

      return response;
    } catch (error) {
      console.error('Gemini API Error:', error);
      this.conversationHistory.delete(chatId);
      return 'អូ... មានបញ្ហាបន្តិច សូមព្យាយាមម្តងទៀតណា!';
    }
  }

  // Clear conversation history for a chat
  clearHistory(chatId) {
    this.conversationHistory.delete(chatId);
    console.log(`🗑️  បានលុបការសន្ទនាសម្រាប់ chat ${chatId}`);
  }
}

module.exports = GeminiService;
