
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_creation: 'always',
      phone_number_collection: { enabled: true },
      line_items: req.body.items.map(item => ({
        price_data: {
          currency: 'cad',
          product_data: { name: item.product },
          unit_amount: Math.round(Number(item.price) * 100),
        },
        quantity: item.quantity,
      })),
      success_url: 'https://pre-owned-website.netlify.app/success',
      cancel_url: 'https://pre-owned-website.netlify.app/cart',
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (request, response) => {
  const sig = request.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(request.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;
    const items = JSON.parse(metadata?.cart || "[]");
    const phone = session.customer_details?.phone?.replace(/\D/g, '');

    const order = { id: session.id, email: session.customer_email, phone: phone, items };
    const orders = JSON.parse(fs.readFileSync('orders.json'));
    orders.push(order);
    fs.writeFileSync('orders.json', JSON.stringify(orders, null, 2));

    const emailText = items.map(item => `• ${item.quantity} x ${item.product} - $${item.price}`).join('\n');

    // Admin notification
    const msgToAdmin = {
      to: 'ageofwireless1919@gmail.com',
      from: 'ageofwireless1919@gmail.com',
      subject: 'New Order Confirmation',
      text: `You have a new order:\n\n${emailText}`,
    };

    // SMS to you
    const msgToYou = {
      to: '6474667521@msg.telus.com',
      from: 'ageofwireless1919@gmail.com',
      subject: '',
      text: `New Order:\n${emailText}`,
    };

    // SMS to customer via Telus email (if phone valid)
    const msgToCustomer = phone
      ? {
          to: `${phone}@msg.telus.com`,
          from: 'ageofwireless1919@gmail.com',
          subject: '',
          text: `Thank you! Your order is confirmed.\n${emailText}`,
        }
      : null;

    sgMail.send(msgToAdmin).then(() => console.log('Admin email sent'));
    sgMail.send(msgToYou).then(() => console.log('SMS to YOU sent'));
    if (msgToCustomer) {
      sgMail.send(msgToCustomer).then(() => console.log('SMS to customer sent'));
    }
  }

  response.json({ received: true });
});

app.get('/orders.json', (req, res) => {
  const orders = JSON.parse(fs.readFileSync('orders.json'));
  res.json(orders);
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
