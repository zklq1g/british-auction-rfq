const express = require('express');
const { authenticate, requireRole } = require('./auth');
const { query } = require('./db');
const rfqService = require('./rfqService');
const { placeBid } = require('./bidService');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// For the frontend role switcher (no auth needed)
router.get('/users', wrap(async (_req, res) => {
  const { rows } = await query('SELECT id, name, role FROM users ORDER BY id');
  res.json(rows);
}));

router.use(authenticate);

router.post('/rfqs', requireRole('BUYER'), wrap(async (req, res) => {
  res.status(201).json(await rfqService.createRfq(req.user, req.body));
}));

router.get('/rfqs', wrap(async (_req, res) => {
  res.json(await rfqService.listRfqs());
}));

router.get('/rfqs/:id', wrap(async (req, res) => {
  res.json(await rfqService.getRfqDetails(req.params.id));
}));

router.post('/rfqs/:id/bids', requireRole('SUPPLIER'), wrap(async (req, res) => {
  res.status(201).json(await placeBid(req.params.id, req.user, req.body));
}));

module.exports = router;
