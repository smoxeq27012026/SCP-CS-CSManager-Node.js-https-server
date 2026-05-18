const path = require("path");

module.exports.isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).sendFile(path.join(__dirname, "..", "views", "unauthorized.html"));
};

module.exports.isOwner = (req, res, next) => {
  if (req.user && req.user.id === process.env.OWNER_ID) return next();
  res.status(403).json({ error: "Forbidden" });
};

// Для проверки, что пользователь заходит на свой дашборд
module.exports.isOwnDashboard = (req, res, next) => {
  if (req.isAuthenticated() && req.user.id === req.params.id) return next();
  res.status(403).sendFile(path.join(__dirname, "..", "views", "unauthorized.html"));
};

// Проверка доступа к админке (owner или роль с accessAdmin)
module.exports.canAccessAdmin = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).sendFile(path.join(__dirname, "..", "views", "unauthorized.html"));
  }

  // Владелец всегда имеет доступ
  if (req.user.id === process.env.OWNER_ID) return next();

  // Проверяем роли пользователя
  try {
    const supabase = require("../config/supabase");
    const { data: player } = await supabase
      .from("players")
      .select("roles")
      .eq("discord_id", req.user.id)
      .single();

    if (player && player.roles) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase
          .from("roles")
          .select("permissions")
          .eq("id", userRole.id)
          .single();

        if (role && role.permissions && role.permissions.accessAdmin) {
          return next();
        }
      }
    }
  } catch (err) {
    console.error("Admin check error:", err);
  }

  res.status(403).sendFile(path.join(__dirname, "..", "views", "unauthorized.html"));
};

module.exports.canViewModeration = async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.id === process.env.OWNER_ID) return next();
  try {
    const supabase = require("../config/supabase");
    const { data: player } = await supabase.from("players").select("roles").eq("discord_id", req.user.id).single();
    if (player && player.roles) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase.from("roles").select("permissions").eq("id", userRole.id).single();
        if (role && role.permissions && role.permissions.viewModeration) return next();
      }
    }
  } catch (err) { console.error("View moderation check error:", err); }
  res.status(403).json({ error: "Forbidden" });
};

module.exports.canInteractModeration = async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.id === process.env.OWNER_ID) return next();
  try {
    const supabase = require("../config/supabase");
    const { data: player } = await supabase.from("players").select("roles").eq("discord_id", req.user.id).single();
    if (player && player.roles) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase.from("roles").select("permissions").eq("id", userRole.id).single();
        if (role && role.permissions && role.permissions.interactModeration) return next();
      }
    }
  } catch (err) { console.error("Interact moderation check error:", err); }
  res.status(403).json({ error: "Forbidden" });
};

module.exports.canDeleteModerationEntries = async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.id === process.env.OWNER_ID) return next();
  try {
    const supabase = require("../config/supabase");
    const { data: player } = await supabase.from("players").select("roles").eq("discord_id", req.user.id).single();
    if (player && player.roles) {
      for (const userRole of player.roles) {
        const { data: role } = await supabase.from("roles").select("permissions").eq("id", userRole.id).single();
        if (role && role.permissions && role.permissions.deleteEntries) return next();
      }
    }
  } catch (err) { console.error("Delete entries check error:", err); }
  res.status(403).json({ error: "Forbidden" });
};
