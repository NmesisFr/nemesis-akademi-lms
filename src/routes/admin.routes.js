const express = require("express");
const { db } = require("../db/db");
const { requireRole } = require("../middleware/auth");
const { cleanText } = require("../middleware/validate");

const router = express.Router();

router.get("/users", requireRole("admin"), (req, res) => {
  const users = db.prepare("SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC").all();
  res.render("admin_users", { users, error: null });
});

router.post("/users/:id/role", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const role = cleanText(req.body.role, 20);

  if (!["admin", "instructor", "student"].includes(role)) return res.status(400).send("Rol hatalı.");
  db.prepare("UPDATE users SET role=? WHERE id=?").run(role, id);

  res.redirect("/admin/users");
});

router.get("/courses", requireRole("admin"), (req, res) => {
  const courses = db.prepare(`
    SELECT c.*, u.full_name instructor_name
    FROM courses c
    JOIN users u ON u.id=c.instructor_id
    ORDER BY c.created_at DESC
  `).all();

  res.render("admin_courses", { courses });
});

module.exports = router;
