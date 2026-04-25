import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 ENV
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role!
const FIO_TOKEN = process.env.FIO_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SNAKE_PER_CZK = 1;

// ─────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────
app.get("/player/:id", async (req, res) => {
  const playerId = req.params.id;

  let { data: player, error } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single();

  if (error && error.code === "PGRST116") {
    const { data: newPlayer, error: insertErr } = await supabase
      .from("players")
      .insert({
        id: playerId,
        credits: 0,
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    player = newPlayer;
  }

  res.json({
    player: player.id,
    credits: player.credits || 0,
  });
});

// ─────────────────────────────────────────
// CREATE PAYMENT
// ─────────────────────────────────────────
app.post("/create-payment", async (req, res) => {
  try {
    const { player_id, amount } = req.body;

    if (!player_id || !amount) {
      return res.status(400).json({ error: "Missing data" });
    }

    const vs = String(Date.now());

    const qrString = `SPD*1.0*ACC:2803492685/2010*AM:${amount}*CC:CZK*X-VS:${vs}`;

    const { error } = await supabase.from("payments").insert({
      player_id,
      vs,
      amount,
      paid: false,
    });

    if (error) {
      console.error("DB INSERT ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log("CREATED PAYMENT:", { player_id, vs, amount });

    res.json({ vs, qrString, amount });
  } catch (e) {
    console.error("CREATE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────
// CHECK PAYMENTS (FIO)
// ─────────────────────────────────────────
app.get("/check-payments", async (req, res) => {
  try {
    const from = new Date(Date.now() - 2 * 86400000)
      .toISOString()
      .split("T")[0];

    const to = new Date().toISOString().split("T")[0];

    const url = `https://fioapi.fio.cz/v1/rest/periods/${FIO_TOKEN}/${from}/${to}/transactions.json`;

    const r = await fetch(url);

    if (!r.ok) {
      return res.status(500).json({ error: "FIO API ERROR" });
    }

    const json = await r.json();

    const txs =
      json?.accountStatement?.transactionList?.transaction || [];

    const credited = [];

    for (const tx of txs) {
      const vs =
        tx.column5?.value ||
        tx.column22?.value ||
        null;

      const amount = Number(tx.column1?.value);

      if (!vs || !amount || amount <= 0) continue;

      console.log("TX:", { vs, amount });

      const { data: payment } = await supabase
        .from("payments")
        .select("*")
        .eq("vs", String(vs))
        .eq("paid", false)
        .maybeSingle();

      if (!payment) continue;

      const { data: player } = await supabase
        .from("players")
        .select("credits")
        .eq("id", payment.player_id)
        .single();

      const add = payment.amount * SNAKE_PER_CZK;
      const newCredits = (player.credits || 0) + add;

      await supabase
        .from("players")
        .update({ credits: newCredits })
        .eq("id", payment.player_id);

      await supabase
        .from("payments")
        .update({
          paid: true,
          paid_at: new Date().toISOString(),
        })
        .eq("id", payment.id);

      credited.push({
        player_id: payment.player_id,
        vs,
        added: add,
      });

      console.log("CREDITED:", payment.player_id, add);
    }

    res.json({ ok: true, credited });
  } catch (e) {
    console.error("CHECK ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────
// AUTO CHECK (každých 30s)
// ─────────────────────────────────────────
setInterval(async () => {
  try {
    const r = await fetch(
      `http://localhost:${process.env.PORT || 3000}/check-payments`
    );
    const j = await r.json();

    if (j.credited?.length) {
      console.log("AUTO CREDIT:", j.credited);
    }
  } catch (e) {
    console.error("AUTO ERROR:", e.message);
  }
}, 30000);

// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUNNING ON", PORT));
