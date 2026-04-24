const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors()); // Povolí Lovable připojit se k tvému API
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "database.json";

// Načtení dat (hráči + zpracované platby)
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// --- FUNKCE PRO KONTROLU BANKY ---
async function checkFioBank() {
  const FIO_TOKEN = process.env.FIO_TOKEN;
  
  if (!FIO_TOKEN) {
    console.log("⚠️ FIO_TOKEN není nastaven!");
    return;
  }

  try {
    console.log("🔍 Kontroluji bankovní účet...");
    const url = `https://www.fio.cz/ib_api/rest/last/${FIO_TOKEN}/transactions.json`;
    const response = await axios.get(url);
    
    const transactions = response.data.accountStatement.transactionList.transaction;

    if (!transactions || transactions.length === 0) return;

    let changeMade = false;

    transactions.forEach(t => {
      const transactionId = t.column22 ? t.column22.value : null;
      const vs = t.column8 ? t.column8.value : null; // Číselný VS
      const amount = t.column1 ? t.column1.value : 0;

      if (vs && transactionId && !db.processedTransactions.includes(transactionId)) {
        // Najdeme hráče podle jeho číselného VS
        const playerName = Object.keys(db.players).find(name => db.players[name].vs_id == vs);

        if (playerName) {
          db.players[playerName].credits += Math.floor(amount);
          db.processedTransactions.push(transactionId);
          console.log(`✅ PLATBA: Hráč ${playerName} (VS: ${vs}) +${amount} mincí.`);
          changeMade = true;
        }
      }
    });

    if (changeMade) saveData(db);
  } catch (error) {
    console.error("❌ Chyba banky:", error.message);
  }
}

// Kontrola každých 60 vteřin
setInterval(checkFioBank, 60000);

// --- API CESTY ---

app.get("/", (req, res) => res.send("Snake Backend (Numeric VS) is online! 🚀"));

// Získání nebo vytvoření hráče
app.get("/player/:id", (req, res) => {
  const name = req.params.id;

  if (!db.players[name]) {
    db.lastVsId += 1;
    db.players[name] = {
      credits: 0,
      vs_id: db.lastVsId
    };
    saveData(db);
    console.log(`🆕 Nový hráč: ${name} s VS: ${db.lastVsId}`);
  }

  res.json({
    player: name,
    credits: db.players[name].credits,
    vs_id: db.players[name].vs_id
  });
});

// Debug cesta - uvidíš stav celé databáze
app.get("/debug/db", (req, res) => res.json(db));

app.listen(PORT, () => {
  console.log(`🚀 Server běží na portu ${PORT}`);
  checkFioBank();
});
