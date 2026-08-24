'use strict';
require('dotenv').config();
const path = require('path');

const config = {
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET: process.env.JWT_SECRET || 'shared-learning-dev-secret-change-me',
  DB_PATH: path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db')),
  // AI 智能体（可选，未配置则用学科模板兜底）
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_BASE: process.env.DEEPSEEK_BASE || 'https://api.deepseek.com',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  // 积分经济
  EXCHANGE_RATE: Number(process.env.EXCHANGE_RATE || 10), // 1 元 = 10 积分
  SIGNUP_BONUS: Number(process.env.SIGNUP_BONUS || 20),
  DEMO_RMB: Number(process.env.DEMO_RMB || 50),
  STUDY_COST: Number(process.env.STUDY_COST || 3),
  ADOPT_REWARD: Number(process.env.ADOPT_REWARD || 10),
  PURCHASE_PACKAGES: [
    { id: 'p1', rmb: 10, points: 100, label: '入门包' },
    { id: 'p2', rmb: 30, points: 350, label: '标准包（送50）' },
    { id: 'p3', rmb: 100, points: 1200, label: '畅学包（送200）' },
  ],
};

function gradeLabel(g) {
  g = Number(g);
  if (g >= 1 && g <= 6) return '小学' + '一二三四五六'[g - 1] + '年级';
  if (g >= 7 && g <= 9) return '初中' + '一二三'[g - 7] + '年级';
  if (g >= 10 && g <= 12) return '高中' + '一二三'[g - 10] + '年级';
  return g + '年级';
}
function levelLabel(l) {
  return { L1: 'L1 启蒙', L2: 'L2 入门', L3: 'L3 进阶', L4: 'L4 熟练', L5: 'L5 精通' }[l] || l;
}

module.exports = { config, gradeLabel, levelLabel };
