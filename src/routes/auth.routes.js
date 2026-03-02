const express = require("express");
const bcrypt = require("bcrypt");
const { db } = require("../db/db");
const { isEmail, cleanText } = require("../middleware/validate");

const router = express.Router();

router.get("/login", (req, res) => res.render("auth_login", { error: null }));
router.get("/register", (req, res) => res.render("auth_register", { error: null }));

router.post("/register", (req, res) => {
  const full_name = cleanText(req.body.full_name, 120);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");

  if (!full_name || !isEmail(email) || password.length < 8) {
    return res.status(400).render("auth_register", { error: "Bilgiler hatalı. Şifre en az 8 karakter olmalı." });
  }

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).render("auth_register", { error: "Bu email zaten kayıtlı." });

  const password_hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare("INSERT INTO users(full_name,email,password_hash,role) VALUES (?,?,?,?)")
    .run(full_name, email, password_hash, "student");

  req.session.user = { id: info.lastInsertRowid, full_name, email, role: "student" };
  res.redirect("/dashboard");
});

router.post("/login", (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).render("auth_login", { error: "Email veya şifre hatalı." });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).render("auth_login", { error: "Email veya şifre hatalı." });

  req.session.user = { id: user.id, full_name: user.full_name, email: user.email, role: user.role };
  res.redirect("/dashboard");
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/auth/login"));
});

module.exports = router;
