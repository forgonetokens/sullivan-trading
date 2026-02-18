const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sullivan.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    // Migrate: add hero_image column if missing
    const cols = db.prepare("PRAGMA table_info(posts)").all();
    if (!cols.find(c => c.name === 'hero_image')) {
      db.exec("ALTER TABLE posts ADD COLUMN hero_image TEXT");
    }
  }
  return db;
}

// --- Invoice helpers ---

function nextInvoiceNumber() {
  const row = getDb().prepare(
    `SELECT invoice_number FROM invoices ORDER BY id DESC LIMIT 1`
  ).get();
  if (!row) return 'INV-0001';
  const num = parseInt(row.invoice_number.replace('INV-', ''), 10);
  return `INV-${String(num + 1).padStart(4, '0')}`;
}

function createInvoice({ customer_name, customer_email, notes, lineItems }) {
  const db = getDb();
  const invoice_number = nextInvoiceNumber();
  const total_cents = lineItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_price_cents, 0
  );

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_name, customer_email, notes, total_cents)
      VALUES (?, ?, ?, ?, ?)
    `).run(invoice_number, customer_name, customer_email || null, notes || null, total_cents);

    const invoiceId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?)
    `);

    for (const li of lineItems) {
      insertItem.run(invoiceId, li.description, li.quantity, li.unit_price_cents);
    }

    return invoiceId;
  });

  return insert();
}

function getInvoice(id) {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;
  invoice.line_items = db.prepare(
    'SELECT * FROM invoice_line_items WHERE invoice_id = ?'
  ).all(id);
  return invoice;
}

function getInvoiceByNumber(invoiceNumber) {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
  if (!invoice) return null;
  invoice.line_items = db.prepare(
    'SELECT * FROM invoice_line_items WHERE invoice_id = ?'
  ).all(invoice.id);
  return invoice;
}

function listInvoices({ status, search } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];

  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (customer_name LIKE ? OR invoice_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

function updateInvoiceStripe(id, { stripe_product_id, stripe_price_id, stripe_payment_link_id, stripe_payment_link_url }) {
  getDb().prepare(`
    UPDATE invoices
    SET stripe_product_id = ?, stripe_price_id = ?, stripe_payment_link_id = ?, stripe_payment_link_url = ?, status = 'pending', sent_at = datetime('now')
    WHERE id = ?
  `).run(stripe_product_id, stripe_price_id, stripe_payment_link_id, stripe_payment_link_url, id);
}

function markInvoicePaid(stripeCheckoutSessionId) {
  getDb().prepare(`
    UPDATE invoices
    SET status = 'paid', stripe_checkout_session_id = ?, paid_at = datetime('now')
    WHERE stripe_payment_link_id IN (
      SELECT stripe_payment_link_id FROM invoices
      WHERE stripe_checkout_session_id IS NULL AND status = 'pending'
    ) AND stripe_checkout_session_id IS NULL
  `).run(stripeCheckoutSessionId);
}

function markInvoicePaidByPaymentLink(paymentLinkId, checkoutSessionId) {
  getDb().prepare(`
    UPDATE invoices
    SET status = 'paid', stripe_checkout_session_id = ?, paid_at = datetime('now')
    WHERE stripe_payment_link_id = ? AND status IN ('pending', 'overdue')
  `).run(checkoutSessionId, paymentLinkId);
}

function markOverdueInvoices() {
  getDb().prepare(`
    UPDATE invoices
    SET status = 'overdue'
    WHERE status = 'pending' AND sent_at < datetime('now', '-30 days')
  `).run();
}

function getDashboardStats() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(total_cents), 0) as total
     FROM invoices WHERE status IN ('pending', 'paid', 'overdue') GROUP BY status`
  ).all();
  const stats = {
    pending: { count: 0, total: 0 },
    paid: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
  };
  for (const row of rows) {
    stats[row.status] = { count: row.count, total: row.total };
  }
  return stats;
}

function getRecentInvoices(limit = 10) {
  return getDb().prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT ?').all(limit);
}

// --- Post helpers ---

function createPost({ title, slug, excerpt, body, status, hero_image }) {
  const db = getDb();
  const published_at = status === 'published' ? new Date().toISOString() : null;
  const result = db.prepare(`
    INSERT INTO posts (title, slug, excerpt, body, status, published_at, hero_image)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, slug, excerpt || null, body || null, status || 'draft', published_at, hero_image || null);
  return result.lastInsertRowid;
}

function updatePost(id, { title, slug, excerpt, body, status, hero_image }) {
  const db = getDb();
  const existing = db.prepare('SELECT status, published_at FROM posts WHERE id = ?').get(id);
  let published_at = existing ? existing.published_at : null;
  if (status === 'published' && !published_at) {
    published_at = new Date().toISOString();
  }
  if (status === 'draft') {
    published_at = null;
  }
  db.prepare(`
    UPDATE posts SET title = ?, slug = ?, excerpt = ?, body = ?, status = ?,
      updated_at = datetime('now'), published_at = ?, hero_image = ?
    WHERE id = ?
  `).run(title, slug, excerpt || null, body || null, status || 'draft', published_at, hero_image || null, id);
}

function deletePost(id) {
  getDb().prepare('DELETE FROM posts WHERE id = ?').run(id);
}

function getPost(id) {
  return getDb().prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

function getPostBySlug(slug) {
  return getDb().prepare('SELECT * FROM posts WHERE slug = ? AND status = ?').get(slug, 'published');
}

function listPosts() {
  return getDb().prepare('SELECT * FROM posts ORDER BY id DESC').all();
}

function listPublishedPosts(limit) {
  let sql = 'SELECT * FROM posts WHERE status = ? ORDER BY published_at DESC';
  const params = ['published'];
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return getDb().prepare(sql).all(...params);
}

module.exports = {
  getDb,
  nextInvoiceNumber,
  createInvoice,
  getInvoice,
  getInvoiceByNumber,
  listInvoices,
  updateInvoiceStripe,
  markInvoicePaid,
  markInvoicePaidByPaymentLink,
  markOverdueInvoices,
  getDashboardStats,
  getRecentInvoices,
  createPost,
  updatePost,
  deletePost,
  getPost,
  getPostBySlug,
  listPosts,
  listPublishedPosts,
};
