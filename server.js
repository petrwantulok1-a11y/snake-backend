const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

// 🔐 token z Renderu
const FIO_TOKEN = process.env.FIO_TOKEN;

const ACCOUNT_URL = `https://fioapi.fio.cz/v1/rest/periods/${FIO_TOKEN}/2026-04-01/2026-04-30/transactions.json`;

const PROCESSED_FILE = "processed.json";
const PLAYERS_FILE = "players.json";

function loadJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let processed = loadJSON(PROCESSED_FILE, []);
let players = loadJSON(PLAYERS_FILE, {});

app.get("/check-payments", async (req, res) => {
  try {
    const response = await axios.get(ACCOUNT_URL);

    const transactions =
      response.data?.accountStatement?.transactionList?.transaction || [];

    const formatted = transactions.map((t) => ({
      id: t.column22?.value,
      amount: parseFloat(t.column1?.value),
      vs: t.column5?.value,
    }));

    const credited = [];

    for (const t of formatted) {
      if (processed.includes(t.id)) continue;
      if (!t.vs || !t.amount) continue;

      const playerId = t.vs;

      if (!players[playerId]) {
        players[playerId] = { credits: 0 };
      }

      players[playerId].credits += t.amount;

      credited.push({
        playerId,
        added: t.amount,
        totalCredits: players[playerId].credits,
      });

      processed.push(t.id);
    }

    saveJSON(PROCESSED_FILE, processed);
    saveJSON(PLAYERS_FILE, players);

    res.json({
      success: true,
      newPayments: credited.length,
      credited,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.get("/player/:id", (req, res) => {
  const player = players[req.params.id];
  res.json(player || { credits: 0 });
});

app.get("/", (req, res) => {
  res.send("Backend běží ✅");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server běží na portu " + PORT);
});