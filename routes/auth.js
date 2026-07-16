const router = require("express").Router();
const passport = require("passport");
const axios = require("axios");
const supabase = require("../config/supabase");

// Вход через Discord
router.get("/login", passport.authenticate("discord"));

// Callback после входа Discord — ИСПРАВЛЕННЫЙ
router.get(
  "/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  async (req, res) => {
    req.session.totpVerified = false;

    try {
      await axios.post(process.env.WEBHOOK_URL, {
        embeds: [{
          title: "✅ Авторизация",
          description: `**${req.user.username}** вошёл в систему через Discord`,
          color: 0x3b9d6f,
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (e) {
      console.error("Webhook error:", e.message);
    }

    // ========== ГЛАВНОЕ ИСПРАВЛЕНИЕ: СОЗДАЁМ ПОЛЬЗОВАТЕЛЯ ==========
    const discordId = req.user.id;
    const username = req.user.username;
    const avatarUrl = `https://cdn.discordapp.com/avatars/${discordId}/${req.user.avatar}.png`;

    // 1. Пытаемся найти пользователя
    let { data: player, error: findError } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", discordId)
      .single();

    // 2. Если не найден — СОЗДАЁМ
    if (!player) {
      console.log(`🆕 Создаём нового пользователя: ${username} (${discordId})`);
      
      const { data: newPlayer, error: insertError } = await supabase
        .from("players")
        .insert({
          discord_id: discordId,
          username: username,
          avatar: avatarUrl,
          provider: "discord",
          created_at: new Date().toISOString(),
          roles: [],
          uid: null,
          totp_enabled: false,
          totp_secret: null,
          access_key: null,
          access_key_created: null,
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ Ошибка создания пользователя:", insertError);
        return res.redirect("/");
      }

      player = newPlayer;
      console.log(`✅ Пользователь создан: ${player.discord_id}`);
    } else {
      // 3. Если существует — ОБНОВЛЯЕМ аватарку и имя (на случай смены)
      console.log(`♻️ Обновляем данные пользователя: ${username}`);
      
      // Проверяем, нужно ли обновить аватарку (старая ссылка могла умереть)
      const needsAvatarUpdate = !player.avatar || 
        player.avatar.includes('cdn.discordapp.com/avatars/') && 
        !player.avatar.includes(`/avatars/${discordId}/${req.user.avatar}`);

      const updateData = {};
      if (player.username !== username) updateData.username = username;
      if (needsAvatarUpdate) updateData.avatar = avatarUrl;

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from("players")
          .update(updateData)
          .eq("discord_id", discordId);
        if (updateError) console.error("⚠️ Ошибка обновления:", updateError);
      }
    }

    // Проверяем 2FA
    const { data: playerCheck } = await supabase
      .from("players")
      .select("totp_enabled")
      .eq("discord_id", discordId)
      .single();

    if (playerCheck?.totp_enabled) {
      return res.redirect("/auth/2fa");
    }

    // Успешный редирект на дашборд
    res.redirect(`/${discordId}/dashboard/users`);
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

  const user = {
    id: player.discord_id,
    username: player.username,
    avatar: player.avatar,
  };

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    req.session.totpVerified = true;
    res.json({
      success: true,
      redirect: `/${player.discord_id}/dashboard/users`,
    });
  });
});

// Выход
router.get("/logout", (req, res, next) => {
  const username = req.user?.username || "Unknown";
  
  req.session.totpVerified = false;
  req.session.returnTo = null;
  
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((sessionErr) => {
      if (sessionErr) console.error("Session destroy error:", sessionErr);
      axios
        .post(process.env.WEBHOOK_URL, {
          embeds: [{
            title: "🚪 Выход",
            description: `**${username}** вышел из системы`,
            color: 0xe74c3c,
            timestamp: new Date().toISOString(),
          }],
        })
        .catch(() => {});
      res.redirect("/");
    });
  });
});

// Google авторизация
router.get("/google", (req, res, next) => {
  const callbackURL = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  
  const authenticator = passport.authenticate("google", {
    scope: ["profile", "email"],
    callbackURL: callbackURL
  });
  
  authenticator(req, res, next);
});

// Google callback
router.get("/google/callback", (req, res, next) => {
  const callbackURL = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  
  const authenticator = passport.authenticate("google", {
    failureRedirect: "/",
    callbackURL: callbackURL
  }, async (err, user, info) => {
    if (err || !user) {
      console.error("Google auth error:", err);
      return res.redirect("/");
    }
    
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error("Login error:", loginErr);
        return res.redirect("/");
      }
      
      req.session.totpVerified = false;

      try {
        await axios.post(process.env.WEBHOOK_URL, {
          embeds: [{
            title: "✅ Авторизация",
            description: `**${user.username}** вошёл в систему через Google`,
            color: 0x4285f4,
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) { 
        console.error("Webhook error:", e.message); 
      }

      // Создаём/обновляем пользователя Google
      const googleId = user.id;
      let googleAvatarUrl = user.photos?.[0]?.value || 
        `https://ui-avatars.com/api/?background=3b9d6f&color=fff&name=${encodeURIComponent(user.username)}&size=128&rounded=true`;

      let { data: player } = await supabase
        .from("players")
        .select("*")
        .eq("discord_id", googleId)
        .single();

      if (!player) {
        console.log(`🆕 Создаём нового Google пользователя: ${user.username}`);
        
        const { data: newPlayer, error: insertError } = await supabase
          .from("players")
          .insert({
            discord_id: googleId,
            username: user.username,
            avatar: googleAvatarUrl,
            provider: "google",
            created_at: new Date().toISOString(),
            roles: [],
            uid: null,
            totp_enabled: false,
            totp_secret: null,
            access_key: null,
            access_key_created: null,
          })
          .select()
          .single();

        if (insertError) {
          console.error("❌ Ошибка создания Google пользователя:", insertError);
          return res.redirect("/");
        }
        player = newPlayer;
      } else {
        // Обновляем аватарку если нужно
        if (!player.avatar || player.avatar.includes('ui-avatars.com') || player.avatar.includes('default')) {
          await supabase
            .from("players")
            .update({ avatar: googleAvatarUrl })
            .eq("discord_id", googleId);
        }
      }

      const { data: playerCheck } = await supabase
        .from("players")
        .select("totp_enabled")
        .eq("discord_id", googleId)
        .single();

      if (playerCheck?.totp_enabled) {
        return res.redirect("/auth/2fa");
      }

      res.redirect(`/${googleId}/dashboard/users`);
    });
  });
  
  authenticator(req, res, next);
});

module.exports = router;
