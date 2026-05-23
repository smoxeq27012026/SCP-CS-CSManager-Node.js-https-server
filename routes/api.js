const router = require("express").Router();
const {
  isAuthenticated,
  isOwner,
  canAccessAdmin,
  canViewModeration,
  canInteractModeration,
  canDeleteModerationEntries
} = require("../middleware/auth");
const supabase = require("../config/supabase");

router.get("/me", async (req, res) => {
  if (!req.user) {
    return res.json({
      discordId: "guest",
      username: "Гость",
      avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
      uid: null,
      roles: [],
      permissions: {},
      provider: null
    });
  }
  try {
    let { data: player } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", req.user.id)
      .single();

    if (!player) {
      const provider = req.user.id.startsWith("google_") ? "google" : "discord";
      const avatar = provider === "google" 
        ? (req.user.photos?.[0]?.value || `https://ui-avatars.com/api/?background=3b9d6f&color=fff&name=${encodeURIComponent(req.user.username)}`)
        : `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`;
      
      const { data: newPlayer } = await supabase
        .from("players")
        .insert({
          discord_id: req.user.id,
          username: req.user.username,
          avatar: avatar,
          provider: provider,
        })
        .select()
        .single();
      player = newPlayer;
    }

    // Собираем permissions из всех ролей пользователя
    const permissions = {
      viewModeration: false,
      interactModeration: false,
      deleteEntries: false,
      accessSettings: false,
      accessAdmin: false,
      canSetUID: false,
      apAccess: false,
      reservedSlot: false
    };

    if (player.roles && player.roles.length > 0) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase
          .from("roles")
          .select("permissions, ap_access, reserved_slot")
          .eq("id", userRole.id)
          .single();
        if (role) {
          if (role.permissions) {
            for (const key of Object.keys(permissions)) {
              if (role.permissions[key]) permissions[key] = true;
            }
          }
          if (role.ap_access) permissions.apAccess = true;
          if (role.reserved_slot) permissions.reservedSlot = true;
        }
      }
    }

    // Владелец получает все права
    if (player.discord_id === process.env.OWNER_ID) {
      Object.keys(permissions).forEach(k => permissions[k] = true);
    }

    res.json({
      discordId: player.discord_id,
      username: player.username,
      avatar: player.avatar,
      uid: player.uid,
      roles: player.roles || [],
      permissions,
      provider: player.provider || (player.discord_id.startsWith("google_") ? "google" : "discord")
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users", isAuthenticated, async (req, res) => {
  try {
    const pageNum = parseInt(req.query.page) || 1;
    const limitNum = parseInt(req.query.limit) || 5;
    const discordId = req.query.discordId;
    const uid = req.query.uid;

    let query = supabase.from("players").select("*", { count: "exact" });

    if (discordId) query = query.like("discord_id", `%${discordId}%`);
    if (uid) query = query.like("uid", `%${uid}%`);

    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data: users, count } = await query
      .range(from, to)
      .order("created_at", { ascending: false });

    res.json({
      users: (users || []).map((u) => ({
        discordId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
        uid: u.uid,
        roles: u.roles || [],
      })),
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/uid", isAuthenticated, async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "UID обязателен" });
    const { error } = await supabase
      .from("players")
      .update({ uid })
      .eq("discord_id", req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/retrieval/:uid", async (req, res) => {
  try {
    const { data: entry } = await supabase
      .from("retrievals")
      .select("*")
      .eq("uid", req.params.uid)
      .single();
    if (entry)
      res.json({ success: true, reason: entry.reason, time: entry.time });
    else res.json({ success: false });
  } catch (err) {
    res.json({ success: false });
  }
});

router.get("/retrieval/clear/:uid", isAuthenticated, canDeleteModerationEntries, async (req, res) => {
  try {
    await supabase.from("retrievals").delete().eq("uid", req.params.uid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/retrieval", isAuthenticated, canViewModeration, async (req, res) => {
  try {
    const { data: retrievals } = await supabase
      .from("retrievals")
      .select("*")
      .order("created_at", { ascending: false });
    res.json({ retrievals: retrievals || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/retrieval", isAuthenticated, canInteractModeration, async (req, res) => {
  try {
    const { uid, reason, time } = req.body;
    if (!uid || !reason)
      return res.status(400).json({ error: "UID и причина обязательны" });
    if (!/^\d+$/.test(uid))
      return res.status(400).json({ error: "UID должен содержать только цифры" });
    
    await supabase.from("retrievals").delete().eq("uid", uid);
    const { error } = await supabase
      .from("retrievals")
      .insert({ uid, reason, time: time || 60 });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { data: roles } = await supabase.from("roles").select("*");
    res.json({ roles: roles || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/roles", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { name, color, permissions, apAccess, reservedSlot, rights, tag } =
      req.body;
    await supabase.from("roles").insert({
      name,
      color: color || "#ffffff",
      permissions: permissions || {},
      ap_access: apAccess || false,
      reserved_slot: reservedSlot || false,
      rights: rights || "",
      tag: tag || "",
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete(
  "/roles/:id",
  isAuthenticated,
  canAccessAdmin,
  async (req, res) => {
    try {
      await supabase.from("roles").delete().eq("id", req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

async function checkModPerm(discordId, perm) {
  if (discordId === process.env.OWNER_ID) return true;
  const { data: player } = await supabase
    .from("players")
    .select("roles")
    .eq("discord_id", discordId)
    .single();
  if (!player?.roles) return false;
  for (const r of player.roles) {
    const { data: role } = await supabase
      .from("roles")
      .select("permissions")
      .eq("id", r.id)
      .single();
    if (role?.permissions?.[perm]) return true;
  }
  return false;
}

router.delete(
  "/players/:discordId/roles",
  isAuthenticated,
  isOwner,
  async (req, res) => {
    try {
      await supabase
        .from("players")
        .update({ roles: [] })
        .eq("discord_id", req.params.discordId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Удалить пользователя
router.delete(
  "/players/:discordId",
  isAuthenticated,
  isOwner,
  async (req, res) => {
    try {
      await supabase
        .from("players")
        .delete()
        .eq("discord_id", req.params.discordId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Назначение роли пользователю
router.post(
  "/players/assign-role",
  isAuthenticated,
  isOwner,
  async (req, res) => {
    try {
      const { discordId, roleId, uid } = req.body;
      if (!discordId || !roleId)
        return res.status(400).json({ error: "Discord ID и роль обязательны" });

      // Получаем роль
      const { data: role } = await supabase
        .from("roles")
        .select("*")
        .eq("id", roleId)
        .single();
      if (!role) return res.status(404).json({ error: "Роль не найдена" });

      // Ищем или создаём игрока
      let { data: player } = await supabase
        .from("players")
        .select("*")
        .eq("discord_id", discordId)
        .single();
      if (!player) {
        const { data: newPlayer } = await supabase
          .from("players")
          .insert({
            discord_id: discordId,
            username: discordId,
            avatar: `https://cdn.discordapp.com/avatars/${discordId}/default.png`,
          })
          .select()
          .single();
        player = newPlayer;
      }

      // Добавляем роль (если ещё нет)
      const roles = player.roles || [];
      if (!roles.find((r) => r.id === role.id)) {
        roles.push({ id: role.id, name: role.name, color: role.color });
      }

      const updateData = { roles };
      if (uid) updateData.uid = uid;

      await supabase
        .from("players")
        .update(updateData)
        .eq("discord_id", discordId);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get("/admin/users", isAuthenticated, isOwner, async (req, res) => {
  try {
    const { discordId } = req.query;
    let query = supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: false });
    if (discordId) query = query.eq("discord_id", discordId);
    const { data: users } = await query;
    res.json({
      users: (users || []).map((u) => ({
        discordId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
        uid: u.uid,
        roles: u.roles || [],
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const crypto = require("crypto");
router.get("/me/access-key", isAuthenticated, async (req, res) => {
  try {
    // Проверяем, включена ли 2FA
    const { data: player } = await supabase
      .from("players")
      .select("totp_enabled, access_key, access_key_created")
      .eq("discord_id", req.user.id)
      .single();

    if (!player?.totp_enabled) {
      return res.json({ success: false, error: "2FA должна быть включена" });
    }

    // Если ключ уже есть — показываем дату создания, но не сам ключ
    if (player.access_key) {
      return res.json({
        success: true,
        hasKey: true,
        created: player.access_key_created,
        hint: "Ключ уже создан. Нажмите 'Перегенерировать' для нового ключа.",
      });
    }

    res.json({ success: true, hasKey: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Сгенерировать новый ключ доступа
router.post("/me/access-key/generate", isAuthenticated, async (req, res) => {
  try {
    // Проверяем 2FA код
    const { code } = req.body;
    const { data: player } = await supabase
      .from("players")
      .select("totp_enabled, totp_secret")
      .eq("discord_id", req.user.id)
      .single();

    if (!player?.totp_enabled) {
      return res.json({ success: false, error: "Сначала включите 2FA" });
    }

    // Проверяем TOTP код
    const speakeasy = require("speakeasy");
    const verified = speakeasy.totp.verify({
      secret: player.totp_secret,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!verified) {
      return res.json({ success: false, error: "Неверный код 2FA" });
    }

    // Генерируем новый ключ
    const newKey = "dexk_" + crypto.randomBytes(32).toString("hex");

    await supabase
      .from("players")
      .update({
        access_key: newKey,
        access_key_created: new Date().toISOString(),
      })
      .eq("discord_id", req.user.id);

    res.json({
      success: true,
      key: newKey,
      warning: "⚠️ Скопируйте ключ сейчас! Он больше не будет показан.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/search", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ users: [] });
    const { data: users } = await supabase
      .from("players")
      .select("discord_id, username, avatar")
      .or(`username.ilike.%${q}%,discord_id.ilike.%${q}%`)
      .limit(8);
    res.json({
      users: (users || []).map(u => ({
        discordId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/roles/:id", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { name, color, permissions, apAccess, reservedSlot } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (color) updateData.color = color;
    if (permissions) updateData.permissions = permissions;
    if (typeof apAccess === 'boolean') updateData.ap_access = apAccess;
    if (typeof reservedSlot === 'boolean') updateData.reserved_slot = reservedSlot;

    const { error } = await supabase
      .from("roles")
      .update(updateData)
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles/:id/users", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    // Получаем роль, чтобы знать её имя (но не обязательно)
    const { data: allPlayers } = await supabase
      .from("players")
      .select("discord_id, username, avatar, roles");

    const roleId = parseInt(req.params.id); // или строка, в зависимости от типа id
    const usersWithRole = (allPlayers || []).filter(p =>
      (p.roles || []).some(r => r.id == roleId)
    ).map(p => ({
      discordId: p.discord_id,
      username: p.username,
      avatar: p.avatar,
    }));

    res.json({ users: usersWithRole });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Снять роль с пользователя (удалить конкретную роль из массива roles)
router.delete("/players/:discordId/roles/:roleId", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { discordId, roleId } = req.params;
    // Получаем текущего игрока
    const { data: player } = await supabase
      .from("players")
      .select("roles")
      .eq("discord_id", discordId)
      .single();
    if (!player) return res.status(404).json({ error: "Пользователь не найден" });

    const roles = (player.roles || []).filter(r => r.id != roleId);
    const { error } = await supabase
      .from("players")
      .update({ roles })
      .eq("discord_id", discordId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let activePlayers = {};

router.post("/game/players/join", (req, res) => {
  const { uid, accountname } = req.body;
  if (!uid) return res.status(400).json({ error: "UID required" });
  activePlayers[uid] = { accountname, joinedAt: new Date() };
  res.json({ success: true });
});

// Игрок вышел
router.post("/game/players/leave", (req, res) => {
  const { uid } = req.body;
  delete activePlayers[uid];
  res.json({ success: true });
});

// Полная синхронизация при старте раунда
router.post("/game/players/sync", (req, res) => {
  const players = req.body.players || [];
  activePlayers = {};
  players.forEach(p => {
    if (p.uid) activePlayers[p.uid] = { accountname: p.accountname, joinedAt: new Date() };
  });
  res.json({ success: true });
});

// Список активных игроков (для Discord-бота)
router.get("/game/players/list", (req, res) => {
  const list = Object.entries(activePlayers).map(([uid, data]) => ({
    uid: parseInt(uid),
    accountname: data.accountname,
  }));
  res.json(list);
});

router.get("/game/retrieval/clear/:uid", async (req, res) => {
  try {
    await supabase.from("retrievals").delete().eq("uid", req.params.uid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить профиль другого пользователя (для модалки)
router.get("/player/:discordId", isAuthenticated, async (req, res) => {
  try {
    const { discordId } = req.params;
    
    // Получаем игрока из БД
    const { data: player } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", discordId)
      .single();
    
    if (!player) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Собираем permissions из ролей
    const permissions = {
      viewModeration: false,
      interactModeration: false,
      deleteEntries: false,
      accessSettings: false,
      accessAdmin: false,
      canSetUID: false,
      apAccess: false,
      reservedSlot: false
    };
    
    if (player.roles && player.roles.length > 0) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase
          .from("roles")
          .select("permissions, ap_access, reserved_slot")
          .eq("id", userRole.id)
          .single();
        if (role) {
          if (role.permissions) {
            for (const key of Object.keys(permissions)) {
              if (role.permissions[key]) permissions[key] = true;
            }
          }
          if (role.ap_access) permissions.apAccess = true;
          if (role.reserved_slot) permissions.reservedSlot = true;
        }
      }
    }
    
    // Владелец имеет все права
    if (player.discord_id === process.env.OWNER_ID) {
      Object.keys(permissions).forEach(k => permissions[k] = true);
    }
    
    res.json({
      discordId: player.discord_id,
      username: player.username,
      avatar: player.avatar,
      uid: player.uid,
      roles: player.roles || [],
      permissions,
      isOwner: player.discord_id === process.env.OWNER_ID
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;