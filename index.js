require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const dashboardRoutes = require("./routes/dashboard");
const auth2faRoutes = require("./routes/auth2fa");
const sessionStore = require("./config/session-store");

const app = express();

app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: true,
    sameSite: "lax"
  }
}));

app.use(passport.initialize());
app.use(passport.session());
require("./middleware/passport-setup");

app.use(express.static("public"));
app.use("/auth", auth2faRoutes);
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/", dashboardRoutes);

app.use((req, res) => {
  res.status(404).sendFile(require("path").join(__dirname, "views", "404.html"));
});

async function require2FA(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  // Проверяем, требуется ли 2FA для этого пользователя
  const { data: user, error } = await supabase
    .from('users')
    .select('two_factor_enabled, two_factor_verified')
    .eq('id', req.session.userId)
    .single();
  
  if (user && user.two_factor_enabled && !user.two_factor_verified) {
    // Сохраняем URL куда пользователь хотел попасть
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/2fa');
  }
  
  next();
}

app.get('/dashboard', require2FA, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/*', require2FA, async (req, res) => {
  
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 2Сервер запущен на порту ${PORT}`));
