const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

// 🔑 Fio token
const FIO_TOKEN = process.env.FIO_TOKEN;

// 🔗 Fio API (poslední dny)
const ACCOUNT_URL = `https://fioapi.fio.cz/v1/rest/periods/${FIO_TOKEN}/2026-04-20/2026-04-30/transactions.json`;

const PLAYERS_FILE = "players.json";
const PROCESSED_FILE = "processed.json";

// načtení
function load(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file));
}

// uložení
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let players = load(PLAYERS_FILE, {});
let processed = load(PROCESSED_FILE, []);


// 🔥 hlavní funkce
app.get("/check-payments", async (req, res) => {
  try {
    const response = await axios.get(ACCOUNT_URL);

    const transactions =
      response.data.accountStatement.transactionList.transaction;

    let added = 0;

    for (let tx of transactions) {
      const id = tx.column22.value; // ID transakce

      if (processed.includes(id)) continue;

      const amount = tx.column1.value;
      const vs = tx.column5?.value;

      if (!vs) continue;

      // 👉 přičti hráči podle VS
      if (!players[vs]) players[vs] = 0;

      players[vs] += amount;
      added++;

      processed.push(id);
    }

    save(PLAYERS_FILE, players);
    save(PROCESSED_FILE, processed);

    res.json({
      added,
      players
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chyba při načítání plateb" });
  }
});


// 🔥 získání kreditu
app.get("/player/:id", (req, res) => {
  const id = req.params.id;

  res.json({
    credits: players[id] || 0
  });
});


app.listen(PORT, () => {
  console.log("Server běží na portu " + PORT);
});
