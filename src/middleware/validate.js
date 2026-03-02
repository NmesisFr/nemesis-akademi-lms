function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function cleanText(s, max = 5000) {
  const t = String(s || "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

module.exports = { isEmail, cleanText };
