'use strict';
const { db, now, transaction } = require('./db');
const { config, gradeLabel, levelLabel } = require('./config');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');
const ai = require('./ai');

// ---------- 微型路由（零依赖）----------
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

function matchPath(path, pattern) {
  const ps = pattern.split('/').filter(Boolean);
  const us = path.split('/').filter(Boolean);
  if (ps.length !== us.length) return null;
  const params = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(us[i]);
    else if (ps[i] !== us[i]) return null;
  }
  return params;
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
const ok = (res, data) => send(res, 200, data);

function authUser(req, res) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) { send(res, 401, { error: '请先登录' }); return null; }
  const u = verifyToken(t);
  if (!u) { send(res, 401, { error: '登录已失效，请重新登录' }); return null; }
  return u;
}
function roleOk(u, ...roles) { return u.role === 'admin' || roles.includes(u.role); }

async function dispatch(req, res, body, url) {
  const pathname = url.pathname;
  for (const r of routes) {
    if (r.method === req.method) {
      const params = matchPath(pathname, r.pattern);
      if (params) return await r.handler(req, res, params, url, body);
    }
  }
  send(res, 404, { error: '接口不存在' });
}

// ---------- 工具 ----------
function insert(stmt, params) { return Number(stmt.run(...params).lastInsertRowid); }
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
route('POST', '/api/auth/register', (req, res, p, url, body) => {
  const { username, password, role, grade } = body || {};
  if (!username || !password) return send(res, 400, { error: '用户名和密码必填' });
  const r = role === 'capable' || role === 'admin' ? role : 'learner';
  const g = r === 'learner' && grade ? Number(grade) : null;
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return send(res, 409, { error: '用户名已被占用' });
  const id = insert(
    db.prepare('INSERT INTO users (username,password_hash,role,grade,points,rmb_balance,created_at) VALUES (?,?,?,?,?,?,?)'),
    [username, hashPassword(password), r, g, config.SIGNUP_BONUS, config.DEMO_RMB, now()]
  );
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  return ok(res, { token: signToken(user), user: publicUser(user) });
});

route('POST', '/api/auth/login', (req, res, p, url, body) => {
  const { username, password } = body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return send(res, 401, { error: '用户名或密码错误' });
  return ok(res, { token: signToken(user), user: publicUser(user) });
});

route('GET', '/api/auth/me', (req, res) => {
  const u = authUser(req, res); if (!u) return;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  if (!user) return send(res, 404, { error: '用户不存在' });
  return ok(res, { user: publicUser(user) });
});

// ---------- 元数据 ----------
route('GET', '/api/meta', (req, res) => {
  const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
  return ok(res, { subjects, packages: config.PURCHASE_PACKAGES, exchangeRate: config.EXCHANGE_RATE, gradeLabel, levelLabel });
});

