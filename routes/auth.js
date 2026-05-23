const router = require("express").Router();
const passport = require("passport");
const axios = require("axios");
const supabase = require("../config/supabase");

// Вход через Discord
router.get("/login", passport.authenticate("discord"));

// Callback после входа Discord
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
          avatar: `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`,
          provider: "discord",
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      player = newPlayer;
    }

    const { data: playerCheck } = await supabase
      .from("players")
      .select("totp_enabled")
      .eq("discord_id", req.user.id)
      .single();

    if (playerCheck?.totp_enabled) {
      return res.redirect("/auth/2fa");
    }

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
  req.logout((err) => {
    if (err) return next(err);
    req.session.totpVerified = false;
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

// Google авторизация
router.get("/google", (req, res, next) => {
  const callbackURL = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  
  const authenticator = passport.authenticate("google", {
    scope: ["profile", "email"],
    callbackURL: callbackURL
  });
  
  authenticator(req, res, next);
});

// Google callback - ИСПРАВЛЕННАЯ ВЕРСИЯ
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

      // 🔥 КРИТИЧЕСКИ ВАЖНО: создаём пользователя в БД
      console.log("Google user data:", {
        id: user.id,
        username: user.username,
        photos: user.photos
      });
      
      // Получаем аватар
      let googleAvatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
      try {
        if (user.photos && user.photos[0] && user.photos[0].value) {
          googleAvatarUrl = user.photos[0].value;
        } else {
          googleAvatarUrl = `https://ui-avatars.com/api/?background=3b9d6f&color=fff&name=${encodeURIComponent(user.username || 'User')}&size=128&rounded=true`;
        }
      } catch(e) {
        console.error("Avatar error:", e);
      }
      
      // Пробуем найти пользователя
      let { data: player } = await supabase
        .from("players")
        .select("*")
        .eq("discord_id", user.id)
        .single();
      
      // Если не найден - создаём
      if (!player) {
        console.log("Creating new Google user:", user.id);
        
        const { data: newPlayer, error: insertError } = await supabase
          .from("players")
          .insert({
            discord_id: user.id,
            username: user.username,
            avatar: googleAvatarUrl,
            provider: "google",
            created_at: new Date().toISOString(),
            roles: []
          })
          .select()
          .single();
        
        if (insertError) {
          console.error("Insert error:", insertError);
          // Пробуем ещё раз без .single()
          const { error: insertError2 } = await supabase
            .from("players")
            .insert({
              discord_id: user.id,
              username: user.username,
              avatar: googleAvatarUrl,
              provider: "google",
              created_at: new Date().toISOString(),
              roles: []
            });
          
          if (insertError2) {
            console.error("Second insert error:", insertError2);
            return res.redirect("/");
          }
          
          // Получаем созданного пользователя
          const { data: fetchedPlayer } = await supabase
            .from("players")
            .select("*")
            .eq("discord_id", user.id)
            .single();
          player = fetchedPlayer;
        } else {
          player = newPlayer;
        }
      } else {
        console.log("Existing Google user found:", player);
        // Обновляем аватар если нужно
        if (!player.avatar || player.avatar.includes('cdn.discordapp.com/avatars/google_')) {
          await supabase
            .from("players")
            .update({ avatar: googleAvatarUrl })
            .eq("discord_id", user.id);
        }
      }
      
      // Проверяем, существует ли пользователь после всех операций
      if (!player) {
        console.error("Failed to create or fetch user!");
        return res.redirect("/");
      }
      
      console.log("Final player data:", player);
      
      // Проверяем 2FA
      const { data: playerCheck } = await supabase
        .from("players")
        .select("totp_enabled")
        .eq("discord_id", user.id)
        .single();
      
      if (playerCheck?.totp_enabled) {
        return res.redirect("/auth/2fa");
      }
      
      // Успешный редирект на дашборд
      res.redirect(`/${user.id}/dashboard/users`);
    });
  });
  
  authenticator(req, res, next);
});

module.exports = router;