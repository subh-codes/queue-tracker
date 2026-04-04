const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const initSqlJs = require("sql.js");

const app  = express();
app.use(express.json());

const PORT   = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "queue_history.db");

/* ════════════════════════════════════════════════
   DATABASE — sql.js (pure JS, no native build)
   ════════════════════════════════════════════════ */

let db = null;   // sql.js Database instance

async function initDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

  const SQL = await initSqlJs();

  // Load existing DB file if it exists, else create fresh
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      store       TEXT    NOT NULL,
      people      INTEGER NOT NULL,
      status      TEXT    NOT NULL,
      recorded_at TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_store_time ON snapshots(store, recorded_at)
  `);

  saveDb(); // persist initial state
  console.log("[DB] SQLite ready (sql.js)");
}

// Save DB to disk — call after every write
function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function insertSnapshot(store, people, status, now) {
  if (!db) return;
  db.run(
    "INSERT INTO snapshots (store, people, status, recorded_at) VALUES (?, ?, ?, ?)",
    [store, people, status, now]
  );
  saveDb();
}

function queryRows(store, since) {
  if (!db) return [];
  const stmt = db.prepare(
    "SELECT people, status, recorded_at FROM snapshots WHERE store = ? AND recorded_at >= ? ORDER BY recorded_at ASC"
  );
  stmt.bind([store, since]);
  const rows = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push(r);
  }
  stmt.free();
  return rows;
}

/* ════════════════════════════════════════════════
   STORE DATA — live memory (unchanged)
   ════════════════════════════════════════════════ */

const storeData = {
  timhortons: { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" },
  starbucks:  { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" },
  edojapan:   { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" }
};

/* ════════════════════════════════════════════════
   STATIC FILES (unchanged)
   ════════════════════════════════════════════════ */

app.use("/html", express.static(path.join(__dirname, "html")));
app.use("/css",  express.static(path.join(__dirname, "css")));
app.use("/js",   express.static(path.join(__dirname, "js")));

/* ════════════════════════════════════════════════
   ROOT (unchanged)
   ════════════════════════════════════════════════ */

app.get("/", (req, res) => {
  res.redirect("/html/main.html");
});

/* ════════════════════════════════════════════════
   GET QUEUE DATA (unchanged)
   ════════════════════════════════════════════════ */

app.get("/queue", (req, res) => {
  const store = (req.query.store || "timhortons").toLowerCase();
  if (!storeData[store]) return res.status(404).json({ error: "Store not found" });
  res.json(storeData[store]);
});

/* ════════════════════════════════════════════════
   UPDATE FROM PI — now also saves to DB
   ════════════════════════════════════════════════ */

app.post("/update", (req, res) => {
  const { store, people, busiest_hour_start, busiest_hour_end } = req.body;
  const storeName = (store || "").toLowerCase();

  if (!storeData[storeName]) return res.status(400).json({ error: "Invalid store" });

  const peopleCount = Number(people ?? 0);
  let status;
  if (peopleCount < 3)       status = "NOT BUSY";
  else if (peopleCount <= 6) status = "MODERATE";
  else                       status = "BUSY";

  const now = new Date().toISOString();

  storeData[storeName] = {
    people: peopleCount,
    status,
    updated: now,
    busiest_hour_start: busiest_hour_start ?? "--",
    busiest_hour_end:   busiest_hour_end   ?? "--"
  };

  try { insertSnapshot(storeName, peopleCount, status, now); }
  catch (e) { console.error("[DB] Insert failed:", e.message); }

  console.log(`[${storeName}] people: ${peopleCount} | status: ${status}`);
  res.json({ success: true, store: storeName });
});

/* ════════════════════════════════════════════════
   ADMIN ANALYTICS
   GET /admin-analytics?store=timhortons&period=today
   ════════════════════════════════════════════════ */

app.get("/admin-analytics", (req, res) => {
  const store  = (req.query.store  || "timhortons").toLowerCase();
  const period = (req.query.period || "today").toLowerCase();

  const now = new Date();
  let sinceDate;
  if (period === "weekly") {
    sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - 7);
  } else {
    sinceDate = new Date(now);
    sinceDate.setUTCHours(0, 0, 0, 0);
  }

  const rows = queryRows(store, sinceDate.toISOString());

  if (!rows.length) return res.json(emptyAnalytics(store, period));

  // Basic stats
  const counts   = rows.map(r => Number(r.people));
  const avgOcc   = counts.reduce((a, b) => a + b, 0) / counts.length;
  const maxOcc   = Math.max(...counts);
  const minOcc   = Math.min(...counts);

  // Hourly averages
  const buckets  = {};
  for (let h = 0; h < 24; h++) buckets[h] = [];
  rows.forEach(r => {
    const h = new Date(r.recorded_at).getHours();
    buckets[h].push(Number(r.people));
  });
  const hourlyAvg = Array.from({ length: 24 }, (_, h) => {
    const b = buckets[h];
    return { hour: h, avg: b.length ? Math.round(b.reduce((a, c) => a + c, 0) / b.length * 10) / 10 : null };
  });

  // Peak / slow hour
  const filled   = hourlyAvg.filter(h => h.avg !== null);
  const peakH    = filled.length ? filled.reduce((a, b) => a.avg > b.avg ? a : b) : null;
  const slowH    = filled.length ? filled.reduce((a, b) => a.avg < b.avg ? a : b) : null;

  // Total visitors (count upward jumps)
  let totalVisitors = 0, prev = null;
  rows.forEach(r => {
    const p = Number(r.people);
    if (prev !== null && p > prev) totalVisitors += (p - prev);
    prev = p;
  });

  // Status distribution (each row ≈ 1.5 s)
  const SECS = 1.5;
  const dist = { not_busy_mins: 0, moderate_mins: 0, busy_mins: 0 };
  rows.forEach(r => { dist[statusKey(r.status)] += SECS / 60; });
  dist.not_busy_mins = Math.round(dist.not_busy_mins);
  dist.moderate_mins  = Math.round(dist.moderate_mins);
  dist.busy_mins      = Math.round(dist.busy_mins);

  // Status change log
  let changes = 0, prevStatus = null;
  const statusLog = [];
  rows.forEach(r => {
    const s = (r.status || "UNKNOWN").toUpperCase();
    if (prevStatus !== null && s !== prevStatus) {
      changes++;
      statusLog.push({ time: r.recorded_at, from: prevStatus, to: s, people: Number(r.people) });
    }
    prevStatus = s;
  });

  res.json({
    store, period,
    peak_hour:           peakH ? formatHour(peakH.hour) : "--",
    slow_hour:           slowH ? formatHour(slowH.hour) : "--",
    total_visitors:      totalVisitors,
    avg_occupancy:       Math.round(avgOcc * 10) / 10,
    max_occupancy:       maxOcc,
    min_occupancy:       minOcc,
    status_changes:      changes,
    status_distribution: dist,
    hourly_avg:          hourlyAvg,
    status_log:          statusLog
  });
});

/* ════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════ */

function statusKey(s) {
  const u = (s || "").toUpperCase();
  if (u === "NOT BUSY") return "not_busy_mins";
  if (u === "MODERATE") return "moderate_mins";
  if (u === "BUSY")     return "busy_mins";
  return "not_busy_mins";
}

function formatHour(h) {
  if (h === 0)  return "12:00 AM";
  if (h < 12)   return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function emptyAnalytics(store, period) {
  return {
    store, period,
    peak_hour: "--", slow_hour: "--",
    total_visitors: 0, avg_occupancy: null,
    max_occupancy: null, min_occupancy: null,
    status_changes: 0,
    status_distribution: { not_busy_mins: 0, moderate_mins: 0, busy_mins: 0 },
    hourly_avg: Array.from({ length: 24 }, (_, h) => ({ hour: h, avg: null })),
    status_log: []
  };
}

/* ════════════════════════════════════════════════
   START
   ════════════════════════════════════════════════ */

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Queue Tracker Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to init DB:", err);
  process.exit(1);
});
