const crypto = require('crypto');

// Генерация CSRF токена
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware для проверки CSRF токена
function csrfProtection(req, res, next) {
  // Пропускаем GET и HEAD запросы
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  // Проверяем наличие токена в заголовке или теле запроса
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  
  if (!token) {
    return res.status(403).json({ error: 'CSRF токен отсутствует' });
  }
  
  // Проверяем токен в сессии
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Неверный CSRF токен' });
  }
  
  // Генерируем новый токен после успешной проверки
  req.session.csrfToken = generateCsrfToken();
  next();
}

// Middleware для добавления CSRF токена в ответ
function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

module.exports = { csrfProtection, csrfToken, generateCsrfToken };
