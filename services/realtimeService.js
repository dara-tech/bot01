const fetch = require('node-fetch');
const cheerio = require('cheerio');

/**
 * Real-time Event Service
 * Fetches live data from APIs, RSS feeds, or web scrapers
 * Processes and compresses data, then sends to Gemini for reasoning
 * No data is saved - everything is processed in real-time
 */
class RealtimeService {
  constructor() {
    this.maxContentLength = 5000; // Max characters to send to Gemini
    this.timeout = 10000; // 10 second timeout
  }

  /**
   * Fetch and clean data from URL
   * @param {string} url - URL to fetch
   * @returns {Promise<Object>} Cleaned and compressed data
   */
  async fetchAndClean(url) {
    try {
      console.log(`🔄 Fetching real-time data from: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: this.timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      
      // Handle JSON (API responses)
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return this.compressJson(data);
      }
      
      // Handle RSS/XML feeds
      if (contentType.includes('xml') || url.includes('.rss') || url.includes('feed')) {
        const xml = await response.text();
        return this.compressRSS(xml);
      }
      
      // Handle HTML (web scraping)
      if (contentType.includes('text/html')) {
        const html = await response.text();
        return this.compressHTML(html, url);
      }
      
      // Fallback: plain text
      const text = await response.text();
      return this.compressText(text);
      
    } catch (error) {
      console.error(`❌ Error fetching real-time data: ${error.message}`);
      throw new Error(`Failed to fetch data: ${error.message}`);
    }
  }

  /**
   * Compress JSON data
   */
  compressJson(data) {
    try {
      // Extract key information
      let compressed = '';
      
      if (Array.isArray(data)) {
        // Array of items - take first few
        const items = data.slice(0, 5).map(item => {
          if (typeof item === 'object') {
            return JSON.stringify(item).substring(0, 200);
          }
          return String(item).substring(0, 200);
        });
        compressed = items.join('\n');
      } else if (typeof data === 'object') {
        // Object - extract important fields
        const importantFields = ['title', 'content', 'description', 'text', 'message', 'data', 'items', 'results'];
        const extracted = {};
        
        for (const key of Object.keys(data)) {
          if (importantFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
            const value = data[key];
            if (typeof value === 'string') {
              extracted[key] = value.substring(0, 500);
            } else if (typeof value === 'object') {
              extracted[key] = JSON.stringify(value).substring(0, 500);
            }
          }
        }
        compressed = JSON.stringify(extracted);
      } else {
        compressed = String(data);
      }
      
      return {
        type: 'json',
        content: compressed.substring(0, this.maxContentLength),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        type: 'json',
        content: JSON.stringify(data).substring(0, this.maxContentLength),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Compress RSS/XML feed
   */
  compressRSS(xml) {
    try {
      const $ = cheerio.load(xml, { xmlMode: true });
      const items = [];
      
      // Extract RSS items
      $('item').slice(0, 5).each((i, elem) => {
        const title = $(elem).find('title').text().trim();
        const description = $(elem).find('description').text().trim();
        const pubDate = $(elem).find('pubDate').text().trim();
        
        items.push({
          title: title.substring(0, 200),
          description: description.substring(0, 300),
          date: pubDate
        });
      });
      
      const compressed = items.map(item => 
        `${item.title}\n${item.description}\n${item.date || ''}`
      ).join('\n\n');
      
      return {
        type: 'rss',
        content: compressed.substring(0, this.maxContentLength),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Fallback: return raw XML (compressed)
      return {
        type: 'rss',
        content: xml.substring(0, this.maxContentLength),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Compress HTML content
   */
  compressHTML(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Remove scripts, styles, and other non-content
      $('script, style, noscript, nav, footer, header, aside').remove();
      
      // Extract key information
      const title = $('title').text().trim() || 
                   $('meta[property="og:title"]').attr('content') || 
                   $('h1').first().text().trim();
      
      const description = $('meta[name="description"]').attr('content') || 
                         $('meta[property="og:description"]').attr('content') || 
                         $('meta[name="twitter:description"]').attr('content') || '';
      
      // Extract main content
      const mainContent = $('main, article, .content, .post, .entry').first();
      let bodyText = '';
      
      if (mainContent.length > 0) {
        bodyText = mainContent.text().replace(/\s+/g, ' ').trim();
      } else {
        bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      }
      
      // Compress to key information
      const compressed = [
        `Title: ${title}`,
        description ? `Description: ${description}` : '',
        `Content: ${bodyText.substring(0, this.maxContentLength - title.length - description.length - 50)}`
      ].filter(Boolean).join('\n\n');
      
      return {
        type: 'html',
        content: compressed.substring(0, this.maxContentLength),
        url: url,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Fallback: extract text only
      const $ = cheerio.load(html);
      $('script, style').remove();
      return {
        type: 'html',
        content: $('body').text().replace(/\s+/g, ' ').trim().substring(0, this.maxContentLength),
        url: url,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Compress plain text
   */
  compressText(text) {
    // Remove excessive whitespace
    const cleaned = text.replace(/\s+/g, ' ').trim();
    
    return {
      type: 'text',
      content: cleaned.substring(0, this.maxContentLength),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Process real-time event: fetch → clean → compress → return
   * @param {string} source - URL or source identifier
   * @returns {Promise<Object>} Processed data ready for Gemini
   */
  async processRealtimeEvent(source) {
    try {
      // Step 1: Fetch from live source
      const rawData = await this.fetchAndClean(source);
      
      // Step 2: Data is already cleaned and compressed in fetchAndClean
      // Step 3: Return processed data (nothing saved)
      
      console.log(`✅ Real-time data processed: ${rawData.type} (${rawData.content.length} chars)`);
      
      return {
        success: true,
        data: rawData,
        source: source
      };
    } catch (error) {
      console.error(`❌ Real-time processing failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        source: source
      };
    }
  }
}

module.exports = RealtimeService;

