const crypto = require('crypto');

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn('⚠️ TURNSTILE_SECRET_KEY не настроен — капча отключена');
    return true;
  }

  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', token);
  if (ip) formData.append('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData
  });

  const data = await response.json();
  return data.success === true;
}

async function requireCaptcha(req, res, next) {
  if (req.session.captchaVerified) {
    return next();
  }

  const token = req.body['cf-turnstile-response'] || req.headers['x-turnstile-token'];
  if (token) {
    const ip = req.ip || req.connection.remoteAddress;
    const isValid = await verifyTurnstile(token, ip);
    if (isValid) {
      req.session.captchaVerified = true;
      return res.json({ success: true });
    }
    return res.status(400).json({ success: false, error: 'Неверная капча' });
  }
  
  req.session.returnTo = req.originalUrl;
  res.render('verify-captcha', {
    csrfToken: req.session.csrfToken || '',
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
  });
}

module.exports = { verifyTurnstile, requireCaptcha };
