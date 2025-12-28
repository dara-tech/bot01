#!/bin/bash

# Initialize git if not already initialized
if [ ! -d .git ]; then
    git init
fi

# Add remote if not exists
if ! git remote | grep -q origin; then
    git remote add origin https://github.com/dara-tech/bot01.git
else
    git remote set-url origin https://github.com/dara-tech/bot01.git
fi

# Add all files
git add .

# Commit
git commit -m "Initial commit: Telegram bot with Gemini AI for Khmer responses" || echo "No changes to commit"

# Set main branch
git branch -M main

# Push to GitHub
git push -u origin main

