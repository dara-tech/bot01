const fetch = require('node-fetch');
const fs = require('fs').promises;
const fsSync = require('fs');

/**
 * TTS Service - Using Gemini TTS Models
 * Uses Gemini 2.5 TTS models with REST API
 * 
 * Supports:
 * - Gemini 2.5 Flash TTS (low latency, cost-efficient)
 * - Gemini 2.5 Pro TTS (high control for structured workflows)
 * - Style prompts for natural language voice control
 * - Free Google Translate TTS fallback
 * 
 * Documentation: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
 */
class TTSService {
  constructor(credentialsPath = null) {
    this.useGeminiTTS = false;
    this.credentialsPath = null;
    this.projectId = null;
    this.accessToken = null;
    this.accessTokenExpiry = null;

    // Use provided path, or check environment variable
    const credsPath = credentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (credsPath) {
      // Check if the file is an OAuth client secret (won't work for TTS)
      try {
        if (fsSync.existsSync(credsPath)) {
          const credsContent = fsSync.readFileSync(credsPath, 'utf8');
          const credsJson = JSON.parse(credsContent);
          
          // OAuth client secrets have "web" or "installed" keys, not "type": "service_account"
          if (credsJson.web || credsJson.installed || credsJson.client_secret) {
            console.warn(`⚠️ TTS: OAuth client secrets detected - cannot be used for TTS.`);
            console.warn(`⚠️ You need a Service Account JSON key file (with "type": "service_account").`);
            console.warn(`⚠️ Get it from: https://console.cloud.google.com/iam-admin/serviceaccounts`);
            console.warn(`⚠️ Using Female Fallback TTS instead.`);
            return; // Skip TTS initialization
          }
          
          // Check if it's a service account file
          if (credsJson.type !== 'service_account') {
            console.warn(`⚠️ TTS: Credentials file doesn't appear to be a service account.`);
            console.warn(`⚠️ Expected "type": "service_account" in the JSON file.`);
            console.warn(`⚠️ Using Female Fallback TTS instead.`);
            return; // Skip TTS initialization
          }
          
          // Valid service account found
          this.credentialsPath = credsPath;
          this.projectId = credsJson.project_id || process.env.GOOGLE_CLOUD_PROJECT;
          this.useGeminiTTS = true;
          console.log(`✅ TTS: Gemini TTS initialized`);
          console.log(`📁 Using credentials: ${credsPath}`);
          console.log(`📦 Project ID: ${this.projectId || 'Not set'}`);
        }
      } catch (readError) {
        console.warn(`⚠️ TTS: Could not read credentials file: ${readError.message}`);
      }
    } else {
      console.warn("⚠️ TTS: No credentials path found. Using Female Fallback.");
      console.warn("⚠️ To enable Gemini TTS, set GOOGLE_APPLICATION_CREDENTIALS in .env");
    }
  }

  /**
   * Get access token for Google Cloud using service account
   */
  async getAccessToken() {
    // Return cached token if still valid (with 5 minute buffer)
    if (this.accessToken && this.accessTokenExpiry && Date.now() < this.accessTokenExpiry - 300000) {
      return this.accessToken;
    }

    if (!this.credentialsPath) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required for TTS");
    }

