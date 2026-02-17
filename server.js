require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { getDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Webhook route FIRST (needs raw body for Stripe signature) ──
const webhookRoutes = require('./routes/webhooks');
app.use('/webhooks', webhookRoutes);

// ── Body parsers (after webhooks) ──
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── View engine ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Session store (SQLite) ──
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = getDb();

app.use(session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 900000 },
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ── Static files (public site) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Admin routes ──
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// ── Start ──
app.listen(PORT, () => {
  console.log(`Sullivan Trading running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
