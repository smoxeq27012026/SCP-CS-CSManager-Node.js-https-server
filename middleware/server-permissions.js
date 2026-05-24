const supabase = require("../config/supabase");

// Проверка прав для конкретного сервера
async function checkServerPermission(discordId, server, permission) {
  // Владелец имеет все права
  if (discordId === process.env.OWNER_ID) return true;
  
  const { data: player } = await supabase
    .from("players")
    .select("roles")
    .eq("discord_id", discordId)
    .single();
  
  if (!player?.roles) return false;
  
  for (const userRole of player.roles) {
    const { data: role } = await supabase
      .from("roles")
      .select("permissions")
      .eq("id", userRole.id)
      .single();
    
    // ВАЖНО: проверяем, что роль принадлежит нужному серверу
    if (role && role.server === server && role.permissions?.[permission]) {
      return true;
    }
  }
  return false;
}

// Middleware для проверки доступа к модерации на конкретном сервере
function canAccessModerationOnServer(server) {
  return async (req, res, next) => {
    const targetServer = server || req.query.server || req.headers['x-server'] || 'CLASSIC';
    const hasAccess = await checkServerPermission(req.user.id, targetServer, 'viewModeration');
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: `У вас нет прав на модерацию для сервера ${targetServer}` 
      });
    }
    next();
  };
}

module.exports = { checkServerPermission, canAccessModerationOnServer };
