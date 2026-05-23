const router = require("express").Router();
const passport = require("passport");
const axios = require("axios");
const supabase = require("../config/supabase");

// Вход через Discord
router.get("/login", passport.authenticate("discord"));

// Callback после входа
router.get(
  "/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  async (req, res) => {
    // 🔥 Сбрасываем 2FA при новом входе
    req.session.totpVerified = false;

    try {
      await axios.post(process.env.WEBHOOK_URL, {
        embeds: [
          {
            title: "✅ Авторизация",
            description: `**${req.user.username}** вошёл в систему`,
            color: 0x3b9d6f,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (e) {
      console.error("Webhook error:", e.message);
    }

    // Проверяем, включена ли 2FA
    const { data: player } = await supabase
      .from("players")
      .select("totp_enabled")
      .eq("discord_id", req.user.id)
      .single();

    if (player?.totp_enabled) {
      // Перенаправляем на страницу 2FA
      return res.redirect("/auth/2fa");
    }

    // Если 2FA не включена — сразу в дашборд
    res.redirect(`/${req.user.id}/dashboard/users`);
  }
);

// Вход через ключ доступа
router.post("/key", async (req, res) => {
  const { key } = req.body;
  if (!key || !key.startsWith("dexk_")) {
    return res.status(400).json({ error: "Неверный формат ключа" });
  }

  const { data: player } = await supabase
    .from("players")
    .select("discord_id, username, avatar, totp_enabled, access_key")
    .eq("access_key", key)
    .single();

  if (!player) {
    return res.status(403).json({ error: "Ключ не найден" });
  }

  // Автоматически логиним пользователя (создаём фейковый профиль)
  const user = {
    id: player.discord_id,
    username: player.username,
    avatar: player.avatar,
  };

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    req.session.totpVerified = true; // Ключ уже подтверждён 2FA
    res.json({
      success: true,
      redirect: `/${player.discord_id}/dashboard/users`,
    });
  });
});

// Выход
router.get("/logout", (req, res, next) => {
  const username = req.user?.username || "Unknown";
  req.logout((err) => {
    if (err) return next(err);
    req.session.totpVerified = false;
    axios
      .post(process.env.WEBHOOK_URL, {
        embeds: [
          {
            title: "🚪 Выход",
            description: `**${username}** вышел из системы`,
            color: 0xe74c3c,
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .catch(() => {});
    res.redirect("/");
  });
});

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get("/google/callback", passport.authenticate("google", { failureRedirect: "/" }), async (req, res) => {
  req.session.totpVerified = false;

  try {
    await axios.post(process.env.WEBHOOK_URL, {
      embeds: [{
        title: "✅ Авторизация",
        description: `**${req.user.username}** вошёл в систему через Google`,
        color: 0x4285f4,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (e) { console.error("Webhook error:", e.message); }

  // Создаём/обновляем игрока в БД
  let { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("discord_id", req.user.id)
    .single();

  if (!player) {
    const { data: newPlayer } = await supabase
      .from("players")
      .insert({
        discord_id: req.user.id,
        username: req.user.username,
        avatar: req.user.avatar,
        provider: "google",
      })
      .select()
      .single();
    player = newPlayer;
  }

  if (player?.totp_enabled) return res.redirect("/auth/2fa");
  res.redirect(`/${req.user.id}/dashboard/users`);
});

module.exports = router;
