const router = require("express").Router();
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const supabase = require("../config/supabase");

router.use(async (req, res, next) => {
  // Пропускаем публичные маршруты
  const publicPaths = ["/2fa", "/2fa/verify", "/2fa/status", "/2fa/enable", "/2fa/confirm-enable", "/2fa/disable"];
  if (publicPaths.some(path => req.path === path)) {
    return next();
  }
  
  // Если нет пользователя - пропускаем (редирект на login сделает другой middleware)
  if (!req.user) return next();
  
  // Проверяем, включена ли 2FA у пользователя
  const { data: player } = await supabase
    .from("players")
    .select("totp_enabled")
    .eq("discord_id", req.user.id)
    .single();
  
  // Если 2FA включена, но не подтверждена в этой сессии - блокируем
  if (player?.totp_enabled && !req.session.totpVerified) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/auth/2fa");
  }
  
  next();
});

router.get("/2fa", (req, res) => {
  if (!req.user) return res.redirect("/auth/login");
  res.sendFile(require("path").join(__dirname, "..", "views", "2fa.html"));
});

// Проверка кода
router.post("/2fa/verify", async (req, res) => {
  if (!req.user) return res.json({ success: false, error: "Not logged in" });

  const { code } = req.body;
  const { data: player } = await supabase
    .from("players")
    .select("totp_secret")
    .eq("discord_id", req.user.id)
    .single();

  if (!player?.totp_secret)
    return res.json({ success: false, error: "2FA не настроена" });

  const verified = speakeasy.totp.verify({
    secret: player.totp_secret,
    encoding: "base32",
    token: code,
    window: 1,
  });

  if (verified) {
    req.session.totpVerified = true;
    return res.json({
      success: true,
      redirect: `/${req.user.id}/dashboard/users`,
    });
  }

  res.json({ success: false, error: "Неверный код" });
});


router.post("/2fa/enable", async (req, res) => {
  if (!req.user) return res.json({ success: false, error: "Not logged in" });
  
  const secret = speakeasy.generateSecret({
    name: `DELTAxEX:${req.user.username}`,
  });
  
  await supabase
    .from("players")
    .update({ totp_secret: secret.base32 })
    .eq("discord_id", req.user.id);
  
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ success: true, qr: qrDataUrl, secret: secret.base32 });
});


// Подтверждение включения
router.post("/2fa/confirm-enable", async (req, res) => {
  if (!req.user) return res.json({ success: false, error: "Not logged in" });

  const { code } = req.body;
  const { data: player } = await supabase
    .from("players")
    .select("totp_secret")
    .eq("discord_id", req.user.id)
    .single();

  if (!player?.totp_secret)
    return res.json({
      success: false,
      error: "Сначала запросите включение 2FA",
    });

  const verified = speakeasy.totp.verify({
    secret: player.totp_secret,
    encoding: "base32",
    token: code,
    window: 1,
  });

  if (verified) {
    await supabase
      .from("players")
      .update({ totp_enabled: true })
      .eq("discord_id", req.user.id);

    req.session.totpVerified = true;
    return res.json({ success: true });
  }

  res.json({ success: false, error: "Неверный код" });
});


// Подтверждение включения 2FA
router.post("/2fa/confirm-enable", async (req, res) => {
  if (!req.user) return res.json({ success: false, error: "Not logged in" });

  const { code } = req.body;
  const { data: player } = await supabase
    .from("players")
    .select("totp_secret")
    .eq("discord_id", req.user.id)
    .single();

  if (!player?.totp_secret)
    return res.json({
      success: false,
      error: "Сначала запросите включение 2FA",
    });

  const verified = speakeasy.totp.verify({
    secret: player.totp_secret,
    encoding: "base32",
    token: code,
    window: 1,
  });

  if (verified) {
    await supabase
      .from("players")
      .update({ totp_enabled: true })
      .eq("discord_id", req.user.id);

    req.session.totpVerified = true;
    return res.json({ success: true });
  }

  res.json({ success: false, error: "Неверный код" });
});

// Отключение 2FA
router.post("/2fa/disable", async (req, res) => {
  if (!req.user) return res.json({ success: false, error: "Not logged in" });
  
  const { code } = req.body;
  const { data: player } = await supabase
    .from("players")
    .select("totp_secret")
    .eq("discord_id", req.user.id)
    .single();
  
  if (!player?.totp_secret)
    return res.json({ success: false, error: "2FA не включена" });
  
  const verified = speakeasy.totp.verify({
    secret: player.totp_secret,
    encoding: "base32",
    token: code,
    window: 1,
  });
  
  if (verified) {
    await supabase
      .from("players")
      .update({ totp_enabled: false, totp_secret: null })
      .eq("discord_id", req.user.id);
    return res.json({ success: true });
  }
  
  res.json({ success: false, error: "Неверный код" });
});

// Статус 2FA
router.get("/2fa/status", async (req, res) => {
  if (!req.user) return res.json({ enabled: false });
  
  const { data: player } = await supabase
    .from("players")
    .select("totp_enabled")
    .eq("discord_id", req.user.id)
    .single();
  
  res.json({ enabled: player?.totp_enabled || false });
});

module.exports = router;
