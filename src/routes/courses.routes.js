const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const { db } = require("../db/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText } = require("../middleware/validate");
const { sendCertificateRequestEmail } = require("../middleware/mailer");

const router = express.Router();

const uploadsRoot = path.join(__dirname, "..", "..", "uploads");
const materialsDir = path.join(uploadsRoot, "materials");
if (!fs.existsSync(materialsDir)) fs.mkdirSync(materialsDir, { recursive: true });

function safeFileName(name) {
  const base = String(name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const stamp = Date.now().toString(36);
  return `${stamp}_${base}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, materialsDir),
    filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    cb(ok ? null : new Error("Sadece PDF yüklenebilir."), ok);
  }
});

function canAccessCourse(reqUser, course) {
  if (!reqUser) return false;
  if (reqUser.role === "admin") return true;
  if (course.instructor_id === reqUser.id) return true;
  if (course.is_published === 1) return true;
  return false;
}

function canAccessMaterials(reqUser, course, isEnrolled) {
  if (!reqUser) return false;
  if (reqUser.role === "admin") return True;
}

router.get("/", requireAuth, (req, res) => {
  const u = req.session.user;

  const courses = db.prepare(`
    SELECT c.*, u.full_name AS instructor_name
    FROM courses c
    JOIN users u ON u.id = c.instructor_id
    WHERE c.is_published = 1 OR c.instructor_id = ? OR ?='admin'
    ORDER BY c.created_at DESC
  `).all(u.id, u.role);

  const enrolled = db.prepare("SELECT course_id FROM enrollments WHERE user_id=?").all(u.id)
    .map(r => r.course_id);

  res.render("courses_list", { courses, enrolled });
});

router.get("/:id", requireAuth, (req, res) => {
  const u = req.session.user;
  const id = Number(req.params.id);

  const course = db.prepare(`
    SELECT c.*, u.full_name AS instructor_name
    FROM courses c
    JOIN users u ON u.id = c.instructor_id
    WHERE c.id = ?
  `).get(id);
  if (!course) return res.status(404).send("Kurs bulunamadı.");

  const canView = course.is_published === 1 || course.instructor_id === u.id || u.role === "admin";
  if (!canView) return res.status(403).send("Bu kurs yayınlanmamış.");

  const lessons = db.prepare(`
    SELECT l.*,
      COALESCE(lp.completed,0) AS completed
    FROM lessons l
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
    WHERE l.course_id = ?
    ORDER BY l.sort_order ASC, l.id ASC
  `).all(u.id, id);

  const enrollment = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?")
    .get(u.id, id);

  const total = lessons.length;
  const done = lessons.filter(x => x.completed === 1).length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  const quiz = db.prepare("SELECT * FROM quizzes WHERE course_id=?").get(id);

  const materials = db.prepare(`
    SELECT id, original_name, size_bytes, uploaded_at
    FROM course_materials
    WHERE course_id=?
    ORDER BY uploaded_at DESC
  `).all(id);

  // allow material viewing only if enrolled or instructor/admin
  const canSeeMaterials = !!enrollment || course.instructor_id === u.id || u.role === "admin";

  res.render("course_detail", { course, lessons, enrollment, progressPct, quiz, materials, canSeeMaterials });
});

router.post("/:id/enroll", requireAuth, (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.id);

  const course = db.prepare("SELECT id, is_published FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (course.is_published !== 1) return res.status(403).send("Kurs yayınlanmamış.");

  try {
    db.prepare("INSERT INTO enrollments(user_id, course_id) VALUES (?,?)").run(u.id, courseId);
  } catch (e) {}
  res.redirect(`/courses/${courseId}`);
});

router.post("/lesson/:lessonId/complete", requireAuth, (req, res) => {
  const u = req.session.user;
  const lessonId = Number(req.params.lessonId);

  const lesson = db.prepare("SELECT id, course_id FROM lessons WHERE id=?").get(lessonId);
  if (!lesson) return res.status(404).send("Ders yok.");

  const enr = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?")
    .get(u.id, lesson.course_id);
  if (!enr) return res.status(403).send("Önce kursa katılmalısın.");

  const existing = db.prepare("SELECT id FROM lesson_progress WHERE user_id=? AND lesson_id=?")
    .get(u.id, lessonId);

  if (existing) {
    db.prepare("UPDATE lesson_progress SET completed=1, completed_at=datetime('now') WHERE id=?")
      .run(existing.id);
  } else {
    db.prepare("INSERT INTO lesson_progress(user_id, lesson_id, completed, completed_at) VALUES (?,?,1,datetime('now'))")
      .run(u.id, lessonId);
  }

  res.redirect(`/courses/${lesson.course_id}`);
});

/** Materials download (controlled) */
router.get("/:courseId/materials/:materialId/download", requireAuth, (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);
  const materialId = Number(req.params.materialId);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");

  const enrollment = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?")
    .get(u.id, courseId);

  const can = !!enrollment || course.instructor_id === u.id || u.role === "admin";
  if (!can) return res.status(403).send("Bu materyali indirmek için kursa kayıtlı olmalısın.");

  const mat = db.prepare("SELECT * FROM course_materials WHERE id=? AND course_id=?").get(materialId, courseId);
  if (!mat) return res.status(404).send("Materyal yok.");

  const filePath = path.join(materialsDir, mat.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send("Dosya bulunamadı.");

  res.download(filePath, mat.original_name);
});

/** Instructor/Admin course management */
router.get("/manage/mine", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const courses = (u.role === "admin")
    ? db.prepare(`SELECT c.*, u.full_name instructor_name FROM courses c JOIN users u ON u.id=c.instructor_id ORDER BY c.created_at DESC`).all()
    : db.prepare(`SELECT * FROM courses WHERE instructor_id=? ORDER BY created_at DESC`).all(u.id);

  res.render("course_manage", { courses });
});

router.post("/manage/create", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const title = cleanText(req.body.title, 160);
  const category = cleanText(req.body.category, 80) || "Kişisel Gelişim";
  const level = cleanText(req.body.level, 40) || "Başlangıç";
  const description = cleanText(req.body.description, 4000);

  if (!title) return res.status(400).send("Başlık zorunlu.");

  const info = db.prepare(`
    INSERT INTO courses(title,category,description,level,is_published,instructor_id)
    VALUES (?,?,?,?,0,?)
  `).run(title, category, description, level, u.id);

  res.redirect(`/courses/manage/${info.lastInsertRowid}/edit`);
});

router.get("/manage/:id/edit", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const id = Number(req.params.id);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(id);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const lessons = db.prepare("SELECT * FROM lessons WHERE course_id=? ORDER BY sort_order ASC, id ASC").all(id);

  const materials = db.prepare(`
    SELECT id, original_name, size_bytes, uploaded_at
    FROM course_materials
    WHERE course_id=?
    ORDER BY uploaded_at DESC
  `).all(id);

  res.render("course_edit", { course, lessons, materials, error: null });
});

router.post("/manage/:id/update", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const id = Number(req.params.id);
  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(id);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const title = cleanText(req.body.title, 160);
  const category = cleanText(req.body.category, 80);
  const level = cleanText(req.body.level, 40);
  const description = cleanText(req.body.description, 4000);
  const is_published = req.body.is_published === "on" ? 1 : 0;

  if (!title) return res.status(400).send("Başlık zorunlu.");

  db.prepare(`
    UPDATE courses SET title=?, category=?, level=?, description=?, is_published=?
    WHERE id=?
  `).run(title, category, level, description, is_published, id);

  res.redirect(`/courses/manage/${id}/edit`);
});

router.post("/manage/:id/lessons/add", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.id);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const title = cleanText(req.body.title, 160);
  const content = cleanText(req.body.content, 6000);
  const sort_order = Number(req.body.sort_order || 1);

  if (!title) return res.status(400).send("Ders başlığı zorunlu.");

  db.prepare("INSERT INTO lessons(course_id,title,content,sort_order) VALUES (?,?,?,?)")
    .run(courseId, title, content, sort_order);

  res.redirect(`/courses/manage/${courseId}/edit`);
});

router.get("/manage/lesson/:lessonId/edit", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const lessonId = Number(req.params.lessonId);

  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id
    FROM lessons l
    JOIN courses c ON c.id=l.course_id
    WHERE l.id=?
  `).get(lessonId);
  if (!lesson) return res.status(404).send("Ders yok.");
  if (u.role !== "admin" && lesson.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  res.render("lesson_edit", { lesson });
});

router.post("/manage/lesson/:lessonId/update", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const lessonId = Number(req.params.lessonId);

  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id
    FROM lessons l
    JOIN courses c ON c.id=l.course_id
    WHERE l.id=?
  `).get(lessonId);
  if (!lesson) return res.status(404).send("Ders yok.");
  if (u.role !== "admin" && lesson.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const title = cleanText(req.body.title, 160);
  const content = cleanText(req.body.content, 8000);
  const sort_order = Number(req.body.sort_order || lesson.sort_order);

  db.prepare("UPDATE lessons SET title=?, content=?, sort_order=? WHERE id=?")
    .run(title, content, sort_order, lessonId);

  res.redirect(`/courses/manage/${lesson.course_id}/edit`);
});

router.post("/manage/lesson/:lessonId/delete", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const lessonId = Number(req.params.lessonId);

  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id
    FROM lessons l
    JOIN courses c ON c.id=l.course_id
    WHERE l.id=?
  `).get(lessonId);
  if (!lesson) return res.status(404).send("Ders yok.");
  if (u.role !== "admin" && lesson.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  db.prepare("DELETE FROM lessons WHERE id=?").run(lessonId);
  res.redirect(`/courses/manage/${lesson.course_id}/edit`);
});

