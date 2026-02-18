# Performance Optimization for 512MB RAM / 1 CPU

This document outlines optimizations implemented to handle high request volumes with limited resources.

## ✅ Implemented Optimizations

### 1. Limited Conversation History
- **Reduced from 40 to 20 messages** (10 user + 10 model pairs)
- **Auto-cleanup** of old conversations after 1 hour of inactivity
- **Maximum 100 active conversations** in memory (LRU eviction)
- **Automatic cleanup** runs every 30 minutes

### 2. Image Size Limits
- **Maximum 2MB per image** (configurable via `MAX_IMAGE_SIZE`)
- **Size check before download** to save bandwidth
- **Streaming with size limits** to prevent memory overflow
- **Automatic rejection** of oversized images

### 3. Request Rate Limiting
- **Max 10 concurrent requests** (configurable via `MAX_CONCURRENT_REQUESTS`)
- **Queue system** for overflow requests
- **Per-user rate limiting**: 5 requests/minute (configurable via `RATE_LIMIT_PER_USER`)
- **Automatic queue processing** when capacity available

### 4. Memory Management
- **Periodic cleanup** of old conversation history (every 30 minutes)
- **Garbage collection hints** when memory is high
- **Memory monitoring** every 5 minutes (development mode)
- **Automatic eviction** of oldest conversations when limit reached

### 5. Reduced Logging
- **Production mode**: Only errors and critical events
- **Development mode**: Full logging for debugging
- **Removed verbose logs** that waste CPU and I/O

### 6. Request Queue System
- **FIFO queue** for handling requests when at capacity
- **Non-blocking**: Users get rate limit message instead of timeout
- **Automatic processing** when slots become available

## 📊 Expected Performance

With these optimizations:
- **Memory usage**: ~150-300MB under normal load
- **Concurrent users**: Up to 10 simultaneous requests
- **Response time**: < 3 seconds per request (queue time excluded)
- **Conversation capacity**: 100 active conversations

## 🔧 Configuration

Add to your `.env` file to customize:

```env
# Conversation limits
MAX_CONVERSATION_HISTORY=20        # Messages per chat (default: 20)
MAX_CONVERSATIONS=100              # Max active chats (default: 100)
CONVERSATION_TTL=3600000          # 1 hour in ms (default: 3600000)

# Request limits
MAX_CONCURRENT_REQUESTS=10        # Simultaneous requests (default: 10)
RATE_LIMIT_PER_USER=5             # Requests per minute per user (default: 5)

# Image limits
MAX_IMAGE_SIZE=2097152            # 2MB in bytes (default: 2097152)

# Environment
NODE_ENV=production               # Set to 'production' to reduce logging
```

## 📈 Monitoring

### Memory Usage
Check memory in development mode (logs every 5 minutes):
```
💾 Memory: 180MB / 256MB | Active conversations: 15
```

### High Memory Warning
If memory exceeds 400MB, you'll see:
```
⚠️  High memory usage: 420MB / 512MB
```

### Conversation Cleanup
When cleanup runs:
```
🧹 Cleaned up 5 old conversations. Active: 95
```

## 🚀 Running with Optimizations

The optimizations are **automatically enabled**. No code changes needed!

To enable garbage collection hints (optional):
```bash
node --expose-gc server.js
```

## 💡 Tips for Maximum Performance

1. **Set `NODE_ENV=production`** to reduce logging overhead
2. **Monitor memory usage** regularly
3. **Adjust limits** based on your actual usage patterns
4. **Use `--expose-gc`** flag if memory issues persist
5. **Consider upgrading** if consistently hitting limits

## 🔍 Troubleshooting

### High Memory Usage
- Reduce `MAX_CONVERSATIONS` (default: 100)
- Reduce `MAX_CONVERSATION_HISTORY` (default: 20)
- Reduce `CONVERSATION_TTL` (default: 1 hour)

### Too Many Rate Limits
- Increase `RATE_LIMIT_PER_USER` (default: 5)
- Increase `MAX_CONCURRENT_REQUESTS` (default: 10)

### Slow Response Times
- Check if queue is backing up
- Consider increasing `MAX_CONCURRENT_REQUESTS`
- Monitor external API response times (Gemini, TTS)