    try {
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({
        keyFile: this.credentialsPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const client = await auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      
      if (!accessTokenResponse?.token) {
        throw new Error("Failed to obtain access token from service account");
      }
      
      // Cache token (expires in 1 hour, refresh 5 minutes before)
      this.accessToken = accessTokenResponse.token;
      this.accessTokenExpiry = Date.now() + 3600000; // 1 hour
      
      return this.accessToken;
    } catch (error) {
      console.error("[TTS] Error getting access token:", error);
      throw new Error(`Failed to authenticate with Google Cloud: ${error.message}`);
    }
  }

  /**
   * Main TTS function
   * @param {string} text - The text to speak
   * @param {string} language - Language code (e.g., 'en-US', 'km-KH'). Default 'en-US'
   * @param {string} stylePrompt - Optional natural language prompt for style control (e.g., "Say this in a friendly way")
   */
  async textToSpeech(text, language = 'en-US', stylePrompt = null) {
    if (!text || text.trim().length === 0) {
      throw new Error('Text is empty');
    }

    // Limit text length for performance
    const textToConvert = text.substring(0, 5000); // Gemini TTS supports longer text
    const startTime = Date.now();

    // Extract language code (e.g., 'km' from 'km-KH')
    const languageCode = language.split('-')[0];

    // --- STRATEGY 1: Gemini TTS ---
    if (this.useGeminiTTS) {
      // Gemini TTS models to try in order (per official docs: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)
      // gemini-2.5-flash-tts: Low latency, cost-efficient (recommended for most use cases)
      // gemini-2.5-pro-tts: High control for structured workflows (podcasts, audiobooks, etc.)
      const geminiModels = [
        'gemini-2.5-flash-tts',
        'gemini-2.5-pro-tts',
      ];

      // Gemini voices (Rasalgethi is a good male voice)
      const geminiVoices = ['Fenrir'];

      for (const model of geminiModels) {
        for (const speaker of geminiVoices) {
          try {
            const accessToken = await this.getAccessToken();
            const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize`;

            // Build input object - Gemini TTS supports both 'prompt' (style) and 'text' fields
            const inputObj = {};
            if (stylePrompt) {
              inputObj.prompt = stylePrompt;
              inputObj.text = textToConvert;
            } else {
              inputObj.text = textToConvert;
            }

            const requestBody = {
              input: inputObj,
              voice: {
                languageCode: language, // Use provided language parameter
                name: speaker,
                modelName: model,
              },
              audioConfig: {
                audioEncoding: 'MP3', // Supported: LINEAR16 (default), ALAW, MULAW, MP3, OGG_OPUS, PCM
                speakingRate: 1.0,
                pitch: 0,
                volumeGainDb: 0,
              },
            };

            const response = await fetch(ttsUrl, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                ...(this.projectId && { "x-goog-user-project": this.projectId }),
              },
              body: JSON.stringify(requestBody),
            });

            if (response.ok) {
              const data = await response.json();
              if (data.audioContent) {
                console.log(`✅ Gemini TTS Generated (${model} - ${speaker}): ${Date.now() - startTime}ms`);
                return Buffer.from(data.audioContent, 'base64');
              }
            } else {
              const errorText = await response.text();
              console.log(`⚠️ Gemini TTS Error (${model} - ${speaker}): ${response.status} - ${errorText.substring(0, 100)}`);
              // Continue to next voice/model
              continue;
            }
          } catch (error) {
            console.log(`⚠️ Gemini TTS Error (${model} - ${speaker}): ${error.message}`);
            // Continue to next voice/model
            continue;
          }
        }
      }
      
      // If all Gemini models/voices failed
      console.error("⚠️ All Gemini TTS models failed, falling back to Free TTS");
    }

    // --- STRATEGY 2: Free Fallback (FEMALE ONLY) ---
    // Note: There is no way to get a male voice from this free URL.
    // Try multiple TTS endpoints for better reliability
    const freeTtsUrls = [
      `https://translate.google.com/translate_tts?ie=UTF-8&tl=${languageCode}&client=tw-ob&q=${encodeURIComponent(textToConvert)}`,
      `https://translate.google.com/translate_tts?ie=UTF-8&tl=${languageCode}&client=gtx&q=${encodeURIComponent(textToConvert)}`,
      `https://translate.google.com/translate_tts?ie=UTF-8&tl=${languageCode}&q=${encodeURIComponent(textToConvert)}`
    ];
    
    let lastError = null;
    const maxRetries = 3;
    
    for (const freeTtsUrl of freeTtsUrls) {
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          // Add delay for retries (exponential backoff for rate limits)
          if (retry > 0) {
            const delay = Math.min(1000 * Math.pow(2, retry - 1), 5000); // 1s, 2s, 4s max
            console.log(`⏳ Retrying free TTS (attempt ${retry + 1}/${maxRetries}) after ${delay}ms delay...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // Create a timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 10000);
          });
          
          // Race between fetch and timeout
          const response = await Promise.race([
            fetch(freeTtsUrl, {
              headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://translate.google.com/',
                'Accept': 'audio/webm,audio/ogg,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5'
              }
            }),
            timeoutPromise
          ]);
          
          if (!response.ok) {
            // If rate limited (429), retry with backoff
            if (response.status === 429 && retry < maxRetries - 1) {
              lastError = new Error(`HTTP ${response.status} (Rate Limited)`);
              continue; // Retry this URL
            }
            lastError = new Error(`HTTP ${response.status}`);
            break; // Try next URL
          }
          
          const buffer = await response.buffer();
          if (buffer && buffer.length > 0) {
            console.log(`✅ Free TTS Generated (Female): ${Date.now() - startTime}ms`);
            return buffer;
          } else {
            lastError = new Error('Empty response from TTS service');
            break; // Try next URL
          }
        } catch (error) {
          lastError = error;
          // If timeout or network error, retry
          if ((error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) && retry < maxRetries - 1) {
            continue; // Retry
          }
          break; // Try next URL
        }
      }
    }
    
    // If all free TTS URLs failed, throw error
    throw new Error(`TTS Failed entirely: ${lastError ? lastError.message : 'All free TTS endpoints failed'}`);
  }

  /**
   * Helper to save as file
   */
  async saveToFile(text, filePath) {
    const buffer = await this.textToSpeech(text);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  /**
   * Generate TTS and save to temporary file
   * @param {string} text - The text to speak
   * @param {string} language - Language code (e.g., 'en-US', 'km-KH'). Default 'en-US'
   * @param {string} stylePrompt - Optional natural language prompt for style control
   * @param {string} tempDir - Temporary directory path (defaults to os.tmpdir())
   * @param {string} prefix - File prefix for temp file (defaults to 'tts')
   * @returns {Promise<string>} Path to the temporary audio file
   */
  async textToSpeechFile(text, language = 'en-US', stylePrompt = null, tempDir = null, prefix = 'tts') {
    const os = require('os');
    const path = require('path');
    
    // Generate audio buffer
    const audioBuffer = await this.textToSpeech(text, language, stylePrompt);
    
    // Create temporary file path
    const dir = tempDir || os.tmpdir();
    const tempFile = path.join(dir, `${prefix}_${Date.now()}.mp3`);
    
    // Write buffer to file
    await fs.writeFile(tempFile, audioBuffer);
    
    return tempFile;
  }
}

module.exports = TTSService;
