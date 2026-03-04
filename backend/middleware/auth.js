const jwt           = require("jsonwebtoken");
const { query }     = require("../config/db");
const { getClient } = require("../config/redis");

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ── JWT blacklist check ─────────────────────────────────────────
    // Tokens are added to the blacklist by the logout route.
    // Key format: "jwt:bl:<userId>:<iat>" — unique per issued token.
    const redisClient = getClient();
    if (redisClient) {
      const blKey = `jwt:bl:${decoded.userId}:${decoded.iat}`;
      const revoked = await redisClient.get(blKey).catch(() => null);
      if (revoked) return res.status(401).json({ error: "Token has been revoked" });
    }

    const { rows } = await query(
      "SELECT id, email, name, role, is_active FROM users WHERE id = $1",
      [decoded.userId]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: "User not found or inactive" });
    }
    req.user  = rows[0];
    req.token = decoded; // expose decoded token for logout TTL calculation
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
};

module.exports = { authenticate, requireRole };
