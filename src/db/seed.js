require("dotenv").config();
const bcrypt = require("bcrypt");
const { db, ensureSchema } = require("./db");

(() => {
  ensureSchema();

  const upsertUser = (full_name, email, password, role) => {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const password_hash = bcrypt.hashSync(password, 12);
    if (existing) {
      db.prepare("UPDATE users SET full_name=?, password_hash=?, role=? WHERE id=?")
        .run(full_name, password_hash, role, existing.id);
      return existing.id;
    }
    const info = db.prepare("INSERT INTO users(full_name,email,password_hash,role) VALUES (?,?,?,?)")
      .run(full_name, email, password_hash, role);
    return info.lastInsertRowid;
  };

  const instId = upsertUser("Eğitmen", "egitmen@akademi.local", "Egitmen123!", "instructor");
  upsertUser("Admin", "admin@akademi.local", "Admin123!", "admin");

  const course = db.prepare("SELECT id FROM courses WHERE title=?").get("Öz Disiplin ve Alışkanlıklar");
  let courseId = course?.id;

  if (!courseId) {
    const info = db.prepare(`
      INSERT INTO courses(title,category,description,level,is_published,instructor_id)
      VALUES (?,?,?,?,?,?)
    `).run(
      "Öz Disiplin ve Alışkanlıklar",
      "Kişisel Gelişim",
      "Kişisel hedeflerine sistem kurarak ulaş: alışkanlık tasarımı, takip, motivasyon yönetimi.",
      "Başlangıç",
      1,
      instId
    );
    courseId = info.lastInsertRowid;

    const addLesson = db.prepare(`INSERT INTO lessons(course_id,title,content,sort_order) VALUES (?,?,?,?)`);
    addLesson.run(courseId, "1) Sistem Kurma", "Hedef -> süreç -> ölçüm: küçük ama sürekli adımlar.", 1);
    addLesson.run(courseId, "2) Alışkanlık Tasarımı", "Tetikleyici + davranış + ödül döngüsü.", 2);
    addLesson.run(courseId, "3) Takip ve İyileştirme", "Haftalık değerlendirme ve ayarlama.", 3);

    const qInfo = db.prepare("INSERT INTO quizzes(course_id,title) VALUES (?,?)")
      .run(courseId, "Öz Disiplin Quiz");
    const quizId = qInfo.lastInsertRowid;

    const addQ = db.prepare(`
      INSERT INTO quiz_questions(quiz_id,question,option_a,option_b,option_c,option_d,correct_option)
      VALUES (?,?,?,?,?,?,?)
    `);
    addQ.run(quizId, "Alışkanlık döngüsünde temel bileşenlerden biri hangisidir?", "Tetikleyici", "Şans", "Rastgelelik", "Belirsizlik", "A");
    addQ.run(quizId, "Sürdürülebilir değişim için en iyi yaklaşım hangisi?", "Büyük adımlar", "Bir anda mükemmellik", "Küçük ve sürekli adımlar", "Sadece motivasyon", "C");
  }

  console.log("Seed tamamlandı.");
  console.log("Admin: admin@akademi.local / Admin123!");
  console.log("Eğitmen: egitmen@akademi.local / Egitmen123!");
})();
