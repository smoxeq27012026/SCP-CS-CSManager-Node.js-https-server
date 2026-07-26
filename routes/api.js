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
const crypto = require("crypto");
const speakeasy = require("speakeasy");

router.get("/me", async (req, res) => {
  if (!req.user) {
    return res.json({
      discordId: "guest",
      username: "Гость",
      avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
      uid: null,
      roles: [],
      permissions: {},
      provider: null,
      rights: [],
      apAccess: false,
      reservedSlot: false,
      tag: ""
    });
  }
  try {
    // Определяем сервер из заголовка или query
    const server = req.headers['x-server'] || req.query.server || 'CLASSIC';
    console.log(`[API] Fetching player ${req.user.id} for server ${server}`);

    let { data: player, error } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", req.user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      const provider = req.user.id.startsWith("google_") ? "google" : "discord";
      const avatar = provider === "google" 
        ? (req.user.photos?.[0]?.value || `https://ui-avatars.com/api/?background=3b9d6f&color=fff&name=${encodeURIComponent(req.user.username)}`)
        : `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`;
      const { data: newPlayer, error: insertError } = await supabase
        .from("players")
        .insert({
          discord_id: req.user.id,
          username: req.user.username,
          avatar: avatar,
          avatar_updated_at: new Date().toISOString(),
          provider: provider,
          created_at: new Date().toISOString(),
          roles: []
        })
        .select()
        .single();
      if (insertError) throw insertError;
      player = newPlayer;
    } else if (error) {
      throw error;
    }

    // Базовые permissions
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
    let rights = [];
    let tag = "";

    if (player.roles && player.roles.length > 0) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase
          .from("roles")
          .select("*")
          .eq("id", userRole.id)
          .single();
        // ВАЖНО: проверяем соответствие сервера
        if (role && role.server === server) {
          if (role.permissions) {
            for (const key of Object.keys(permissions)) {
              if (role.permissions[key]) permissions[key] = true;
            }
          }
          if (role.ap_access) permissions.apAccess = true;
          if (role.reserved_slot) permissions.reservedSlot = true;
          if (role.rights) {
            if (Array.isArray(role.rights)) {
              rights.push(...role.rights);
            } else if (typeof role.rights === 'string') {
              rights.push(role.rights);
            }
          }
          if (role.tag && !tag) tag = role.tag;
        }
      }
    }
    
    // Убираем дубликаты прав
    rights = [...new Set(rights)];

    // Владелец получает все права
    if (player.discord_id === process.env.OWNER_ID) {
      Object.keys(permissions).forEach(k => permissions[k] = true);
      rights = ["all"];
      tag = `<color=#FFA500>OWNER</color>`;
    }

    res.json({
      discordId: player.discord_id,
      username: player.username,
      avatar: player.avatar,
      uid: player.uid,
      roles: player.roles || [],
      permissions,
      provider: player.provider || (player.discord_id.startsWith("google_") ? "google" : "discord"),
      rights,
      apAccess: permissions.apAccess,
      reservedSlot: permissions.reservedSlot,
      tag
    });
  } catch (err) {
    console.error("[API] /me error:", err);
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

    // ====== ФОНОВОЕ ОБНОВЛЕНИЕ АВАТАРОК ======
    const now = Date.now();
    const updatedUsers = [];
    
    for (const user of (users || [])) {
      const isDiscordUser = user.provider === 'discord' || (!user.provider && !user.discord_id?.startsWith('google_'));
      const avatarIsOld = user.avatar_updated_at && (now - new Date(user.avatar_updated_at).getTime() > 7 * 24 * 60 * 60 * 1000);
      const avatarIsDefault = user.avatar?.includes('embed/avatars') || user.avatar?.includes('ui-avatars.com');
      
      if (isDiscordUser && (avatarIsOld || avatarIsDefault || !user.avatar_updated_at)) {
        try {
          const discordId = user.discord_id;
          const response = await axios.get(`https://discord.com/api/v10/users/${discordId}`);
          if (response.data && response.data.avatar) {
            const newAvatar = `https://cdn.discordapp.com/avatars/${discordId}/${response.data.avatar}.png`;
            await supabase
              .from("players")
              .update({ 
                avatar: newAvatar,
                avatar_updated_at: new Date().toISOString(),
                username: response.data.username
              })
              .eq("discord_id", discordId);
            updatedUsers.push(user.discord_id);
          }
        } catch (avatarErr) {
          // пропускаем
        }
      }
    }
    
    if (updatedUsers.length > 0) {
      console.log(`🔄 Обновлены аватарки для ${updatedUsers.length} пользователей`);
    }

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
    console.error("[API] /users error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/uid", isAuthenticated, async (req, res) => {
  try {
    const { uid, discordId: targetDiscordId } = req.body;
    const currentUserId = req.user.id;
    
    // Определяем, чей UID меняем
    let targetDiscordIdToUpdate = currentUserId;
    let isSelf = true;
    
    if (targetDiscordId && targetDiscordId !== currentUserId) {
      // Меняем чужой UID
      isSelf = false;
      
      // Проверяем права (owner или canSetUID)
      const isOwner = currentUserId === process.env.OWNER_ID;
      
      // Проверяем canSetUID через роли
      let canSetUID = false;
      const { data: player } = await supabase
        .from("players")
        .select("roles")
        .eq("discord_id", currentUserId)
        .single();
      
      if (player?.roles) {
        for (const userRole of player.roles) {
          const { data: role } = await supabase
            .from("roles")
            .select("permissions")
            .eq("id", userRole.id)
            .single();
          if (role?.permissions?.canSetUID) {
            canSetUID = true;
            break;
          }
        }
      }
      
      if (!isOwner && !canSetUID) {
        return res.status(403).json({ error: "Нет прав на изменение UID другого пользователя" });
      }
      
      // ДОБАВЛЯЕМ: проверяем, существует ли целевой пользователь
      const { data: targetPlayer, error: targetError } = await supabase
        .from("players")
        .select("discord_id")
        .eq("discord_id", targetDiscordId)
        .single();
      
      if (targetError || !targetPlayer) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }
      
      targetDiscordIdToUpdate = targetDiscordId;
    }
    
    // Обновляем UID
    const { error } = await supabase
      .from("players")
      .update({ uid: uid || null })
      .eq("discord_id", targetDiscordIdToUpdate);
    
    if (error) throw error;
    
    res.json({ 
      success: true, 
      message: isSelf ? "Ваш UID обновлён" : "UID пользователя обновлён",
      uid: uid
    });
  } catch (err) {
    console.error("[API] POST /me/uid error:", err);
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

// ===== GET /retrieval — ПОЛУЧЕНИЕ СПИСКА РОЗЫСКОВ =====
router.get("/retrieval", isAuthenticated, canViewModeration, async (req, res) => {
  try {
    const server = req.query.server || 'CLASSIC';
    
    console.log(`[API] GET retrievals for server: ${server}`);
    
    const { data: retrievals, error } = await supabase
      .from("retrievals")
      .select("*")
      .eq("server", server)
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    res.json({ retrievals: retrievals || [] });
  } catch (err) {
    console.error("[API] GET /retrieval error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /retrieval — ДОБАВЛЕНИЕ В РОЗЫСК (ТОЛЬКО ОДИН!) =====
router.post("/retrieval", isAuthenticated, canInteractModeration, async (req, res) => {
  try {
    const { uid, reason, time, server } = req.body;
    const finalServer = server || req.query.server || req.headers['x-server'] || 'CLASSIC';
    
    if (!uid || !reason) {
      return res.status(400).json({ error: "UID и причина обязательны" });
    }
    if (!/^\d+$/.test(uid)) {
      return res.status(400).json({ error: "UID должен содержать только цифры" });
    }
    
    await supabase.from("retrievals").delete().eq("uid", uid).eq("server", finalServer);
    
    const { error } = await supabase
      .from("retrievals")
      .insert({ 
        uid, 
        reason, 
        time: time || 60, 
        server: finalServer 
      });
      
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[API] POST /retrieval error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { data: roles, error } = await supabase.from("roles").select("*");
    if (error) throw error;
    res.json({ roles: roles || [] });
  } catch (err) {
    console.error("[API] GET /roles error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/roles", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { name, color, permissions, apAccess, reservedSlot, rights, tag, server } = req.body;
    const { error } = await supabase.from("roles").insert({
      name,
      color: color || "#ffffff",
      permissions: permissions || {},
      ap_access: apAccess || false,
      reserved_slot: reservedSlot || false,
      rights: rights || [],
      tag: tag || "",
      server: server || "CLASSIC"
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[API] POST /roles error:", err);
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
router.post("/players/assign-role", isAuthenticated, isOwner, async (req, res) => {
  try {
    const { discordId, roleId, uid } = req.body;
    if (!discordId || !roleId) return res.status(400).json({ error: "Discord ID и роль обязательны" });

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();
    if (roleError || !role) return res.status(404).json({ error: "Роль не найдена" });

    let { data: player, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", discordId)
      .single();

    if (playerError || !player) {
      const { data: newPlayer, error: insertError } = await supabase
        .from("players")
        .insert({
          discord_id: discordId,
          username: discordId,
          avatar: `https://cdn.discordapp.com/avatars/${discordId}/default.png`,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      player = newPlayer;
    }

    const roles = player.roles || [];
    if (!roles.find(r => r.id == role.id)) {
      roles.push({ id: role.id, name: role.name, color: role.color });
    }

    const updateData = { roles };
    if (uid) updateData.uid = uid;

    const { error: updateError } = await supabase
      .from("players")
      .update(updateData)
      .eq("discord_id", discordId);
    if (updateError) throw updateError;
    res.json({ success: true });
  } catch (err) {
    console.error("[API] POST /players/assign-role error:", err);
    res.status(500).json({ error: err.message });
  }
});

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
    const { data: users, error } = await supabase
      .from("players")
      .select("discord_id, username, avatar")
      .or(`username.ilike.%${q}%,discord_id.ilike.%${q}%`)
      .limit(8);
    if (error) throw error;
    res.json({
      users: (users || []).map(u => ({
        discordId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
      }))
    });
  } catch (err) {
    console.error("[API] GET /users/search error:", err);
    res.status(500).json({ error: err.message });
  }
});


router.delete("/roles/:id", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from("roles").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[API] DELETE /roles/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles/:id/users", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { data: allPlayers, error } = await supabase
      .from("players")
      .select("discord_id, username, avatar, roles");
    if (error) throw error;

    const roleId = parseInt(req.params.id);
    const usersWithRole = (allPlayers || []).filter(p =>
      (p.roles || []).some(r => r.id == roleId)
    ).map(p => ({
      discordId: p.discord_id,
      username: p.username,
      avatar: p.avatar,
    }));
    res.json({ users: usersWithRole });
  } catch (err) {
    console.error("[API] GET /roles/:id/users error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Снять роль с пользователя (удалить конкретную роль из массива roles)
router.delete("/players/:discordId/roles/:roleId", isAuthenticated, canAccessAdmin, async (req, res) => {
  try {
    const { discordId, roleId } = req.params;
    const { data: player, error: fetchError } = await supabase
      .from("players")
      .select("roles")
      .eq("discord_id", discordId)
      .single();
    if (fetchError || !player) return res.status(404).json({ error: "Пользователь не найден" });

    const roles = (player.roles || []).filter(r => r.id != roleId);
    const { error: updateError } = await supabase
      .from("players")
      .update({ roles })
      .eq("discord_id", discordId);
    if (updateError) throw updateError;
    res.json({ success: true });
  } catch (err) {
    console.error("[API] DELETE /players/:discordId/roles/:roleId error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/retrieval/clear/:uid", isAuthenticated, canDeleteModerationEntries, async (req, res) => {
  try {
    const uid = req.params.uid;
    const server = req.headers['x-server'] || req.query.server || req.body?.server || 'CLASSIC';
    
    console.log(`[API] Clearing retrieval for UID ${uid} on server ${server}`);
    
    const { error } = await supabase
      .from("retrievals")
      .delete()
      .eq("uid", uid)
      .eq("server", server);
      
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err) {
    console.error("[API] DELETE /retrieval/clear error:", err);
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
    const { data: player, error } = await supabase
      .from("players")
      .select("*")
      .eq("discord_id", discordId)
      .single();
    if (error || !player) return res.status(404).json({ error: "Пользователь не найден" });

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
    let rights = [];
    let tag = "";
    const server = req.headers['x-server'] || req.query.server || 'CLASSIC';

    if (player.roles && player.roles.length > 0) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase
          .from("roles")
          .select("*")
          .eq("id", userRole.id)
          .single();
        if (role && role.server === server) {
          if (role.permissions) {
            for (const key of Object.keys(permissions)) {
              if (role.permissions[key]) permissions[key] = true;
            }
          }
          if (role.ap_access) permissions.apAccess = true;
          if (role.reserved_slot) permissions.reservedSlot = true;
          if (role.rights && Array.isArray(role.rights)) rights.push(...role.rights);
          if (role.tag && !tag) tag = role.tag;
        }
      }
    }
    rights = [...new Set(rights)];

    if (player.discord_id === process.env.OWNER_ID) {
      Object.keys(permissions).forEach(k => permissions[k] = true);
      rights = ["all"];
    }

    res.json({
      discordId: player.discord_id,
      username: player.username,
      avatar: player.avatar,
      uid: player.uid,
      roles: player.roles || [],
      permissions,
      rights,
      apAccess: permissions.apAccess,
      reservedSlot: permissions.reservedSlot,
      tag,
      isOwner: player.discord_id === process.env.OWNER_ID
    });
  } catch (err) {
    console.error("[API] GET /player/:discordId error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛУЧЕНИЕ ПРАВ АДМИНИСТРАТОРА ПО UID ---
router.get("/isadmin/:uid", async (req, res) => {
  const uid = req.params.uid;
  // Поддержка разных форматов URL: /classic/isadmin/12345 или /mediumrp/isadmin/12345
  let server = req.headers['x-server'] || req.query.server || 'CLASSIC';
  
  // Извлекаем сервер из пути если есть (например /classic1/isadmin/12345)
  const pathMatch = req.path.match(/^\/(classic|mediumrp)/i);
  if (pathMatch) {
    server = pathMatch[1].toUpperCase();
  }
  
  console.log(`[API] Checking admin rights for UID ${uid} on server ${server}`);

  try {
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("uid", uid)
      .single();

    if (playerError || !player) {
      return res.json({ success: false, message: "Player not found", rights: [], apAccess: false, reservedSlot: false });
    }

    let rights = [];
    let apAccess = false;
    let reservedSlot = false;
    let tag = "";

    if (player.roles && player.roles.length > 0) {
      for (const userRole of player.roles) {
        const { data: role, error: roleError } = await supabase
          .from("roles")
          .select("*")
          .eq("id", userRole.id)
          .single();

        // ВАЖНО: проверяем соответствие сервера
        if (role && !roleError && role.server === server) {
          if (role.rights) {
            if (Array.isArray(role.rights)) {
              rights.push(...role.rights);
            } else if (typeof role.rights === 'string') {
              rights.push(role.rights);
            }
          }
          if (role.ap_access) apAccess = true;
          if (role.reserved_slot) reservedSlot = true;
          if (role.tag && !tag) tag = role.tag;
        }
      }
    }

    rights = [...new Set(rights)];

    if (player.discord_id === process.env.OWNER_ID) {
      rights = ["all"];
      apAccess = true;
      reservedSlot = true;
    }

    res.json({
      success: true,
      uid: player.uid,
      discordId: player.discord_id,
      rights,
      apAccess,
      reservedSlot,
      tag
    });
  } catch (err) {
    console.error("[API] /isadmin error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
