// routes/dashboard.js
const router = require("express").Router();
const path = require("path");
const {
  isAuthenticated,
  isOwner,
  isOwnDashboard,
  canAccessAdmin,
} = require("../middleware/auth");

// Главная: если залогинен – перебросить на дашборд
router.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect(`/${req.user.id}/dashboard/users`);
  }
  res.sendFile(path.join(__dirname, "..", "views", "home.html"));
});

// Дашборд (пользователи, модерация, настройки, профиль)
// ВАЖНО: убираем редирект на users для неизвестных страниц,
// вместо этого показываем 404
router.get("/:id/dashboard/:page", isOwnDashboard, (req, res) => {
  const allowedPages = ["users", "moderation", "settings", "me"];
  if (!allowedPages.includes(req.params.page)) {
    // Если страница не найдена - показываем 404, НЕ редиректим на users!
    return res.status(404).sendFile(path.join(__dirname, "..", "views", "404.html"));
  }
  res.sendFile(path.join(__dirname, "..", "views", "dashboard.html"));
});

// Страница входа по ключу
router.get("/auth/key-login", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "key-login.html"));
});

// Админ-панель (владелец или роль с правом accessAdmin)
router.get("/:id/adminka", canAccessAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "admin.html"));
});

module.exports = router;
