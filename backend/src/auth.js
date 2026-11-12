const { query } = require('./db');
const { AppError } = require('./errors');

async function authenticate(req, _res, next) {
  try {
    const id = req.header('x-user-id');
    if (!id) throw new AppError(401, 'Missing x-user-id header');
    const { rows } = await query('SELECT id, name, role FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw new AppError(401, 'Unknown user');
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

const requireRole = (role) => (req, _res, next) =>
  req.user.role === role ? next() : next(new AppError(403, `Only ${role} users can do this`));

module.exports = { authenticate, requireRole };
