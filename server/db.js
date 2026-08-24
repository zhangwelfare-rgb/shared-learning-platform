'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new DatabaseSync(config.DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner',
  grade INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  rmb_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  topic TEXT NOT NULL,
  explanation TEXT NOT NULL,
  example TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  created_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kp_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  author_id INTEGER NOT NULL,
  adopted INTEGER NOT NULL DEFAULT 0,
  rating_sum REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (kp_id) REFERENCES knowledge_points(id)
);

CREATE TABLE IF NOT EXISTS approach_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approach_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  adopted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (approach_id, user_id)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  grade INTEGER NOT NULL,
  score REAL NOT NULL,
  level TEXT NOT NULL,
  criteria TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade INTEGER NOT NULL,
  subject TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  answer INTEGER NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS points_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  rmb REAL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

function now() {
  return new Date().toISOString();
}

// 简易事务封装
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, now, transaction };
