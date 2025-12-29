/**
 * Utility functions for detecting code and math content in messages
 */

/**
 * Detect if message contains code or math problem
 * @param {string} message - The message text to check
 * @returns {boolean} - True if code or math is detected
 */
function isCodeOrMathQuery(message) {
  if (!message) return false;
  
  const codePatterns = [
    /function|class|const|let|var|if|else|for|while|return|import|require|def|async|await/gi,
    /```[\s\S]*?```/g, // Code blocks
    /<code>[\s\S]*?<\/code>/gi,
    /console\.log|print\(|System\.out/gi
  ];
  
  const mathPatterns = [
    /\d+\s*[+\-×÷*/]\s*\d+/g, // Simple arithmetic
    /[=<>≤≥]\s*\d+/g, // Equations/inequalities
    /sqrt|sin|cos|tan|log|ln|π|pi|√/gi,
    /equation|formula|calculate|solve|បញ្ហាគណិត|រូបមន្ត|គណនា|ដោះស្រាយ/gi,
    /\^|\*\*|\^{/g // Exponents
  ];
  
  const hasCode = codePatterns.some(pattern => pattern.test(message));
  const hasMath = mathPatterns.some(pattern => pattern.test(message));
  
  return hasCode || hasMath;
}

/**
 * Clean text by removing LaTeX math delimiters that Telegram doesn't support
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text without LaTeX delimiters
 */
function cleanLaTeXFormatting(text) {
  let cleanedText = text.trim();
  
  // Remove LaTeX math delimiters ($ and $$) that Telegram doesn't support
  cleanedText = cleanedText
    .replace(/\$\$([^\$]+)\$\$/g, '$1') // Remove $$ ... $$
    .replace(/\$([^\$]+)\$/g, '$1')     // Remove $ ... $
    .replace(/\$\$/g, '')                // Remove any remaining $$
    .replace(/\$\s+/g, '')              // Remove $ followed by space
    .replace(/\s+\$/g, '')              // Remove $ preceded by space
    .replace(/\$([a-zA-Z0-9^_])/g, '$1') // Remove $ before alphanumeric/^/_
    .replace(/([a-zA-Z0-9_])\$/g, '$1'); // Remove $ after alphanumeric/_
  
  // Clean up any double spaces that might result
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

  return cleanedText;
}

module.exports = {
  isCodeOrMathQuery,
  cleanLaTeXFormatting
};

