const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/user/workspaces — list all workspaces for current user
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT w.id, w.name, w.smtp_username, w.package_id, w.status, w.whmcs_service_id, w.created_at,
             p.name as package_name, p.monthly_limit
      FROM workspaces w
      LEFT JOIN packages p ON p.id = w.package_id
      WHERE w.user_id = $1
      ORDER BY w.created_at ASC
    `, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/workspaces/current — return current workspace from JWT
router.get('/current', (req, res) => {
  res.json(req.workspace);
});

// POST /api/user/workspaces/:id/switch — issue new JWT for a different workspace
router.post('/:id/switch', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT w.*, p.name as package_name, p.monthly_limit
      FROM workspaces w
      LEFT JOIN packages p ON p.id = w.package_id
      WHERE w.id = $1 AND w.user_id = $2
    `, [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Workspace not found' });
    if (rows[0].status !== 'active') return res.status(403).json({ error: 'Workspace suspended' });

    const token = jwt.sign(
      { id: req.user.id, role: req.user.role, workspace_id: rows[0].id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    res.json({ token, workspace: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/user/workspaces/:id/rename
router.put('/:id/rename', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await db.query(
      'UPDATE workspaces SET name=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *',
      [name.trim(), req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
