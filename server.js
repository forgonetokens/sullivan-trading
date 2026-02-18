require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const db_helpers = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Trust Railway's reverse proxy (required for HTTPS cookies & sessions) ──
app.set('trust proxy', 1);

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
const db = db_helpers.getDb();

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
    secure: process.env.NODE_ENV === 'production',
  },
}));

// ── Static files (public site) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Homepage route (EJS with blog teasers) ──
app.get('/', (req, res) => {
  const posts = db_helpers.listPublishedPosts(3);
  res.render('public/index', { posts });
});

// ── Blog routes ──
const blogRoutes = require('./routes/blog');
app.use('/blog', blogRoutes);

// ── Admin routes ──
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// ── Health check (for Railway) ──
app.get('/health', (req, res) => res.send('ok'));

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sullivan Trading running on port ${PORT}`);
  console.log(`Admin dashboard: /admin`);
});
