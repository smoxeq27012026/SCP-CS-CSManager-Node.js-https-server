const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ["identify", "guilds", "guilds.members.read"],
    },
    (accessToken, refreshToken, profile, done) => {
      // Здесь можно сохранять пользователя в БД, но пока просто передаём профиль
      return done(null, profile);
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      const enrichedProfile = {
        ...profile,
        id: `google_${profile.id}`,
        username: profile.displayName,
        avatar: profile.photos?.[0]?.value || "https://cdn.discordapp.com/embed/avatars/0.png",
        provider: "google",
      };
      return done(null, enrichedProfile);
    }
  )
);