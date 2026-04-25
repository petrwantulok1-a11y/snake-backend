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
  if (!FIO_TOKEN) return console.log("❌ Chybí TOKEN!");

  try {
    // Koukneme se na včerejšek i dnešek (pro jistotu kvůli časovým pásmům)
    const d = new Date();
    const today = d.toISOString().split('T')[0];
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().split('T')[0];

    console.log(`🔍 DEBUG: Kontroluji období od ${yesterday} do ${today}`);
    
    const url = `https://www.fio.cz/ib_api/rest/periods/${FIO_TOKEN}/${yesterday}/${today}/transactions.json`;
    const response = await axios.get(url);
    
    // --- TADY JE TEN DEBUG VÝPIS ---
    if (response.data && response.data.accountStatement) {
        const transList = response.data.accountStatement.transactionList;
        const count = transList && transList.transaction ? transList.transaction.length : 0;
        console.log(`📊 Banka vrátila ${count} transakcí.`);
        
        // Pokud tam něco je, vypíšeme to do logu pro kontrolu
        if (count > 0) {
            console.log("👀 Seznam VS v bance:", transList.transaction.map(t => t.column8 ? t.column8.value : "bez VS"));
        }
    } else {
        console.log("❓ Divná odpověď z banky (chybí accountStatement)");
    }
    // ------------------------------

    const transactions = response.data.accountStatement.transactionList.transaction;
    if (!transactions) return;

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
          console.log(`✅ ÚSPĚCH: Hráč ${playerName} dostal ${amount} mincí.`);
          changeMade = true;
        }
      }
    });

    if (changeMade) saveData(db);
  } catch (error) {
    console.log("❌ Chyba banky:", error.message);
  }
}

// Necháme 60 vteřin
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
  console.log(`🚀 Deep Debug Server Start`);
  checkFioBank();
});
