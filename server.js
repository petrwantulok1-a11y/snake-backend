const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors()); // Nutné pro propojení s Lovable
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "database.json";

// --- DATABÁZE (Souborová) ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    // Startujeme s ID 888000001
    return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch (e) {
    return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// --- LOGIKA BANKY (FIO API) ---
async function checkFioBank() {
  const FIO_TOKEN = process.env.FIO_TOKEN;
  
  if (!FIO_TOKEN) {
    console.log("⚠️ POZOR: FIO_TOKEN není nastaven v Environment Variables na Renderu!");
    return;
  }

  try {
    console.log("🔍 Kontroluji banku (Fio API)...");
    // Používáme endpoint pro poslední pohyby
    const url = `https://www.fio.cz/ib_api/rest/last/${FIO_TOKEN}/transactions.json`;
    const response = await axios.get(url);
    
    // Pokud nejsou žádné nové pohyby, API může vrátit prázdný objekt
    const transactions = response.data.accountStatement.transactionList.transaction;

    if (!transactions || transactions.length === 0) {
      console.log("📭 Žádné nové platby k vyřízení.");
      return;
    }

    let changeMade = false;

    transactions.forEach(t => {
      // column22 = ID pohybu, column8 = Variabilní symbol, column1 = Částka
      const transactionId = t.column22 ? t.column22.value : null;
      const vs = t.column8 ? t.column8.value : null;
      const amount = t.column1 ? t.column1.value : 0;

      if (vs && transactionId && !db.processedTransactions.includes(transactionId)) {
        // Najdeme hráče podle vs_id
        const playerName = Object.keys(db.players).find(name => db.players[name].vs_id == vs);

        if (playerName) {
          db.players[playerName].credits += Math.floor(amount);
          db.processedTransactions.push(transactionId);
          console.log(`✅ PŘIPSÁNO: Hráč ${playerName} (VS: ${vs}) získal ${amount} $SNAKE.`);
          changeMade = true;
        } else {
          console.log(`ℹ️ Přišla platba s VS ${vs}, ale tento VS nepatří žádnému hráči.`);
        }
      }
    });

    if (changeMade) saveData(db);
  } catch (error) {
    if (error.response && error.response.status === 409) {
      console.log("❌ Fio API: Chyba 409 (Příliš časté dotazy). Interval 120s je nutný.");
    } else {
      console.error("❌ Chyba banky:", error.message);
    }
  }
}

// --- INTERVAL ---
// Fio banka vyžaduje rozestup mezi dotazy aspoň 30-60 sekund.
// Nastavujeme 120 sekund (2 minuty) pro jistotu stabilitu na Renderu.
setInterval(checkFioBank, 120000);

// --- API CESTY ---

app.get("/", (req, res) => {
  res.send("Snake Backend (Numeric VS) je online! 🚀 Sleduji Fio banku každé 2 minuty.");
});

// Získání hráče nebo vytvoření nového
app.get("/player/:id", (req, res) => {
  const name = req.params.id;

  if (!db.players[name]) {
    db.lastVsId += 1;
    db.players[name] = {
      credits: 0,
      vs_id: db.lastVsId
    };
    saveData(db);
    console.log(`🆕 Registrace: ${name} dostal VS: ${db.lastVsId}`);
  }

  res.json({
    player: name,
    credits: db.players[name].credits,
    vs_id: db.players[name].vs_id
  });
});

// Debug pro tebe (uvidíš všechna data v prohlížeči)
app.get("/debug/db", (req, res) => res.json(db));

// Spuštění
app.listen(PORT, () => {
  console.log(`🚀 Server běží na portu ${PORT}`);
  // První kontrola proběhne hned po startu
  checkFioBank();
});
