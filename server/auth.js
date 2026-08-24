'use strict';
const crypto = require('crypto');
const { config } = require('./config');

// ---- 密码哈希：scrypt（Node 内置，免 bcrypt 依赖）----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(hashHex, 'hex');
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch (e) {
    return false;
  }
}

// ---- JWT：HS256（Node 内置 HMAC，免 jsonwebtoken 依赖）----
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    id: user.id, username: user.username, role: user.role,
    iat: now, exp: now + 30 * 24 * 3600,
  }));
  const sig = crypto.createHmac('sha256', config.JWT_SECRET).update(header + '.' + payload).digest('base64url').replace(/=+$/g, '');
  return `${header}.${payload}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, p, s] = String(token).split('.');
    const expect = crypto.createHmac('sha256', config.JWT_SECRET).update(h + '.' + p).digest('base64url').replace(/=+$/g, '');
    if (expect !== s) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
