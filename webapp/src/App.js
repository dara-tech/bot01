import React, { useState, useEffect, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { 
  FaRobot, 
  FaShieldAlt, 
  FaSatelliteDish, 
  FaPaperPlane,
  FaTerminal,
  FaCog
} from 'react-icons/fa';
import './App.css';

// Message Content Component with Markdown Support
const MessageContent = ({ text, type }) => {
  // For system messages, keep simple text
  if (type === 'system') {
    return (
      <span className="message-content">
        {text.split('\n').map((line, i) => (
          <React.Fragment key={i}>
            {line}
            {i < text.split('\n').length - 1 && <br />}
          </React.Fragment>
        ))}
      </span>
    );
  }

  // For user and AI messages, use markdown
  // Use remark-breaks plugin behavior: preserve line breaks
  return (
    <div className="message-content markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Custom styling for markdown elements
          p: ({ node, ...props }) => <p className="markdown-p" {...props} />,
          h1: ({ node, ...props }) => <h1 className="markdown-h1" {...props} />,
          h2: ({ node, ...props }) => <h2 className="markdown-h2" {...props} />,
          h3: ({ node, ...props }) => <h3 className="markdown-h3" {...props} />,
          ul: ({ node, ...props }) => <ul className="markdown-ul" {...props} />,
          ol: ({ node, ...props }) => <ol className="markdown-ol" {...props} />,
          li: ({ node, ...props }) => <li className="markdown-li" {...props} />,
          code: ({ node, inline, ...props }) => 
            inline ? (
              <code className="markdown-inline-code" {...props} />
            ) : (
              <code className="markdown-code-block" {...props} />
            ),
          pre: ({ node, ...props }) => <pre className="markdown-pre" {...props} />,
          blockquote: ({ node, ...props }) => <blockquote className="markdown-blockquote" {...props} />,
          strong: ({ node, ...props }) => <strong className="markdown-strong" {...props} />,
          em: ({ node, ...props }) => <em className="markdown-em" {...props} />,
          a: ({ node, ...props }) => <a className="markdown-link" {...props} target="_blank" rel="noopener noreferrer" />,
          hr: ({ node, ...props }) => <hr className="markdown-hr" {...props} />,
          table: ({ node, ...props }) => <table className="markdown-table" {...props} />,
          thead: ({ node, ...props }) => <thead className="markdown-thead" {...props} />,
          tbody: ({ node, ...props }) => <tbody className="markdown-tbody" {...props} />,
          tr: ({ node, ...props }) => <tr className="markdown-tr" {...props} />,
          th: ({ node, ...props }) => <th className="markdown-th" {...props} />,
          td: ({ node, ...props }) => <td className="markdown-td" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemOnline, setSystemOnline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    cursorBlink: true,
    soundFx: false,
    matrixBg: true
  });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    // Initialize Telegram Web App
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor('#0a0a0a');
    WebApp.setBackgroundColor('#0a0a0a');
    
    // Boot sequence
    setTimeout(() => {
      bootSequence();
    }, 500);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Cursor blink animation
    if (settings.cursorBlink) {
      const interval = setInterval(() => {
        setCursorVisible(prev => !prev);
      }, 530);
      return () => clearInterval(interval);
    }
  }, [settings.cursorBlink]);

  const bootSequence = () => {
    const bootMessages = [
      { text: '> Initializing neural core...', type: 'system', delay: 300 },
      { text: '> Loading encryption protocols...', type: 'system', delay: 400 },
      { text: '> Connecting to PP-CITY-01 node...', type: 'system', delay: 300 },
      { text: '> Access granted.', type: 'system', delay: 400 },
      { text: '> System online.', type: 'system', delay: 300 },
      { 
        text: 'សួស្តី! 👋\n\nខ្ញុំជា **Rabica** - TOP 1 HACKER ON EARTH!\nមានអ្វីអាចជួយបានទេ? 😊', 
        type: 'ai', 
        delay: 500 
      }
    ];

    bootMessages.forEach((msg, index) => {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          text: msg.text,
          type: msg.type,
          timestamp: new Date()
        }]);
        if (index === bootMessages.length - 1) {
          setSystemOnline(true);
        }
      }, bootMessages.slice(0, index).reduce((acc, m) => acc + m.delay, 0) + msg.delay);
    });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || loading || !systemOnline) return;

    // Add user message immediately
    const userMessage = {
      text,
      type: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setLoading(true);

    try {
      const user = WebApp.initDataUnsafe?.user;
      const chatId = user?.id || WebApp.initDataUnsafe?.user?.id;

      const response = await axios.post('/api/message', {
        message: text,
        userId: user?.id,
        chatId: chatId
      });

      const botMessage = {
        text: response.data.response || 'មានបញ្ហាបន្តិច...',
        type: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      const errorMessage = {
        text: '> Error: Connection failed. Retrying...',
        type: 'system',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getMessagePrefix = (type) => {
    switch(type) {
      case 'system':
        return '>';
      case 'user':
        return '$';
      case 'ai':
        return '#';
      default:
        return '>';
    }
  };

  const getMessageClass = (type) => {
    switch(type) {
      case 'system':
        return 'system-msg';
      case 'user':
        return 'user-msg';
      case 'ai':
        return 'ai-msg';
      default:
        return '';
    }
  };

  return (
    <div className="cyber-app">
      {/* Matrix Background */}
      {settings.matrixBg && <div className="matrix-bg"></div>}
      
      {/* System Status Header */}
      <div className="system-header">
        <div className="header-left">
          <FaRobot className="header-icon" />
          <span className="header-title">RABICA</span>
          <span className={`status-indicator ${systemOnline ? 'online' : 'offline'}`}>
            {systemOnline ? '● ONLINE' : '○ OFFLINE'}
          </span>
        </div>
        <div className="header-right">
          <div className="status-item">
            <FaShieldAlt className="status-icon" />
            <span>ENCRYPTION: AES-256</span>
          </div>
          <div className="status-item">
            <FaSatelliteDish className="status-icon" />
            <span>NODE: PP-CITY-01</span>
          </div>
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
          >
            <FaCog />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-header">
            <h3>⚙️ SYSTEM CONFIG</h3>
            <button onClick={() => setShowSettings(false)}>✕</button>
          </div>
          <div className="settings-content">
            <label>
              <input
                type="checkbox"
                checked={settings.cursorBlink}
                onChange={(e) => setSettings({...settings, cursorBlink: e.target.checked})}
              />
              CURSOR BLINK
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.soundFx}
                onChange={(e) => setSettings({...settings, soundFx: e.target.checked})}
              />
              SOUND FX
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.matrixBg}
                onChange={(e) => setSettings({...settings, matrixBg: e.target.checked})}
              />
              MATRIX BG
            </label>
          </div>
        </div>
      )}

      {/* Terminal Chat Area */}
      <div className="terminal-container">
        <div className="chat-log" ref={messagesEndRef}>
          {messages.map((msg, index) => (
            <div key={index} className={`message ${getMessageClass(msg.type)}`}>
              <span className="message-prefix">{getMessagePrefix(msg.type)}</span>
              <MessageContent text={msg.text} type={msg.type} />
            </div>
          ))}
          {loading && (
            <div className="message system-msg">
              <span className="message-prefix">></span>
              <span className="message-content">
                AI is decrypting response
                <span className="loading-dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Command Input Console */}
      <div className="input-console">
        <FaTerminal className="input-icon" />
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="type command_"
          disabled={loading || !systemOnline}
          className="command-input"
        />
        <span className={`cursor ${cursorVisible && settings.cursorBlink ? 'visible' : ''}`}>|</span>
        <button
          onClick={sendMessage}
          disabled={loading || !inputText.trim() || !systemOnline}
          className="send-btn"
        >
          <FaPaperPlane />
        </button>
      </div>
    </div>
  );
}

export default App;
