/**
 * Speech-to-Text service for Telegram voice messages.
 * Uses Google Cloud Speech-to-Text (same credentials as TTS).
 * Telegram voice is OGG Opus; we send it as-is with encoding OGG_OPUS.
 */

let SpeechClient;
try {
  SpeechClient = require('@google-cloud/speech').v1.SpeechClient;
} catch (e) {
  SpeechClient = null;
}

const MAX_VOICE_SIZE = 1024 * 1024; // 1MB

class SpeechService {
  constructor() {
    this.client = null;
    if (SpeechClient) {
      try {
        this.client = new SpeechClient();
      } catch (err) {}
    } else {}
  }

  /**
   * Transcribe OGG Opus audio (Telegram voice message format).
   * Default: Khmer (km-KH) with English (en-US) as alternative for mixed speech.
   * @param {Buffer} audioBuffer - Raw OGG Opus bytes
   * @param {string} languageCode - e.g. 'km-KH' (Khmer), 'en-US', or 'auto'
   * @returns {Promise<string>} Transcribed text or empty string on failure
   */
  async transcribe(audioBuffer, languageCode = 'km-KH') {
    if (!this.client || !audioBuffer || audioBuffer.length === 0) {
      return '';
    }
    if (audioBuffer.length > MAX_VOICE_SIZE) {
      return '';
    }

    const lang = languageCode === 'auto' ? 'km-KH' : languageCode;
    const alternativeLangs = lang === 'km-KH' ? ['en-US'] : ['km-KH'];

    const getText = (response) => {
      if (!response.results || response.results.length === 0) return '';
      return response.results
        .map((r) => r.alternatives && r.alternatives[0] && r.alternatives[0].transcript)
        .filter(Boolean)
        .join(' ')
        .trim();
    };

    try {
      const [response] = await this.client.recognize({
        config: {
          encoding: 'OGG_OPUS',
          sampleRateHertz: 48000,
          languageCode: lang,
          alternativeLanguageCodes: alternativeLangs,
          model: 'default',
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: audioBuffer.toString('base64'),
        },
      });

      let text = getText(response);
      if (text) return text;

      // Fallback: try the other language if primary returned nothing
      const fallbackLang = lang === 'km-KH' ? 'en-US' : 'km-KH';
      const [fallbackResponse] = await this.client.recognize({
        config: {
          encoding: 'OGG_OPUS',
          sampleRateHertz: 48000,
          languageCode: fallbackLang,
          model: 'default',
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: audioBuffer.toString('base64'),
        },
      });
      return getText(fallbackResponse) || '';
    } catch (err) {
      return '';
    }
  }
}

module.exports = SpeechService;
