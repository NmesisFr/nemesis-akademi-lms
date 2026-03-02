require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const csurf = require("csurf");

const { ensureSchema } = require("./src/db/db");

const authRoutes = require("./src/routes/auth.routes");
const dashboardRoutes = require("./src/routes/dashboard.routes");
const courseRoutes = require("./src/routes/courses.routes");
const adminRoutes = require("./src/routes/admin.routes");
const quizRoutes = require("./src/routes/quiz.routes");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

ensureSchema();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));

app.use(helmet());
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 60 * 1000, max: 180 }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);

// static assets only (NOT uploads)
app.use("/public", express.static(path.join(__dirname, "src", "public")));

app.use(
  csurf({
    cookie: false
  })
);

app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || "Akademi LMS";
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  next();
});

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  return res.redirect("/auth/login");
});

app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/courses", courseRoutes);
app.use("/admin", adminRoutes);
app.use("/quiz", quizRoutes);

app.use((err, req, res, next) => {
  if (err && err.code === "EBADCSRFTOKEN") {
    return res.status(403).send("CSRF doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.");
  }
  console.error(err);
  res.status(500).send("Sunucu hatası.");
});

app.listen(PORT, () => {
  console.log(`LMS çalışıyor: http://localhost:${PORT}`);
});