// ---------- 知识点 ----------
route('GET', '/api/knowledge', (req, res, p, url) => {
  const subject = url.searchParams.get('subject');
  const grade = url.searchParams.get('grade');
  const q = url.searchParams.get('q');
  const where = [], params = [];
  if (subject) { where.push('subject=?'); params.push(subject); }
  if (grade) { where.push('grade_level=?'); params.push(Number(grade)); }
  if (q) { where.push('(topic LIKE ? OR explanation LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const sql = `SELECT kp.*, (SELECT COUNT(*) FROM approaches a WHERE a.kp_id=kp.id) AS approach_count
    FROM knowledge_points kp ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kp.id DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  return ok(res, { items: rows.map(r => ({ ...r, gradeLabel: gradeLabel(r.grade_level) })) });
});

route('GET', '/api/knowledge/:id', (req, res, params) => {
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(params.id));
  if (!kp) return send(res, 404, { error: '知识点不存在' });
  const approaches = db.prepare('SELECT a.*, u.username AS author_name FROM approaches a JOIN users u ON u.id=a.author_id WHERE a.kp_id=? ORDER BY (CASE WHEN a.rating_count>0 THEN a.rating_sum/a.rating_count ELSE 3 END) DESC').all(kp.id);
  return ok(res, { kp: { ...kp, gradeLabel: gradeLabel(kp.grade_level) }, approaches });
});

// 平台自动生成知识点（智能体）
route('POST', '/api/knowledge/generate', async (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const { subject, grade, topic } = body || {};
  if (!subject || !grade || !topic) return send(res, 400, { error: '学科、年级、知识点主题必填' });
  try {
    const { explanation, example } = await ai.generateKnowledgePoint(subject, Number(grade), topic);
    const id = insert(
      db.prepare('INSERT INTO knowledge_points (subject,grade_level,topic,explanation,example,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
      [subject, Number(grade), topic, explanation, example, 'ai', u.id, 'active', now()]
    );
    return ok(res, { id, explanation, example });
  } catch (e) {
    return send(res, 500, { error: '生成失败：' + e.message });
  }
});

// 能力用户手动创建知识点
route('POST', '/api/knowledge', (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  if (!roleOk(u, 'capable')) return send(res, 403, { error: '当前角色无此权限' });
  const { subject, grade, topic, explanation, example } = body || {};
  if (!subject || !grade || !topic || !explanation || !example) return send(res, 400, { error: '字段不完整' });
  const id = insert(
    db.prepare('INSERT INTO knowledge_points (subject,grade_level,topic,explanation,example,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
    [subject, Number(grade), topic, explanation, example, 'user', u.id, 'active', now()]
  );
  return ok(res, { id });
});

// ---------- 思路（类论坛帖子）----------
route('GET', '/api/approaches', (req, res, p, url) => {
  const kpId = url.searchParams.get('kpId');
  const category = url.searchParams.get('category');
  const authorId = url.searchParams.get('authorId');
  const where = [], params = [];
  if (kpId) { where.push('a.kp_id=?'); params.push(Number(kpId)); }
  if (category) { where.push('a.category=?'); params.push(category); }
  if (authorId) { where.push('a.author_id=?'); params.push(Number(authorId)); }
  const sql = `SELECT a.*, u.username AS author_name, k.topic AS kp_topic
    FROM approaches a JOIN users u ON u.id=a.author_id JOIN knowledge_points k ON k.id=a.kp_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT 100`;
  return ok(res, { items: db.prepare(sql).all(...params) });
});

route('POST', '/api/approaches', (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  if (!roleOk(u, 'capable')) return send(res, 403, { error: '当前角色无此权限' });
  const { kpId, title, content, category } = body || {};
  if (!kpId || !title || !content) return send(res, 400, { error: '知识点、标题、内容必填' });
  if (!db.prepare('SELECT id FROM knowledge_points WHERE id=?').get(Number(kpId))) return send(res, 404, { error: '知识点不存在' });
  const id = insert(
    db.prepare('INSERT INTO approaches (kp_id,title,content,category,author_id,created_at) VALUES (?,?,?,?,?,?)'),
    [Number(kpId), title, content, category || '综合', u.id, now()]
  );
  return ok(res, { id });
});

// 学习用户“学习(查看)”一条思路 → 消耗积分
route('POST', '/api/approaches/:id/study', (req, res, params) => {
  const u = authUser(req, res); if (!u) return;
  if (!roleOk(u, 'learner')) return send(res, 403, { error: '当前角色无此权限' });
  const a = db.prepare('SELECT * FROM approaches WHERE id=?').get(Number(params.id));
  if (!a) return send(res, 404, { error: '思路不存在' });
  try {
    const balance = changePoints(u.id, -config.STUDY_COST, 'consume', `学习思路《${a.title}》消耗`, 0);
    return ok(res, { ok: true, points: balance });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

// 学习用户评分 / 采纳 → 平台记录、作者赚积分（自学习反馈）
route('POST', '/api/approaches/:id/feedback', (req, res, params, url, body) => {
  const u = authUser(req, res); if (!u) return;
  if (!roleOk(u, 'learner')) return send(res, 403, { error: '当前角色无此权限' });
  const a = db.prepare('SELECT * FROM approaches WHERE id=?').get(Number(params.id));
  if (!a) return send(res, 404, { error: '思路不存在' });
  const rating = Number(body?.rating) || 3;
  const adopted = body?.adopted ? 1 : 0;
  try {
    const result = transaction(() => {
      const old = db.prepare('SELECT * FROM approach_feedback WHERE approach_id=? AND user_id=?').get(a.id, u.id);
      const oldAdopted = old ? old.adopted : 0;
      db.prepare('DELETE FROM approach_feedback WHERE approach_id=? AND user_id=?').run(a.id, u.id);
      db.prepare('INSERT INTO approach_feedback (approach_id,user_id,rating,adopted,created_at) VALUES (?,?,?,?,?)').run(a.id, u.id, rating, adopted, now());
      const agg = db.prepare('SELECT COALESCE(SUM(rating),0) AS s, COUNT(*) AS c, COALESCE(SUM(adopted),0) AS ad FROM approach_feedback WHERE approach_id=?').get(a.id);
      db.prepare('UPDATE approaches SET rating_sum=?, rating_count=?, adopted=? WHERE id=?').run(agg.s, agg.c, agg.ad, a.id);
      let authorReward = 0;
      if (adopted && !oldAdopted) {
        changePointsInner(a.author_id, config.ADOPT_REWARD, 'earn', `思路《${a.title}》被采纳`, 0);
        authorReward = config.ADOPT_REWARD;
      }
      return { authorReward };
    });
    return ok(res, { ok: true, authorReward: result.authorReward });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

// ---------- 分级测评 ----------
route('GET', '/api/assessment/questions', (req, res, p, url) => {
  const u = authUser(req, res); if (!u) return;
  const grade = Number(url.searchParams.get('grade')) || (u.grade || 7);
  const rows = db.prepare('SELECT id, subject, question, options, difficulty FROM assessment_bank WHERE grade=? ORDER BY RANDOM() LIMIT 8').all(grade);
  if (rows.length < 4) {
    const fallback = db.prepare('SELECT id, subject, question, options, difficulty FROM assessment_bank WHERE grade BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 8').all(Math.max(1, grade - 1), Math.min(12, grade + 1));
    rows.push(...fallback);
  }
  const items = rows.slice(0, 8).map(r => ({ id: r.id, subject: r.subject, question: r.question, options: JSON.parse(r.options), difficulty: r.difficulty }));
  return ok(res, { grade, items });
});

route('POST', '/api/assessment/submit', (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const { grade, answers, criteria } = body || {};
  if (!answers || typeof answers !== 'object') return send(res, 400, { error: '作答数据缺失' });
  const ids = Object.keys(answers).map(Number);
  const bank = db.prepare(`SELECT id, subject, answer FROM assessment_bank WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = {};
  bank.forEach(b => (byId[b.id] = b));
  let correct = 0, total = 0;
  const subjectsCovered = new Set();
  const subjectsTotal = new Set();
  bank.forEach(b => subjectsTotal.add(b.subject));
  for (const [id, ans] of Object.entries(answers)) {
    const b = byId[Number(id)];
    if (!b) continue;
    total++;
    subjectsCovered.add(b.subject);
    if (Number(ans) === b.answer) correct++;
  }
  if (total === 0) return send(res, 400, { error: '未作答任何题目' });
  const accuracy = correct / total;
  const crit = criteria || 'balanced';
  let score = accuracy;
  if (crit === 'speed') score = accuracy * 0.95 + (total >= 8 ? 0.05 : 0);
  else if (crit === 'breadth') score = accuracy * 0.85 + 0.15 * (subjectsTotal.size ? subjectsCovered.size / subjectsTotal.size : 1);
  score = Math.round(score * 100);
  let level = 'L1';
  if (score >= 90) level = 'L5';
  else if (score >= 75) level = 'L4';
  else if (score >= 60) level = 'L3';
  else if (score >= 40) level = 'L2';
  insert(db.prepare('INSERT INTO assessments (user_id,grade,score,level,criteria,created_at) VALUES (?,?,?,?,?,?)'),
    [u.id, Number(grade) || u.grade || 7, score, level, crit, now()]);
  return ok(res, { score, level, levelLabel: levelLabel(level), criteria: crit, correct, total });
});

// ---------- 自学习匹配智能体 ----------
function rankApproaches(approaches, level) {
  const scored = approaches.map(a => {
    const quality = a.rating_count > 0 ? a.rating_sum / a.rating_count : 3.0;
    let score = quality * 2 + Math.min(a.adopted, 10) * 0.3;
    const len = (a.content || '').length;
    if (level === 'L1' || level === 'L2') score += Math.max(0, 400 - len) / 200;
    else if (level === 'L4' || level === 'L5') score += quality * 0.5;
    return { ...a, _score: Math.round(score * 100) / 100 };
  });
  scored.sort((x, y) => y._score - x._score);
  scored.forEach((a, i) => (a.recommended = i < 3));
  return scored;
}

route('POST', '/api/agent/match', async (req, res, params, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const { kpId, level } = body || {};
  if (!kpId) return send(res, 400, { error: 'kpId 必填' });
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(kpId));
  if (!kp) return send(res, 404, { error: '知识点不存在' });
  const lvl = level || (u.role === 'learner' ? getLevel(u.id) : 'L3');
  const approaches = db.prepare('SELECT a.*, u.username AS author_name FROM approaches a JOIN users u ON u.id=a.author_id WHERE a.kp_id=?').all(kp.id);
  const ranked = rankApproaches(approaches, lvl);
  let tailored = kp.explanation;
  try { tailored = await ai.tailorExplanation(kp, lvl); } catch (e) {}
  return ok(res, { kp: { ...kp, gradeLabel: gradeLabel(kp.grade_level) }, level: lvl, levelLabel: levelLabel(lvl), tailored, approaches: ranked });
});

// 平台自成长：为某知识点补充 AI 思路
route('POST', '/api/agent/autoGrow', async (req, res, params, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const { kpId } = body || {};
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(Number(kpId));
  if (!kp) return send(res, 404, { error: '知识点不存在' });
  const existing = db.prepare('SELECT title FROM approaches WHERE kp_id=?').all(kp.id).map(a => a.title);
  try {
    const ap = await ai.generateApproach(kp, existing.join('、'));
    const id = insert(
      db.prepare('INSERT INTO approaches (kp_id,title,content,category,author_id,created_at) VALUES (?,?,?,?,?,?)'),
      [kp.id, ap.title, ap.content, ap.category || '综合', u.id, now()]
    );
    return ok(res, { ok: true, id, approach: ap });
  } catch (e) {
    return send(res, 500, { error: '自成长生成失败：' + e.message });
  }
});

// ---------- 积分中心 ----------
route('GET', '/api/points/me', (req, res) => {
  const u = authUser(req, res); if (!u) return;
  const row = db.prepare('SELECT points, rmb_balance FROM users WHERE id=?').get(u.id);
  return ok(res, { points: row.points, rmb_balance: row.rmb_balance });
});

route('GET', '/api/points/transactions', (req, res) => {
  const u = authUser(req, res); if (!u) return;
  const rows = db.prepare('SELECT * FROM points_tx WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);
  return ok(res, { items: rows });
});

route('GET', '/api/points/packages', (req, res) => ok(res, { packages: config.PURCHASE_PACKAGES }));

route('POST', '/api/points/purchase', (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const pkg = config.PURCHASE_PACKAGES.find(x => x.id === body?.packageId);
  if (!pkg) return send(res, 400, { error: '套餐不存在' });
  try {
    const balance = changePoints(u.id, pkg.points, 'purchase', `购买${pkg.label}`, -pkg.rmb);
    const rmb_balance = db.prepare('SELECT rmb_balance FROM users WHERE id=?').get(u.id).rmb_balance;
    return ok(res, { ok: true, points: balance, rmb_balance });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

route('POST', '/api/points/exchange', (req, res, p, url, body) => {
  const u = authUser(req, res); if (!u) return;
  const { direction, amount } = body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return send(res, 400, { error: '数量无效' });
  try {
    if (direction === 'toPoints') {
      const rmbNeeded = amt / config.EXCHANGE_RATE;
      changePoints(u.id, amt, 'exchange_in', `人民币兑换积分(${rmbNeeded}元)`, -rmbNeeded);
    } else if (direction === 'toRmb') {
      const rmbGain = amt / (config.EXCHANGE_RATE / 2);
      changePoints(u.id, -amt, 'exchange_out', `积分兑换人民币(${rmbGain}元)`, rmbGain);
    } else {
      return send(res, 400, { error: '方向无效' });
    }
    const row = db.prepare('SELECT points, rmb_balance FROM users WHERE id=?').get(u.id);
    return ok(res, { ok: true, points: row.points, rmb_balance: row.rmb_balance });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

// 贡献榜
route('GET', '/api/stats/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, points FROM users WHERE role IN ("capable","admin") ORDER BY points DESC LIMIT 10').all();
  return ok(res, { items: rows });
});

module.exports = { dispatch };
