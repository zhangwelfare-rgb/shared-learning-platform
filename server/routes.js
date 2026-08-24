'use strict';
const express = require('express');
const router = express.Router();
const { db, now, transaction } = require('./db');
const { config, gradeLabel, levelLabel } = require('./config');
const { hashPassword, verifyPassword, signToken, authMiddleware, requireRole } = require('./auth');
const ai = require('./ai');

// ---------- 工具 ----------
function insert(stmt, params) {
  const info = stmt.run(...params);
  return Number(info.lastInsertRowid);
}
function getLevel(userId) {
  const row = db.prepare('SELECT level FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  return row ? row.level : 'L3';
}
function changePointsInner(userId, amount, type, description, rmb = 0) {
  const u = db.prepare('SELECT points, rmb_balance FROM users WHERE id=?').get(userId);
  if (!u) throw new Error('用户不存在');
  const newPoints = u.points + amount;
  if (newPoints < 0) throw new Error('积分不足');
  if (rmb && rmb < 0 && u.rmb_balance + rmb < 0) throw new Error('人民币余额不足');
  db.prepare('UPDATE users SET points=?, rmb_balance=rmb_balance+? WHERE id=?').run(newPoints, rmb, userId);
  db.prepare('INSERT INTO points_tx (user_id,type,amount,rmb,description,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, type, amount, rmb, description, now());
  return newPoints;
}
function changePoints(userId, amount, type, description, rmb = 0) {
  return transaction(() => changePointsInner(userId, amount, type, description, rmb));
}
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, grade: u.grade, points: u.points, rmb_balance: u.rmb_balance, created_at: u.created_at };
}

// ---------- 认证 ----------
router.post('/auth/register', (req, res) => {
  const { username, password, role, grade } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const r = role === 'capable' || role === 'admin' ? role : 'learner';
  const g = r === 'learner' && grade ? Number(grade) : null;
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.status(409).json({ error: '用户名已被占用' });
  const id = insert(
    db.prepare('INSERT INTO users (username,password_hash,role,grade,points,rmb_balance,created_at) VALUES (?,?,?,?,?,?,?)'),
    [username, hashPassword(password), r, g, config.SIGNUP_BONUS, config.DEMO_RMB, now()]
  );
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: publicUser(user) });
});

// ---------- 元数据 ----------
router.get('/meta', (req, res) => {
  const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
  res.json({ subjects, packages: config.PURCHASE_PACKAGES, exchangeRate: config.EXCHANGE_RATE, gradeLabel, levelLabel });
});

