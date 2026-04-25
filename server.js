const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "database.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  try { return JSON.parse(fs.readFileSync(DATA_FILE)); } catch (e) { return { players: {}, processedTransactions: [], lastVsId: 888000000 }; }
}

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let db = loadData();

async function checkFioBank() {
  const FIO_TOKEN = process.env.FIO_TOKEN;
  if (!FIO_TOKEN) return;

  try {
    const today = new Date().toISOString().split('T')[0]; 
    console.log(`🔍 Kontroluji platby pro datum: ${today}`);
    
    // Změna na dotaz podle období (dnešek) - je to spolehlivější než /last/
    const url = `https://www.fio.cz/ib_api/rest/periods/${FIO_TOKEN}/${today}/${today}/transactions.json`;
    const response = await axios.get(url);
    
    const transactions = response.data.accountStatement.transactionList.transaction;
    if (!transactions) {
        console.log("📭 Žádné transakce pro dnešek.");
        return;
    }

    let changeMade = false;
    transactions.forEach(t => {
      const transactionId = t.column22 ? t.column22.value : null;
      const vs = t.column8 ? t.column8.value : null;
      const amount = t.column1 ? t.column1.value : 0;

      if (vs && transactionId && !db.processedTransactions.includes(transactionId)) {
        const playerName = Object.keys(db.players).find(name => db.players[name].vs_id == vs);
        if (playerName) {
          db.players[playerName].credits += Math.floor(amount);
          db.processedTransactions.push(transactionId);
          console.log(`✅ PŘIPSÁNO: ${playerName} +${amount} $SNAKE`);
          changeMade = true;
        }
      }
    });

    if (changeMade) saveData(db);
  } catch (error) {
    console.log("❌ Chyba banky (pravděpodobně limit dotazů):", error.message);
  }
}

// ZMĚNA: Interval 60 vteřin je minimum, co Fio snese dlouhodobě
setInterval(checkFioBank, 60000);

app.get("/player/:id", (req, res) => {
  const name = req.params.id;
  if (!db.players[name]) {
    db.lastVsId += 1;
    db.players[name] = { credits: 0, vs_id: db.lastVsId };
    saveData(db);
  }
  res.json(db.players[name]);
});

app.get("/debug/db", (req, res) => res.json(db));

app.listen(PORT, () => {
  console.log(`🚀 Server start na portu ${PORT}`);
  checkFioBank();
});
