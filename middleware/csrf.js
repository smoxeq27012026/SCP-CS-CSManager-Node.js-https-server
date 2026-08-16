const crypto = require('crypto');

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  
  if (!token) {
    return res.status(403).json({ error: 'CSRF токен отсутствует' });
  }
  
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Неверный CSRF токен' });
  }
  next();
}

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

module.exports = { csrfProtection, csrfToken, generateCsrfToken };
