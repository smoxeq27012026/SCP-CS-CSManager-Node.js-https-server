const router = require("express").Router();
const path = require("path");
const {
  isAuthenticated,
  isOwner,
  isOwnDashboard,
  canAccessAdmin,
} = require("../middleware/auth");

router.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect(`/${req.user.id}/dashboard/users`);
  }
  res.sendFile(path.join(__dirname, "..", "views", "home.html"));
});

router.get("/:id/dashboard/:page", isOwnDashboard, (req, res) => {
  const allowedPages = ["users", "moderation", "settings", "me", "retrieval"];
  const page = req.params.page;

  if (!allowedPages.includes(page)) {
    return res.redirect(`/${req.params.id}/dashboard/users`);
  }
  res.sendFile(path.join(__dirname, "..", "views", "dashboard.html"));
});

router.get("/auth/key-login", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "key-login.html"));
});

router.get("/:id/adminka", canAccessAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "admin.html"));
});

module.exports = router;