/** Upload PDF material */
router.post("/manage/:id/materials/upload", requireRole("instructor", "admin"), upload.single("pdf"), (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.id);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  if (!req.file) return res.status(400).send("Dosya alınamadı.");

  db.prepare(`
    INSERT INTO course_materials(course_id, original_name, stored_name, mime_type, size_bytes)
    VALUES (?,?,?,?,?)
  `).run(courseId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size);

  res.redirect(`/courses/manage/${courseId}/edit`);
});

/** Delete material */
router.post("/manage/:courseId/materials/:materialId/delete", requireRole("instructor", "admin"), (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.courseId);
  const materialId = Number(req.params.materialId);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");
  if (u.role !== "admin" && course.instructor_id !== u.id) return res.status(403).send("Yetkisiz.");

  const mat = db.prepare("SELECT * FROM course_materials WHERE id=? AND course_id=?").get(materialId, courseId);
  if (!mat) return res.status(404).send("Materyal yok.");

  // delete DB first
  db.prepare("DELETE FROM course_materials WHERE id=?").run(materialId);

  // delete file best-effort
  const filePath = path.join(materialsDir, mat.stored_name);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}

  res.redirect(`/courses/manage/${courseId}/edit`);
});

/** Certificate request */
router.post("/:id/certificate/request", requireAuth, async (req, res) => {
  const u = req.session.user;
  const courseId = Number(req.params.id);

  const course = db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if (!course) return res.status(404).send("Kurs yok.");

  const enr = db.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?")
    .get(u.id, courseId);
  if (!enr) return res.status(403).send("Önce kursa katılmalısın.");

  const lessons = db.prepare("SELECT id FROM lessons WHERE course_id=?").all(courseId);
  const total = lessons.length;

  const done = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM lesson_progress lp
    JOIN lessons l ON l.id=lp.lesson_id
    WHERE lp.user_id=? AND lp.completed=1 AND l.course_id=?
  `).get(u.id, courseId).cnt;

  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
  if (progressPct < 100) return res.status(400).send("Belge için kursu %100 tamamlamalısın.");

  try {
    db.prepare("INSERT INTO certificate_requests(user_id, course_id) VALUES (?,?)")
      .run(u.id, courseId);
  } catch (e) {
    return res.status(409).send("Bu kurs için belge talebin zaten alınmış.");
  }

  const to = process.env.CERT_TO_EMAIL || "compedant@gmail.com";
  try {
    await sendCertificateRequestEmail({
      to,
      appName: process.env.APP_NAME || "Akademi LMS",
      user: u,
      course
    });
  } catch (e) {
    console.error("Mail gönderim hatası:", e);
  }

  return res.redirect(`/courses/${courseId}`);
});

module.exports = router;
