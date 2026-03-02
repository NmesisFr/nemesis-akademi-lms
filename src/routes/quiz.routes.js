const express = require("express");
const { db } = require("../db/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText } = require("../middleware/validate");

const router = express.Router();

router.get("/manage/:courseId", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  let quiz = db.prepare("SELECT * FROM quizzes WHERE course_id=?").get(courseId);
  if (!quiz) {
    const info = db.prepare("INSERT INTO quizzes(course_id,title) VALUES (?,?)").run(courseId, "Quiz");
    quiz = db.prepare("SELECT * FROM quizzes WHERE id=?").get(info.lastInsertRowid);
  }
  const questions = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY id DESC").all(quiz.id);
  res.render("quiz_manage", { course, quiz, questions, error: null });
});

router.post("/manage/:courseId/questions/add", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const quiz = db.prepare("SELECT * FROM quizzes WHERE course_id=?").get(courseId);
  if (!quiz) return res.status(400).send("Quiz yok.");

  const question = cleanText(req.body.question, 300);
  const option_a = cleanText(req.body.option_a, 150);
  const option_b = cleanText(req.body.option_b, 150);
  const option_c = cleanText(req.body.option_c, 150);
  const option_d = cleanText(req.body.option_d, 150);
  const correct_option = cleanText(req.body.correct_option, 1).toUpperCase();

  if (!question || !option_a || !option_b || !option_c || !option_d) return res.status(400).send("Alanlar zorunlu.");
  if (!["A","B","C","D"].includes(correct_option)) return res.status(400).send("Doğru seçenek hatalı.");

  db.prepare(`
    INSERT INTO quiz_questions(quiz_id,question,option_a,option_b,option_c,option_d,correct_option)
    VALUES (?,?,?,?,?,?,?)
  `).run(quiz.id, question, option_a, option_b, option_c, option_d, correct_option);

  res.redirect(`/quiz/manage/${courseId}`);
});

router.post("/manage/question/:id/delete", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const id = Number(req.params.id);

  const q = db.prepare(`
    SELECT qq.id, qq.quiz_id, qz.course_id, c.instructor_id
    FROM quiz_questions qq
    JOIN quizzes qz ON qz.id=qq.quiz_id
    JOIN courses c ON c.id=qz.course_id
    WHERE qq.id=?
  `).get(id);

  if (!q) return res.status(404).send("Soru yok.");
  if (u.role !== "admin" && q.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  db.prepare("DELETE FROM quiz_questions WHERE id=?").run(id);
  res.redirect(`/quiz/manage/${q.course_id}`);
});

router.get("/take/:courseId", requireAuth, (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);

  const enr = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?").get(u.id, courseId);
  if (!enr) return res.status(403).send("Önce kursa katılmalısın.");

  const quiz = db.prepare("SELECT * FROM quizzes WHERE course_id=?").get(courseId);
  if (!quiz) return res.status(404).send("Quiz yok.");
  const questions = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY id ASC").all(quiz.id);

  res.render("quiz_take", { courseId, quiz, questions, error: null });
});

router.post("/submit/:courseId", requireAuth, (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);

  const enr = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?").get(u.id, courseId);
  if (!enr) return res.status(403).send("Önce kursa katılmalısın.");

  const quiz = db.prepare("SELECT * FROM quizzes WHERE course_id=?").get(courseId);
  if (!quiz) return res.status(404).send("Quiz yok.");
  const questions = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=?").all(quiz.id);

  let score = 0;
  for (const q of questions) {
    const ans = String(req.body[`q_${q.id}`] || "").toUpperCase();
    if (ans && ans === q.correct_option) score += 1;
  }

  db.prepare("INSERT INTO quiz_attempts(quiz_id,user_id,score,total) VALUES (?,?,?,?)")
    .run(quiz.id, u.id, score, questions.length);

  res.redirect(`/quiz/result/${quiz.id}`);
});

router.get("/result/:quizId", requireAuth, (req, res) => {
  const u = req.session.user;
  const quizId = Number(req.params.quizId);

  const quiz = db.prepare("SELECT * FROM quizzes WHERE id=?").get(quizId);
  if (!quiz) return res.status(404).send("Quiz yok.");

  const attempt = db.prepare(`
    SELECT * FROM quiz_attempts
    WHERE quiz_id=? AND user_id=?
    ORDER BY attempted_at DESC
    LIMIT 1
  `).get(quizId, u.id);

  if (!attempt) return res.status(404).send("Sonuç yok.");

  res.render("quiz_result", { quiz, attempt });
});

module.exports = router;
