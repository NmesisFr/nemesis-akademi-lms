const express = require("express");
const { db } = require("../db/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const u = req.session.user;

  const myEnrollments = db.prepare(`
    SELECT c.*, e.enrolled_at
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ?
    ORDER BY e.enrolled_at DESC
  `).all(u.id);

  const myCourses = (u.role === "instructor" || u.role === "admin")
    ? (u.role === "admin"
        ? db.prepare(`SELECT c.*, u.full_name instructor_name FROM courses c JOIN users u ON u.id=c.instructor_id ORDER BY c.created_at DESC`).all()
        : db.prepare(`SELECT * FROM courses WHERE instructor_id=? ORDER BY created_at DESC`).all(u.id))
    : [];

  res.render("dashboard", { myEnrollments, myCourses });
});

module.exports = router;
