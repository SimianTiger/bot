const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function requiredEnv(key) {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  DISCORD_TOKEN: requiredEnv('DISCORD_TOKEN'),
  DEEPGRAM_API_KEY: requiredEnv('DEEPGRAM_API_KEY'),
  GIT_REPO_URL: process.env.GIT_REPO_URL || null,
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  GROQ_BASE_URL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'Transcreve Bot',
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'bot@transcreve.local',
  SHOW_LOGS: process.env.SHOW_LOGS === 'true',
  SHOW_AUDIO_DEBUG: process.env.SHOW_AUDIO_DEBUG === 'true',
  COMMAND_PREFIX: process.env.COMMAND_PREFIX || '!',
  ENABLE_AUTO_CALIBRATION: process.env.ENABLE_AUTO_CALIBRATION === 'true',
  AUDIO_VAD_RMS_THRESHOLD: parseNumber(process.env.AUDIO_VAD_RMS_THRESHOLD, 220),
  AUDIO_MIN_GAIN: parseNumber(process.env.AUDIO_MIN_GAIN, 0.5),
  AUDIO_CLIP_THRESHOLD: parseNumber(process.env.AUDIO_CLIP_THRESHOLD, 27000),
  SEGMENT_END_MS: parseNumber(process.env.AUDIO_SEGMENT_END_MS, 1200),
  MAX_SEGMENT_MS: parseNumber(process.env.AUDIO_MAX_SEGMENT_MS, 25000),
  MIN_SEGMENT_MS: parseNumber(process.env.AUDIO_MIN_SEGMENT_MS, 300),
  TARGET_RMS: parseNumber(process.env.AUDIO_TARGET_RMS, 1800),
  MAX_GAIN: parseNumber(process.env.AUDIO_MAX_GAIN, 4.0),
};
