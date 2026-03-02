function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.session.user;
    if (!u) return res.redirect("/auth/login");
    if (!roles.includes(u.role)) return res.status(403).send("Yetkisiz.");
    next();
  };
}

module.exports = { requireAuth, requireRole };
