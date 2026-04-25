const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "database.json";

// --- POMOCNÉ FUNKCE ---

function generateIban(accountNumber, bankCode) {
  // Rozdělení na prefix a číslo
  const parts = accountNumber.split('-');
  const prefix = parts.length > 1 ? parts[0].padStart(6, '0') : '000000';
  const number = (parts.length > 1 ? parts[1] : parts[0]).padStart(10, '0');
  const bank = bankCode.padStart(4, '0');
  
  // Výpočet kontrolního čísla (CZ = 1235)
  // Formát pro výpočet: BankCode + Prefix + Number + 1235 + 00
  const checkString = `${bank}${prefix}${number}123500`;
  
  // Modulo 97 pomocí BigInt (protože číslo je obrovské)
  const checksum = 98n - (BigInt(checkString) % 97n);
  const cd = checksum.toString().padStart(2, '0');
  
  return `CZ${cd}${bank}${prefix}${number}`;
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { players: {}, processedTransactions: [], lastVsId: 888000000 };
  try { return JSON.parse(fs.readFileSync(DATA_FILE)); } catch (e) { return { players: {}, processedTransactions: [], lastVsId: 888000000 }; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let db = loadData();

// --- BANKOVNÍ LOGIKA ---
async function checkFioBank() {
  const FIO_TOKEN = process.env.FIO_TOKEN;
  if (!FIO_TOKEN) return;
  try {
    const url = `https://www.fio.cz/ib_api/rest/last/${FIO_TOKEN}/transactions.json`;
    const response = await axios.get(url);
    const transactions = response.data.accountStatement.transactionList.transaction;
    if (!transactions) return;

    let changeMade = false;
    transactions.forEach(t => {
      const vs = t.column8 ? t.column8.value : null;
      const amount = t.column1 ? t.column1.value : 0;
      const tid = t.column22 ? t.column22.value : null;

      if (vs && tid && !db.processedTransactions.includes(tid)) {
        const playerName = Object.keys(db.players).find(name => db.players[name].vs_id == vs);
        if (playerName) {
          db.players[playerName].credits += Math.floor(amount);
          db.processedTransactions.push(tid);
          console.log(`✅ PŘIPSÁNO: ${playerName} +${amount}`);
          changeMade = true;
        }
      }
    });
    if (changeMade) saveData(db);
  } catch (e) { console.log("🔍 Banka odpočívá..."); }
}
setInterval(checkFioBank, 60000);

// --- API CESTY ---

app.get("/", (req, res) => res.send("Backend jede a počítá IBAN! 🏦"));

app.get("/player/:id", (req, res) => {
  const name = req.params.id;
  if (!db.players[name]) {
    db.lastVsId += 1;
    db.players[name] = { credits: 0, vs_id: db.lastVsId };
    saveData(db);
  }
  res.json(db.players[name]);
});

app.post("/create-payment", (req, res) => {
  const player_id = req.body.player_id || req.body.hráč_id;
  const amount = req.body.amount || req.body.množství;

  if (!player_id) return res.status(400).json({ error: "Chybí hráč_id" });
  const player = db.players[player_id];
  if (!player) return res.status(404).json({ error: "Hráč nenalezen" });

  const vs = player.vs_id;
  const accountNo = "2803492685";
  const bankCode = "2010";
  
  // TADY JE TA OPRAVA: Generujeme IBAN přímo pro QR kód
  const iban = generateIban(accountNo, bankCode);
  const qrString = `SPD*1.0*ACC:${iban}*AM:${amount}*CC:CZK*X-VS:${vs}*MSG:SnakeCoin`;

  console.log(`🎫 Generuji IBAN platbu: ${iban} (VS: ${vs})`);

  res.json({ 
    qrString, 
    vs, 
    account: `${accountNo}/${bankCode}`,
    iban: iban 
  });
});

app.get("/debug/db", (req, res) => res.json(db));

app.listen(PORT, () => {
  console.log(`🚀 Server startuje na ${PORT}`);
  checkFioBank();
});
