'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const { config } = require('./config');
const api = require('./routes');

const app = express();
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api', api);

// 静态前端
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA 回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(config.PORT, () => {
  console.log(`✅ 智学论坛 · 自学习智能体 已启动: http://localhost:${config.PORT}`);
  if (!config.DEEPSEEK_API_KEY) {
    console.log('ℹ️  未配置 DEEPSEEK_API_KEY，已启用学科模板兜底（仍可完整离线运行）。');
  }
});
