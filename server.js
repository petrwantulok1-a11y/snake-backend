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
  if (!FIO_TOKEN) return console.log("❌ Chybí TOKEN v nastavení Renderu!");

  try {
    const d = new Date();
    const today = d.toISOString().split('T')[0];
    d.setDate(d.getDate() - 7); // Koukneme týden zpátky
    const weekAgo = d.toISOString().split('T')[0];

    console.log(`🔍 DIAGNÓZA: Kontroluji účet od ${weekAgo} do ${today}`);
    
    const url = `https://www.fio.cz/ib_api/rest/periods/${FIO_TOKEN}/${weekAgo}/${today}/transactions.json`;
    const response = await axios.get(url);
    
    if (response.data && response.data.accountStatement) {
        const info = response.data.accountStatement.info;
        const transList = response.data.accountStatement.transactionList;
        
        // VYPÍŠEME ČÍSLO ÚČTU PRO KONTROLU
        console.log(`🏦 API je napojeno na účet: ${info.accountId} (Zůstatek: ${info.closingBalance} ${info.currency})`);
        
        const count = transList && transList.transaction ? transList.transaction.length : 0;
        console.log(`📊 Počet nalezených transakcí v historii: ${count}`);
        
        if (count > 0) {
            const lastThree = transList.transaction.slice(-3);
            console.log("👀 Poslední 3 VS v historii:", lastThree.map(t => t.column8 ? t.column8.value : "bez VS"));
        }
    }

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
          console.log(`💰 PŘIPSÁNO: ${playerName} +${amount}`);
          changeMade = true;
        }
      }
    });

    if (changeMade) saveData(db);
  } catch (error) {
    console.log("❌ Chyba spojení:", error.message);
  }
}

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
  console.log(`🚀 Diagnostický server běží...`);
  checkFioBank();
});
