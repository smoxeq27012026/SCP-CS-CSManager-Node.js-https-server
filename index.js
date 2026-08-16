require("dotenv").config();

const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "https:", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      frameSrc: ["'self'", "https://challenges.cloudflare.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, 
  message: { error: "Слишком много попыток, попробуйте позже" },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Слишком много запросов" },
});

app.use("/auth", authLimiter);
app.use("/api", apiLimiter);

app.use(cors({ 
  origin: process.env.ALLOWED_ORIGIN || "https://data-dlx.pro", 
  credentials: true 
}));

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
