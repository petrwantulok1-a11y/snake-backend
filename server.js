import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 ENV
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role!
const FIO_TOKEN = process.env.FIO_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !FIO_TOKEN) {
  console.error("❌ Missing ENV variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SNAKE_PER_CZK = 1;

// ─────────────────────────────
// 🧑‍💻 GET /player/:id
// ─────────────────────────────
app.get('/player/:id', async (req, res) => {
  const playerId = req.params.id;

  let { data: player, error } = await supabase
    .from('players')
    .select('id, credits, vs_id')
    .eq('id', playerId)
    .single();

  if (error && error.code === 'PGRST116') {
    const vs_id = Date.now();

    const { data: newPlayer, error: insertErr } = await supabase
      .from('players')
      .insert({ id: playerId, credits: 0, vs_id })
      .select()
      .single();

    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    player = newPlayer;
  } else if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    player: player.id,
    credits: player.credits ?? 0,
    vs_id: player.vs_id,
  });
});

// ─────────────────────────────
// 💸 POST /create-payment
// ─────────────────────────────
app.post('/create-payment', async (req, res) => {
  const { player_id, amount } = req.body;

  if (!player_id || !amount) {
    return res.status(400).json({ error: 'Missing player_id or amount' });
  }

  const vs = String(Date.now());

  const qrString = `SPD*1.0*ACC:2803492685/2010*AM:${amount}*CC:CZK*X-VS:${vs}`;

  const { error } = await supabase.from('payments').insert({
    player_id,
    vs,
    amount,
    paid: false,
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ vs, qrString, amount });
});

// ─────────────────────────────
// 🔄 GET /check-payments
// ─────────────────────────────
app.get('/check-payments', async (req, res) => {
  try {
    const r = await fetch(
      `https://fioapi.fio.cz/v1/rest/last/${FIO_TOKEN}/transactions.json`
    );

    if (!r.ok) {
      return res.status(502).json({ error: 'FIO API error' });
    }

    const data = await r.json();
    const txs = data?.accountStatement?.transactionList?.transaction || [];

    const credited = [];

    for (const tx of txs) {
      const vs = tx.column5?.value;
      const amount = Number(tx.column1?.value);

      if (!vs || !amount || amount <= 0) continue;

      const { data: payment } = await supabase
        .from('payments')
        .select('*')
        .eq('vs', String(vs))
        .eq('paid', false)
        .maybeSingle();

      if (!payment) continue;

      const { data: player } = await supabase
        .from('players')
        .select('credits')
        .eq('id', payment.player_id)
        .single();

      if (!player) continue;

      const add = payment.amount * SNAKE_PER_CZK;
      const newCredits = (player.credits ?? 0) + add;

      await supabase
        .from('players')
        .update({ credits: newCredits })
        .eq('id', payment.player_id);

      await supabase
        .from('payments')
        .update({
          paid: true,
          paid_at: new Date().toISOString(),
        })
        .eq('id', payment.id);

      credited.push({
        player_id: payment.player_id,
        vs: payment.vs,
        added: add,
      });
    }

    res.json({ ok: true, credited });
  } catch (err) {
    console.error("❌ check-payments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────
// 🔁 AUTO CHECK každých 30s
// ─────────────────────────────
setInterval(async () => {
  try {
    const r = await fetch(
      `http://localhost:${process.env.PORT || 3000}/check-payments`
    );
    const j = await r.json();

    if (j.credited?.length) {
      console.log("💰 credited:", j.credited);
    }
  } catch (e) {
    console.error("Auto check error:", e.message);
  }
}, 30000);

// ─────────────────────────────
// 🚀 START SERVER
// ─────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
  console.log("SUPABASE:", !!SUPABASE_URL);
  console.log("FIO:", !!FIO_TOKEN);
});

// ─────────────────────────────
// 🛑 SAFE GUARDS
// ─────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err);
});
