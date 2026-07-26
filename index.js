require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path"); // <-- ДОБАВИТЬ

const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const dashboardRoutes = require("./routes/dashboard");
const auth2faRoutes = require("./routes/auth2fa");
const sessionStore = require("./config/session-store");
const { csrfProtection, csrfToken } = require("./middleware/csrf");

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
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

app.use(csrfToken);
app.use("/api", (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    return csrfProtection(req, res, next);
  }
  next();
});

app.use(passport.initialize());
app.use(passport.session());
require("./middleware/passport-setup");

app.use(express.static("public"));
app.use("/auth", auth2faRoutes);
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/", dashboardRoutes);

app.use((req, res) => {
  res.status(404).render("404", { csrfToken: req.session?.csrfToken || "" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 2Сервер запущен на порту ${PORT}`));
