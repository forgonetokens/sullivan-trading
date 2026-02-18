const express = require('express');
const router = express.Router();
const db = require('../db/database');

// NOTE: This route uses express.raw() middleware, NOT express.json().
// It must be registered BEFORE body parsers in server.js.

router.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook configuration error');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send('Webhook signature verification failed');
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentLinkId = session.payment_link;
    const checkoutSessionId = session.id;

    if (paymentLinkId) {
      db.markInvoicePaidByPaymentLink(paymentLinkId, checkoutSessionId);
      console.log(`Invoice paid via payment link ${paymentLinkId}`);
    }
  }

  res.json({ received: true });
});

module.exports = router;
