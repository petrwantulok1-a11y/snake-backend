import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// ===== ENV =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const FIO_TOKEN = process.env.FIO_TOKEN;

// ===== FIO API =====
async function fetchNewBankPayments() {
  const token = FIO_TOKEN;

  if (!token) {
    console.error("❌ FIO_TOKEN není nastaven");
    return [];
  }

  try {
    const url = `https://www.fio.cz/ib_api/rest/last/${token}/transactions.json`;

    const response = await fetch(url);
    const json = await response.json();

    const transactions =
      json?.accountStatement?.transactionList?.transaction || [];

    return transactions.map((t) => ({
      id: t.column22?.value,               // ID transakce
      amount: Number(t.column1?.value),   // částka
      variableSymbol: t.column5?.value,   // VS
    }));

  } catch (err) {
    console.error("❌ Fio fetch error:", err.message);
    return [];
  }
}

// ===== PŘIČTENÍ KREDITŮ =====
async function addCreditsToPlayer(playerId, amount) {
  const { data: existing } = await supabase
    .from("players")
    .select("credits")
    .eq("id", playerId)
    .maybeSingle();

  const current = existing?.credits || 0;
  const updated = current + amount;

  const { error } = await supabase
    .from("players")
    .upsert({ id: playerId, credits: updated }, { onConflict: "id" });

  if (error) throw new Error(error.message);
}

// ===== GET PLAYER =====
app.get("/player/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let { data } = await supabase
      .from("players")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    // pokud hráč neexistuje → vytvoř
    if (!data) {
      const vs_id = 888000000 + Math.floor(Math.random() * 999999);

      const { data: created, error } = await supabase
        .from("players")
        .insert({ id, credits: 0, vs_id })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return res.json(created);
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CHECK PAYMENTS =====
app.get("/check-payments", async (req, res) => {
  try {
    const payments = await fetchNewBankPayments();
    const results = [];

    for (const p of payments) {
      if (!p.variableSymbol) continue;

      // už zpracováno?
      const { data: exists } = await supabase
        .from("processed_payments")
        .select("payment_id")
        .eq("payment_id", p.id)
        .maybeSingle();

      if (exists) continue;

      // najdi hráče podle VS
      const { data: player } = await supabase
        .from("players")
        .select("id")
        .eq("vs_id", Number(p.variableSymbol))
        .maybeSingle();

      if (!player) continue;

      const credits = Math.floor(p.amount);

      await addCreditsToPlayer(player.id, credits);

      await supabase.from("processed_payments").insert({
        payment_id: p.id,
        player_id: player.id,
        amount: credits,
      });

      results.push({
        player: player.id,
        added: credits,
      });
    }

    res.json({ ok: true, processed: results });

  } catch (err) {
    console.error("❌ check-payments error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== START =====
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 Server běží na portu " + PORT);
});
