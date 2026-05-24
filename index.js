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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 2Сервер запущен на порту ${PORT}`));
