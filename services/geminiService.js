const { GoogleGenAI } = require('@google/genai');
const DARA_SYSTEM_INSTRUCTION = require('../config/systemInstruction');
const { cleanLaTeXFormatting } = require('../utils/textDetection');

// Initialize Gemini AI service
class GeminiService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('ត្រូវការ GEMINI_API_KEY ក្នុង .env file!');
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.conversationHistory = new Map(); // Store conversation history per chat
    this.conversationTimestamps = new Map(); // Track last access time for cleanup
    this.maxHistorySize = parseInt(process.env.MAX_CONVERSATION_HISTORY) || 20; // Reduced from 40 to 20
    this.maxConversations = parseInt(process.env.MAX_CONVERSATIONS) || 100; // Limit active conversations
    this.conversationTTL = parseInt(process.env.CONVERSATION_TTL) || 3600000; // 1 hour
    
    // Cleanup old conversations every 30 minutes
    setInterval(() => this.cleanupOldConversations(), 30 * 60 * 1000);
    
    console.log('✅ Google AI Studio initialized');
  }

  // Cleanup old conversations to free memory
  cleanupOldConversations() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [chatId, timestamp] of this.conversationTimestamps.entries()) {
      if (now - timestamp > this.conversationTTL) {
        this.conversationHistory.delete(chatId);
        this.conversationTimestamps.delete(chatId);
        cleaned++;
      }
    }
    
    // If still too many conversations, remove oldest
    if (this.conversationHistory.size > this.maxConversations) {
      const sorted = Array.from(this.conversationTimestamps.entries())
        .sort((a, b) => a[1] - b[1]);
      
      const toRemove = this.conversationHistory.size - this.maxConversations;
      for (let i = 0; i < toRemove; i++) {
        const chatId = sorted[i][0];
        this.conversationHistory.delete(chatId);
        this.conversationTimestamps.delete(chatId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old conversations. Active: ${this.conversationHistory.size}`);
      // Force garbage collection hint
      if (global.gc) global.gc();
    }
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
      let userMessageText = message || (imageData ? 'មើលរូបនេះ' : 'សួស្តី');
      
      const parts = [{ text: userMessageText }];
      
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

      // Use natural, human-like parameters for all conversations
      // Keeping creative and genuine responses
      const temperature = 0.9;
      const topP = 0.95;
      const topK = 40;

      // Generate response with natural, human-like parameters
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction: DARA_SYSTEM_INSTRUCTION,
          temperature: temperature,
          topP: topP,
          topK: topK,
          },
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");

      // Post-process to clean up formatting issues
      const cleanedText = cleanLaTeXFormatting(text);

      return cleanedText;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "អូ... មានបញ្ហាបច្ចេកទេសបន្តិចហើយស្រីស្នេហ៍។ សាកម្តងទៀតមើល?";
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

      // Keep only last N messages (reduced for memory efficiency)
      if (conversationHistory.length > this.maxHistorySize) {
        conversationHistory = conversationHistory.slice(-this.maxHistorySize);
      }

      this.conversationHistory.set(chatId, conversationHistory);
      this.conversationTimestamps.set(chatId, Date.now());
      
      // Only log in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`💾 រក្សាការសន្ទនាសម្រាប់ chat ${chatId}`);
      }
      
      return response;
    } catch (error) {
      console.error('Gemini API Error:', error);
      this.conversationHistory.delete(chatId);
      return 'អូ... មានបញ្ហាបន្តិច សូមព្យាយាមម្តងទៀតណា!';
    }
  }

  // Generate image using Gemini Imagen (Nano Banana Pro) with conversation context
  async generateImage(prompt, chatId, aspectRatio = '1:1', imageSize = '1K') {
    try {
      // Get conversation history for context
      let conversationHistory = this.conversationHistory.get(chatId) || [];
      
      // Build context-aware prompt by including recent conversation
      // Include self-awareness that Dara (the girlfriend) is creating this image
      let contextualPrompt = prompt;
      if (conversationHistory.length > 0) {
        // Get last few messages for context (last 3 exchanges = 6 messages)
        const recentHistory = conversationHistory.slice(-6);
        let contextSummary = '';
        
        for (const msg of recentHistory) {
          if (msg.role === 'user') {
            contextSummary += `User: ${msg.text}\n`;
          } else if (msg.role === 'model') {
            contextSummary += `Dara (you): ${msg.text}\n`;
          }
        }
        
        // Enhance prompt with context and self-awareness
        contextualPrompt = `You are Dara, creating an image for your boyfriend. Context:\n${contextSummary}\nNow create an image based on: ${prompt}`;
        console.log(`🎨 Generating image with self-aware context (${conversationHistory.length} messages in history)`);
      } else {
        // Even without history, include self-awareness
        contextualPrompt = `You are Dara creating an image for your boyfriend. Create: ${prompt}`;
      }
      
      console.log(`🎨 Image prompt: ${prompt.substring(0, 80)}...`);
      
      // Use gemini-3-flash-preview for image generation
      // IMPORTANT: Disable function calling to prevent tool call outputs
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{
          role: 'user',
          parts: [{ text: contextualPrompt }]
        }],
        config: {
          systemInstruction: DARA_SYSTEM_INSTRUCTION + '\n\nCRITICAL: When creating images, generate them directly. NEVER output JSON, function calls, tool formats, or {"action": ...} syntax. Just generate the image naturally.',
          temperature: 0.7,
          // Disable function calling
          tools: []
        }
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
              
              // Update conversation history after successful image generation
              if (chatId) {
                let conversationHistory = this.conversationHistory.get(chatId) || [];
                conversationHistory.push({
                  role: 'user',
                  text: `បង្កើតរូប: ${prompt}`
                });
                conversationHistory.push({
                  role: 'model',
                  text: `បានបង្កើតរូបភាព: ${prompt}`
                });
                
                // Keep only last 20 messages
                if (conversationHistory.length > 40) {
                  conversationHistory = conversationHistory.slice(-40);
                }
                
                this.conversationHistory.set(chatId, conversationHistory);
                console.log(`💾 Updated conversation history for image generation`);
              }
              
              return {
                success: true,
                imageData: part.inlineData.data, // This is base64 string
                mimeType: part.inlineData.mimeType || 'image/png'
              };
            }
          }
          
          // Check for text parts that might contain function calls (should not happen)
          for (let i = 0; i < candidate.content.parts.length; i++) {
            const part = candidate.content.parts[i];
            
            if (part.text) {
              // Check if text contains function call format - this is wrong, reject it
              // Look for JSON structures that look like function calls
              if (part.text.includes('"action"') && part.text.includes('"action_input"')) {
                console.error(`❌ Model returned function call format instead of image!`);
                console.error(`❌ Text content: ${part.text.substring(0, 300)}...`);
                throw new Error('Model returned function call format instead of generating image. Please try again.');
              }
              console.log(`⚠️ Part ${i} contains text (${part.text.length} chars): ${part.text.substring(0, 200)}...`);
            }
            
            if (part.functionCall) {
              console.error(`❌ Part ${i} has functionCall property - this should not happen!`);
              throw new Error('Model attempted function call instead of image generation');
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
