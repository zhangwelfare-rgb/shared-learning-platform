'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config } = require('./config');

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
}

// 角色校验：admin 拥有全部权限；其余需命中指定角色之一
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: '当前角色无此权限' });
  };
}

module.exports = { hashPassword, verifyPassword, signToken, authMiddleware, requireRole };