// ---------- 知识点 ----------
router.get('/knowledge', (req, res) => {
  const { subject, grade, q } = req.query;
  const where = [];
  const params = [];
  if (subject) { where.push('subject=?'); params.push(subject); }
  if (grade) { where.push('grade_level=?'); params.push(Number(grade)); }
  if (q) { where.push('(topic LIKE ? OR explanation LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const sql = `SELECT kp.*, (SELECT COUNT(*) FROM approaches a WHERE a.kp_id=kp.id) AS approach_count
    FROM knowledge_points kp ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kp.id DESC LIMIT 100`;
  const rows = db.prepare(sql).all(...params);
  res.json({ items: rows.map(r => ({ ...r, gradeLabel: gradeLabel(r.grade_level) })) });
});

router.get('/knowledge/:id', (req, res) => {
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(req.params.id));
  if (!kp) return res.status(404).json({ error: '知识点不存在' });
  const approaches = db.prepare('SELECT a.*, u.username AS author_name FROM approaches a JOIN users u ON u.id=a.author_id WHERE a.kp_id=? ORDER BY (CASE WHEN a.rating_count>0 THEN a.rating_sum/a.rating_count ELSE 3 END) DESC').all(kp.id);
  res.json({ kp: { ...kp, gradeLabel: gradeLabel(kp.grade_level) }, approaches });
});

// 平台自动生成知识点（智能体）
router.post('/knowledge/generate', authMiddleware, async (req, res) => {
  const { subject, grade, topic } = req.body || {};
  if (!subject || !grade || !topic) return res.status(400).json({ error: '学科、年级、知识点主题必填' });
  try {
    const { explanation, example } = await ai.generateKnowledgePoint(subject, Number(grade), topic);
    const id = insert(
      db.prepare('INSERT INTO knowledge_points (subject,grade_level,topic,explanation,example,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
      [subject, Number(grade), topic, explanation, example, 'ai', req.user.id, 'active', now()]
    );
    res.json({ id, explanation, example });
  } catch (e) {
    res.status(500).json({ error: '生成失败：' + e.message });
  }
});

// 能力用户手动创建知识点
router.post('/knowledge', authMiddleware, requireRole('capable', 'admin'), (req, res) => {
  const { subject, grade, topic, explanation, example } = req.body || {};
  if (!subject || !grade || !topic || !explanation || !example) return res.status(400).json({ error: '字段不完整' });
  const id = insert(
    db.prepare('INSERT INTO knowledge_points (subject,grade_level,topic,explanation,example,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
    [subject, Number(grade), topic, explanation, example, 'user', req.user.id, 'active', now()]
  );
  res.json({ id });
});

// ---------- 思路（类论坛帖子）----------
router.get('/approaches', (req, res) => {
  const { kpId, category, authorId } = req.query;
  const where = [];
  const params = [];
  if (kpId) { where.push('a.kp_id=?'); params.push(Number(kpId)); }
  if (category) { where.push('a.category=?'); params.push(category); }
  if (authorId) { where.push('a.author_id=?'); params.push(Number(authorId)); }
  const sql = `SELECT a.*, u.username AS author_name, k.topic AS kp_topic
    FROM approaches a JOIN users u ON u.id=a.author_id JOIN knowledge_points k ON k.id=a.kp_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT 100`;
  res.json({ items: db.prepare(sql).all(...params) });
});

router.post('/approaches', authMiddleware, requireRole('capable', 'admin'), (req, res) => {
  const { kpId, title, content, category } = req.body || {};
  if (!kpId || !title || !content) return res.status(400).json({ error: '知识点、标题、内容必填' });
  const kp = db.prepare('SELECT id FROM knowledge_points WHERE id=?').get(Number(kpId));
  if (!kp) return res.status(404).json({ error: '知识点不存在' });
  const id = insert(
    db.prepare('INSERT INTO approaches (kp_id,title,content,category,author_id,created_at) VALUES (?,?,?,?,?,?)'),
    [Number(kpId), title, content, category || '综合', req.user.id, now()]
  );
  res.json({ id });
});

// 学习用户“学习(查看)”一条思路 → 消耗积分
router.post('/approaches/:id/study', authMiddleware, requireRole('learner', 'admin'), (req, res) => {
  const a = db.prepare('SELECT * FROM approaches WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: '思路不存在' });
  try {
    const balance = changePoints(req.user.id, -config.STUDY_COST, 'consume', `学习思路《${a.title}》消耗`, 0);
    res.json({ ok: true, points: balance });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 学习用户评分 / 采纳 → 平台记录、作者赚积分（自学习反馈）
router.post('/approaches/:id/feedback', authMiddleware, requireRole('learner', 'admin'), (req, res) => {
  const a = db.prepare('SELECT * FROM approaches WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: '思路不存在' });
  const rating = Number(req.body?.rating) || 3;
  const adopted = req.body?.adopted ? 1 : 0;
  try {
    const result = transaction(() => {
      const old = db.prepare('SELECT * FROM approach_feedback WHERE approach_id=? AND user_id=?').get(a.id, req.user.id);
      const oldAdopted = old ? old.adopted : 0;
      db.prepare('DELETE FROM approach_feedback WHERE approach_id=? AND user_id=?').run(a.id, req.user.id);
      db.prepare('INSERT INTO approach_feedback (approach_id,user_id,rating,adopted,created_at) VALUES (?,?,?,?,?)').run(a.id, req.user.id, rating, adopted, now());
      const agg = db.prepare('SELECT COALESCE(SUM(rating),0) AS s, COUNT(*) AS c, COALESCE(SUM(adopted),0) AS ad FROM approach_feedback WHERE approach_id=?').get(a.id);
      db.prepare('UPDATE approaches SET rating_sum=?, rating_count=?, adopted=? WHERE id=?').run(agg.s, agg.c, agg.ad, a.id);
      let authorReward = 0;
      if (adopted && !oldAdopted) {
        changePointsInner(a.author_id, config.ADOPT_REWARD, 'earn', `思路《${a.title}》被采纳`, 0);
        authorReward = config.ADOPT_REWARD;
      }
      return { authorReward };
    });
    res.json({ ok: true, authorReward: result.authorReward });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 分级测评 ----------
router.get('/assessment/questions', authMiddleware, (req, res) => {
  const grade = Number(req.query.grade) || (req.user.grade || 7);
  const rows = db.prepare('SELECT id, subject, question, options, difficulty FROM assessment_bank WHERE grade=? ORDER BY RANDOM() LIMIT 8').all(grade);
  if (rows.length < 4) {
    const fallback = db.prepare('SELECT id, subject, question, options, difficulty FROM assessment_bank WHERE grade BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 8').all(Math.max(1, grade - 1), Math.min(12, grade + 1));
    rows.push(...fallback);
  }
  const items = rows.slice(0, 8).map(r => ({ id: r.id, subject: r.subject, question: r.question, options: JSON.parse(r.options), difficulty: r.difficulty }));
  res.json({ grade, items });
});

router.post('/assessment/submit', authMiddleware, (req, res) => {
  const { grade, answers, criteria } = req.body || {};
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: '作答数据缺失' });
  const bank = db.prepare(`SELECT id, subject, answer FROM assessment_bank WHERE id IN (${Object.keys(answers).map(() => '?').join(',')})`).all(...Object.keys(answers).map(Number));
  const byId = {};
  bank.forEach(b => (byId[b.id] = b));
  let correct = 0, total = 0;
  const subjectsCovered = new Set();
  let subjectsTotal = new Set();
  bank.forEach(b => subjectsTotal.add(b.subject));
  for (const [id, ans] of Object.entries(answers)) {
    const b = byId[Number(id)];
    if (!b) continue;
    total++;
    subjectsCovered.add(b.subject);
    if (Number(ans) === b.answer) correct++;
  }
  if (total === 0) return res.status(400).json({ error: '未作答任何题目' });
  const accuracy = correct / total;
  let score = accuracy;
  const crit = criteria || 'balanced';
  if (crit === 'speed') score = accuracy * 0.95 + (total >= 8 ? 0.05 : 0);
  else if (crit === 'breadth') score = accuracy * 0.85 + 0.15 * (subjectsTotal.size ? subjectsCovered.size / subjectsTotal.size : 1);
  else if (crit === 'accuracy') score = accuracy;
  else score = accuracy; // balanced
  score = Math.round(score * 100);
  let level = 'L1';
  if (score >= 90) level = 'L5';
  else if (score >= 75) level = 'L4';
  else if (score >= 60) level = 'L3';
  else if (score >= 40) level = 'L2';
  insert(db.prepare('INSERT INTO assessments (user_id,grade,score,level,criteria,created_at) VALUES (?,?,?,?,?,?)'),
    [req.user.id, Number(grade) || req.user.grade || 7, score, level, crit, now()]);
  res.json({ score, level, levelLabel: levelLabel(level), criteria: crit, correct, total });
});

// ---------- 自学习匹配智能体 ----------
function rankApproaches(approaches, level) {
  const scored = approaches.map(a => {
    const quality = a.rating_count > 0 ? a.rating_sum / a.rating_count : 3.0;
    let score = quality * 2 + Math.min(a.adopted, 10) * 0.3;
    const len = (a.content || '').length;
    if (level === 'L1' || level === 'L2') score += Math.max(0, 400 - len) / 200; // 低等级：更短更易懂优先
    else if (level === 'L4' || level === 'L5') score += quality * 0.5;            // 高等级：重质量
    return { ...a, _score: Math.round(score * 100) / 100 };
  });
  scored.sort((x, y) => y._score - x._score);
  scored.forEach((a, i) => (a.recommended = i < 3));
  return scored;
}

router.post('/agent/match', authMiddleware, async (req, res) => {
  const { kpId, level } = req.body || {};
  if (!kpId) return res.status(400).json({ error: 'kpId 必填' });
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(kpId));
  if (!kp) return res.status(404).json({ error: '知识点不存在' });
  const lvl = level || (req.user.role === 'learner' ? getLevel(req.user.id) : 'L3');
  const approaches = db.prepare('SELECT a.*, u.username AS author_name FROM approaches a JOIN users u ON u.id=a.author_id WHERE a.kp_id=?').all(kp.id);
  const ranked = rankApproaches(approaches, lvl);
  let tailored = kp.explanation;
  try { tailored = await ai.tailorExplanation(kp, lvl); } catch (e) {}
  res.json({ kp: { ...kp, gradeLabel: gradeLabel(kp.grade_level) }, level: lvl, levelLabel: levelLabel(lvl), tailored, approaches: ranked });
});

// 平台自成长：为某知识点补充 AI 思路（当思路偏少或被低分时）
router.post('/agent/autoGrow', authMiddleware, async (req, res) => {
  const { kpId } = req.body || {};
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(kpId));
  if (!kp) return res.status(404).json({ error: '知识点不存在' });
  const existing = db.prepare('SELECT title FROM approaches WHERE kp_id=?').all(kp.id).map(a => a.title);
  try {
    const ap = await ai.generateApproach(kp, existing.join('、'));
    const id = insert(
      db.prepare('INSERT INTO approaches (kp_id,title,content,category,author_id,created_at) VALUES (?,?,?,?,?,?)'),
      [kp.id, ap.title, ap.content, ap.category || '综合', req.user.id, now()]
    );
    res.json({ ok: true, id, approach: ap });
  } catch (e) {
    res.status(500).json({ error: '自成长生成失败：' + e.message });
  }
});

// ---------- 积分中心 ----------
router.get('/points/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT points, rmb_balance FROM users WHERE id=?').get(req.user.id);
  res.json({ points: u.points, rmb_balance: u.rmb_balance });
});

router.get('/points/transactions', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM points_tx WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ items: rows });
});

router.get('/points/packages', (req, res) => res.json({ packages: config.PURCHASE_PACKAGES }));

// 人民币购买积分套餐
router.post('/points/purchase', authMiddleware, (req, res) => {
  const pkg = config.PURCHASE_PACKAGES.find(p => p.id === req.body?.packageId);
  if (!pkg) return res.status(400).json({ error: '套餐不存在' });
  try {
    const balance = changePoints(req.user.id, pkg.points, 'purchase', `购买${pkg.label}`, -pkg.rmb);
    res.json({ ok: true, points: balance, rmb_balance: db.prepare('SELECT rmb_balance FROM users WHERE id=?').get(req.user.id).rmb_balance });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 积分 ↔ 人民币兑换
router.post('/points/exchange', authMiddleware, (req, res) => {
  const { direction, amount } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: '数量无效' });
  try {
    let balance, rmb;
    if (direction === 'toPoints') {
      const rmbNeeded = amt / config.EXCHANGE_RATE;
      balance = changePoints(req.user.id, amt, 'exchange_in', `人民币兑换积分(${rmbNeeded}元)`, -rmbNeeded);
    } else if (direction === 'toRmb') {
      const rmbGain = amt / (config.EXCHANGE_RATE / 2); // 提现按半价折算
      balance = changePoints(req.user.id, -amt, 'exchange_out', `积分兑换人民币(${rmbGain}元)`, rmbGain);
    } else {
      return res.status(400).json({ error: '方向无效' });
    }
    rmb = db.prepare('SELECT rmb_balance FROM users WHERE id=?').get(req.user.id).rmb_balance;
    res.json({ ok: true, points: balance, rmb_balance: rmb });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 贡献榜（能力用户按积分排序）
router.get('/stats/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, points FROM users WHERE role IN ("capable","admin") ORDER BY points DESC LIMIT 10').all();
  res.json({ items: rows });
});

module.exports = router;
