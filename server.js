const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "database.json";

// --- DATABÁZE ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  try { return JSON.parse(fs.readFileSync(DATA_FILE)); } catch (e) { return { players: {}, processedTransactions: [], lastVsId: 888000000 }; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let db = loadData();

// --- LOGIKA BANKY (FIO) ---
async function checkFioBank() {
  const FIO_TOKEN = process.env.FIO_TOKEN;
  if (!FIO_TOKEN) return;

  try {
    const d = new Date();
    const today = d.toISOString().split('T')[0];
    d.setDate(d.getDate() - 2); // Koukneme 2 dny zpět pro jistotu
    const yesterday = d.toISOString().split('T')[0];

    const url = `https://www.fio.cz/ib_api/rest/periods/${FIO_TOKEN}/${yesterday}/${today}/transactions.json`;
    const response = await axios.get(url);
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
          console.log(`✅ PŘIPSÁNO: ${playerName} +${amount} mincí.`);
          changeMade = true;
        }
      }
    });
    if (changeMade) saveData(db);
  } catch (error) {
    console.log("🔍 Fio polling...");
  }
}

setInterval(checkFioBank, 60000); // Kontrola každou minutu

// --- API ENDPOINTY ---

// 1. Získání info o hráči
app.get("/player/:id", (req, res) => {
  const name = req.params.id;
  if (!db.players[name]) {
    db.lastVsId += 1;
    db.players[name] = { credits: 0, vs_id: db.lastVsId };
    saveData(db);
  }
  res.json(db.players[name]);
});

// 2. VYTVOŘENÍ PLATBY (Ten bod, co ti házel 404)
app.post("/create-payment", (req, res) => {
  const { player_id, amount } = req.body;
  
  if (!player_id || !amount) {
    return res.status(400).json({ error: "Chybí player_id nebo amount" });
  }

  const player = db.players[player_id];
  if (!player) {
    return res.status(404).json({ error: "Hráč nenalezen" });
  }

  // Vygenerujeme Paylibo string (QR kód)
  const accountNumber = "2803492685";
  const bankCode = "2010";
  const vs = player.vs_id;
  
  // Formát pro QR platbu (Czech standard)
  const qrString = `SPD*1.0*ACC:${accountNumber+bankCode}*AM:${amount}*CC:CZK*X-VS:${vs}*MSG:SnakeCoin`;

  console.log(`🎫 Generuji platbu pro ${player_id}: ${amount} Kč (VS: ${vs})`);
  
  res.json({
    qrString: qrString,
    vs: vs,
    account: accountNumber + "/" + bankCode
  });
});

// 3. Debug
app.get("/debug/db", (req, res) => res.json(db));

app.listen(PORT, () => {
  console.log(`🚀 Server běží na portu ${PORT}`);
  checkFioBank();
});
