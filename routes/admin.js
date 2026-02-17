const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db/database');

// --- Login ---
router.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { password } = req.body;
  const hash = process.env.ADMIN_PASSWORD_HASH;

  if (!hash || hash.trim() === '') {
    return res.render('admin/login', { error: 'Admin password not configured. Run: npm run hash-password' });
  }

  try {
    const match = await bcrypt.compare(password || '', hash);
    if (match) {
      req.session.authenticated = true;
      const returnTo = req.session.returnTo || '/admin';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    }
    res.render('admin/login', { error: 'Invalid password.' });
  } catch (err) {
    res.render('admin/login', { error: 'Authentication error.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// --- Dashboard ---
router.get('/', requireAuth, (req, res) => {
  db.markOverdueInvoices();
  const stats = db.getDashboardStats();
  const invoices = db.getRecentInvoices(10);
  res.render('admin/dashboard', {
    stats,
    invoices,
    success: req.session.flash_success,
    error: req.session.flash_error,
  });
  delete req.session.flash_success;
  delete req.session.flash_error;
});

// --- Invoice List ---
router.get('/invoices', requireAuth, (req, res) => {
  const { status, search } = req.query;
  const invoices = db.listInvoices({ status, search });
  res.render('admin/invoices', {
    invoices,
    status: status || 'all',
    search: search || '',
    success: req.session.flash_success,
    error: req.session.flash_error,
  });
  delete req.session.flash_success;
  delete req.session.flash_error;
});

// --- New Invoice Form ---
router.get('/invoices/new', requireAuth, (req, res) => {
  res.render('admin/invoice-new', { error: null, success: null });
});

// --- Create Invoice ---
router.post('/invoices', requireAuth, async (req, res) => {
  try {
    const { customer_name, customer_email, notes } = req.body;
    const descriptions = [].concat(req.body.description || req.body['description[]'] || []);
    const quantities = [].concat(req.body.quantity || req.body['quantity[]'] || []);
    const unitPrices = [].concat(req.body.unit_price || req.body['unit_price[]'] || []);

    if (!customer_name || descriptions.length === 0) {
      return res.render('admin/invoice-new', { error: 'Customer name and at least one line item are required.', success: null });
    }

    const lineItems = descriptions.map((desc, i) => ({
      description: desc,
      quantity: parseInt(quantities[i], 10) || 1,
      unit_price_cents: Math.round(parseFloat(unitPrices[i]) * 100) || 0,
    })).filter(li => li.description && li.unit_price_cents > 0);

    if (lineItems.length === 0) {
      return res.render('admin/invoice-new', { error: 'At least one valid line item is required.', success: null });
    }

    const invoiceId = db.createInvoice({ customer_name, customer_email, notes, lineItems });
    const invoice = db.getInvoice(invoiceId);

    // Create Stripe Payment Link
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey && stripeKey.startsWith('sk_')) {
      const stripe = require('stripe')(stripeKey);
      const product = await stripe.products.create({
        name: `Invoice ${invoice.invoice_number} — ${customer_name}`,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: invoice.total_cents,
        currency: 'usd',
      });

      const paymentLink = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { invoice_id: String(invoiceId), invoice_number: invoice.invoice_number },
      });

      db.updateInvoiceStripe(invoiceId, {
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        stripe_payment_link_id: paymentLink.id,
        stripe_payment_link_url: paymentLink.url,
      });

      req.session.flash_success = `Invoice ${invoice.invoice_number} created with payment link.`;
    } else {
      req.session.flash_success = `Invoice ${invoice.invoice_number} created (Stripe not configured — no payment link generated).`;
    }

    res.redirect(`/admin/invoices/${invoiceId}`);
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.render('admin/invoice-new', { error: `Error creating invoice: ${err.message}`, success: null });
  }
});

// --- Invoice Detail ---
router.get('/invoices/:id', requireAuth, (req, res) => {
  const invoice = db.getInvoice(req.params.id);
  if (!invoice) {
    req.session.flash_error = 'Invoice not found.';
    return res.redirect('/admin/invoices');
  }
  res.render('admin/invoice-detail', {
    invoice,
    success: req.session.flash_success,
    error: req.session.flash_error,
  });
  delete req.session.flash_success;
  delete req.session.flash_error;
});

module.exports = router;
