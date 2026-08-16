const router = require('express').Router();
const { verifyTurnstile } = require('../middleware/captcha');

router.get('/verify-captcha', (req, res) => {
  res.render('verify-captcha', {
    csrfToken: req.session.csrfToken || '',
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
  });
});

router.post('/verify-captcha', async (req, res) => {
  const token = req.body['cf-turnstile-response'] || req.headers['x-turnstile-token'];
  if (!token) {
    return res.status(400).json({ success: false, error: 'Токен не передан' });
  }

  const ip = req.ip || req.connection.remoteAddress;
  const isValid = await verifyTurnstile(token, ip);

  if (isValid) {
    req.session.captchaVerified = true;
    const returnTo = req.session.returnTo || `/${req.user?.id || ''}/dashboard/users`;
    return res.json({ success: true, redirect: returnTo });
  }

  res.status(400).json({ success: false, error: 'Неверная капча' });
});

module.exports = router;
