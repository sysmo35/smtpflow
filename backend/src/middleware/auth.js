const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    const { rows } = await db.query('SELECT id, email, name, role, status FROM users WHERE id = $1', [payload.id]);
    if (!rows[0]) return res.status(401).json({ error: 'User not found' });
    if (rows[0].status !== 'active') return res.status(403).json({ error: 'Account suspended' });
    req.user = rows[0];

    // Load workspace for non-admin users
    if (rows[0].role !== 'admin') {
      let wsResult;
      if (payload.workspace_id) {
        wsResult = await db.query(
          'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2',
          [payload.workspace_id, rows[0].id]
        );
      } else {
        wsResult = await db.query(
          'SELECT * FROM workspaces WHERE user_id = $1 ORDER BY created_at LIMIT 1',
          [rows[0].id]
        );
      }
      if (!wsResult.rows[0]) return res.status(403).json({ error: 'Workspace not found' });
      if (wsResult.rows[0].status !== 'active') return res.status(403).json({ error: 'Workspace suspended' });
      req.workspace = wsResult.rows[0];
    } else {
      req.workspace = null;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireUser };
