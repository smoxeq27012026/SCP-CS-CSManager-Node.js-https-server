const router = require("express").Router();
const path = require("path");
const {
  isAuthenticated,
  isOwner,
  isOwnDashboard,
  canAccessAdmin,
} = require("../middleware/auth");

// Главная
router.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect(`/${req.user.id}/dashboard/users`);
  }
  res.render("home", { csrfToken: req.session.csrfToken || "" });
});

// Дашборд
router.get("/:id/dashboard/:page", isOwnDashboard, (req, res) => {
  const allowedPages = ["users", "moderation", "settings", "me"];
  if (!allowedPages.includes(req.params.page)) {
    return res.status(404).render("404", { csrfToken: req.session.csrfToken || "" });
  }
  res.render("dashboard", { csrfToken: req.session.csrfToken || "" });
});

// Вход по ключу
router.get("/auth/key-login", (req, res) => {
  res.render("key-login", { csrfToken: req.session.csrfToken || "" });
});

// Админ-панель
router.get("/:id/adminka", canAccessAdmin, (req, res) => {
  res.render("admin", { csrfToken: req.session.csrfToken || "" });
});

module.exports = router;
