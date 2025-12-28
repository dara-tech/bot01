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

  // Generate image using Gemini Imagen (Nano Banana Pro)
  async generateImage(prompt, aspectRatio = '1:1', imageSize = '1K') {
    try {
      // Use the prompt directly as a string (matching the correct API format)
      console.log(`🎨 Generating image with prompt: ${prompt.substring(0, 80)}...`);
      
      // Use gemini-2.5-flash-image model for native Gemini image generation
      // Contents should be a string directly - Gemini will generate image natively
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt, // Pass prompt as string directly
      });

      // Extract image data from response
      // Match the correct format: response.candidates[0].content.parts -> part.inlineData.data
      console.log('📦 Full response structure:', JSON.stringify({
        hasCandidates: !!response.candidates,
        candidatesLength: response.candidates?.length || 0,
        responseKeys: Object.keys(response || {})
      }));

      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        console.log('📋 Candidate keys:', Object.keys(candidate || {}));
        
        if (candidate.content && candidate.content.parts) {
          console.log(`📋 Checking ${candidate.content.parts.length} part(s) for image data`);
          
          // First pass: Look for image data (this is what we want)
          for (let i = 0; i < candidate.content.parts.length; i++) {
            const part = candidate.content.parts[i];
            console.log(`📋 Part ${i} keys:`, Object.keys(part || {}));
            
            // Check for inlineData (image) - this is the correct format
            if (part.inlineData && part.inlineData.data) {
              console.log(`✅ Found image in part ${i}! Data length: ${part.inlineData.data.length} chars (base64)`);
              console.log(`✅ MIME type: ${part.inlineData.mimeType || 'image/png'}`);
              console.log(`✅ First 50 chars of data: ${part.inlineData.data.substring(0, 50)}...`);
              return {
                success: true,
                imageData: part.inlineData.data, // This is base64 string
                mimeType: part.inlineData.mimeType || 'image/png'
              };
            }
          }
          
          // Log any text parts for debugging (but only log, don't treat as function calls)
          for (let i = 0; i < candidate.content.parts.length; i++) {
            const part = candidate.content.parts[i];
            
            if (part.text) {
              console.log(`⚠️ Part ${i} contains text (${part.text.length} chars): ${part.text.substring(0, 200)}...`);
            }
            
            if (part.functionCall) {
              console.log(`⚠️ Part ${i} has functionCall property (ignoring):`, Object.keys(part.functionCall || {}));
            }
          }
        } else {
          console.log('⚠️ Candidate has no content.parts');
        }
      } else {
        console.log('⚠️ Response has no candidates');
      }

      // Format 2: Direct images array
      if (response.images && response.images.length > 0) {
        console.log(`✅ Found image in response.images`);
        return {
          success: true,
          imageData: response.images[0],
          mimeType: 'image/png'
        };
      }

      // Format 3: Check if response.text contains image data URL
      if (response.text) {
        const dataUrlMatch = response.text.match(/data:image\/([^;]+);base64,([A-Za-z0-9+\/=]+)/);
        if (dataUrlMatch) {
          console.log(`✅ Found image in response.text as data URL`);
          return {
            success: true,
            imageData: dataUrlMatch[2],
            mimeType: `image/${dataUrlMatch[1]}`
          };
        }
      }

      // Format 4: Check response directly for base64 string
      if (typeof response === 'string' && response.length > 100) {
        // Might be base64 directly
        try {
          Buffer.from(response, 'base64');
          console.log(`✅ Treating response as base64 string`);
          return {
            success: true,
            imageData: response,
            mimeType: 'image/png'
          };
        } catch (e) {
          // Not base64
        }
      }

      // Last resort: Log full response for debugging
      console.error('❌ No image data found in response!');
      console.error('❌ Response structure:', JSON.stringify({
        keys: Object.keys(response || {}),
        hasCandidates: !!response.candidates,
        candidatesCount: response.candidates?.length || 0
      }, null, 2));
      
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        console.error('❌ Full candidate structure:', JSON.stringify(candidate, null, 2).substring(0, 2000));
      }
      
      throw new Error("No image data in response - API returned text instead of image. Please check the response structure in logs above.");
    } catch (error) {
      console.error("Image Generation Error:", error);
      return {
        success: false,
        error: error.message || "មានបញ្ហាក្នុងការបង្កើតរូប"
      };
    }
  }

  // Clear conversation history for a chat
  clearHistory(chatId) {
    this.conversationHistory.delete(chatId);
    console.log(`🗑️  បានលុបការសន្ទនាសម្រាប់ chat ${chatId}`);
  }
}

module.exports = GeminiService;
