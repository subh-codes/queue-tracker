const express = require("express");
const path    = require("path");
const Database = require("better-sqlite3");
const fs      = require("fs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ════════════════════════════════════════════════
   DATABASE SETUP
   ════════════════════════════════════════════════ */

// Create data folder if it doesn't exist
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, "queue_history.db"));

// Create snapshots table once
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store       TEXT    NOT NULL,
    people      INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    recorded_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_store_time ON snapshots(store, recorded_at);
`);

// Prepared statement for fast inserts
const insertSnapshot = db.prepare(
  "INSERT INTO snapshots (store, people, status, recorded_at) VALUES (?, ?, ?, ?)"
);

/* ════════════════════════════════════════════════
   STORE DATA — live memory (unchanged)
   ════════════════════════════════════════════════ */

const storeData = {
  timhortons: {
    people: 0,
    status: "UNKNOWN",
    updated: null,
    busiest_hour_start: "--",
    busiest_hour_end: "--"
  },
  starbucks: {
    people: 0,
    status: "UNKNOWN",
    updated: null,
    busiest_hour_start: "--",
    busiest_hour_end: "--"
  },
  edojapan: {
    people: 0,
    status: "UNKNOWN",
    updated: null,
    busiest_hour_start: "--",
    busiest_hour_end: "--"
  }
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
  if (!storeData[store]) {
    return res.status(404).json({ error: "Store not found" });
  }
  res.json(storeData[store]);
});

/* ════════════════════════════════════════════════
   UPDATE FROM PI — now also saves to DB
   ════════════════════════════════════════════════ */

app.post("/update", (req, res) => {
  const { store, people, busiest_hour_start, busiest_hour_end } = req.body;
  const storeName = (store || "").toLowerCase();

  if (!storeData[storeName]) {
    return res.status(400).json({ error: "Invalid store" });
  }

  const peopleCount = Number(people ?? 0);
  let status;
  if (peopleCount < 3)      status = "NOT BUSY";
  else if (peopleCount <= 6) status = "MODERATE";
  else                       status = "BUSY";

  const now = new Date().toISOString();

  // Update live memory (unchanged)
  storeData[storeName] = {
    people: peopleCount,
    status,
    updated: now,
    busiest_hour_start: busiest_hour_start ?? "--",
    busiest_hour_end:   busiest_hour_end   ?? "--"
  };

  // Save snapshot to SQLite for analytics
  try {
    insertSnapshot.run(storeName, peopleCount, status, now);
  } catch (e) {
    console.error("[DB] Insert failed:", e.message);
  }

  console.log(`[${storeName}] people: ${peopleCount} | status: ${status}`);

  res.json({ success: true, store: storeName });
});

/* ════════════════════════════════════════════════
   ADMIN ANALYTICS ENDPOINT
   GET /admin-analytics?store=timhortons&period=today
   ════════════════════════════════════════════════ */

app.get("/admin-analytics", (req, res) => {
  const store  = (req.query.store  || "timhortons").toLowerCase();
  const period = (req.query.period || "today").toLowerCase();

  // Determine time window
  const now       = new Date();
  let   sinceDate;

  if (period === "weekly") {
    sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - 7);
  } else {
    // today — midnight UTC
    sinceDate = new Date(now);
    sinceDate.setUTCHours(0, 0, 0, 0);
  }

  const since = sinceDate.toISOString();

  // Fetch all rows for this store in the time window
  const rows = db.prepare(
    "SELECT people, status, recorded_at FROM snapshots WHERE store = ? AND recorded_at >= ? ORDER BY recorded_at ASC"
  ).all(store, since);

  if (rows.length === 0) {
    return res.json(emptyAnalytics(store, period));
  }

  // ── Basic stats ─────────────────────────────
  const peopleCounts = rows.map(r => r.people);
  const avgOccupancy = peopleCounts.reduce((a, b) => a + b, 0) / peopleCounts.length;
  const maxOccupancy = Math.max(...peopleCounts);
  const minOccupancy = Math.min(...peopleCounts);

  // ── Hourly averages ──────────────────────────
  const hourlyBuckets = {};
  for (let h = 0; h < 24; h++) hourlyBuckets[h] = [];

  rows.forEach(r => {
    const hour = new Date(r.recorded_at).getHours();
    hourlyBuckets[hour].push(r.people);
  });

  const hourlyAvg = Array.from({ length: 24 }, (_, h) => {
    const bucket = hourlyBuckets[h];
    return {
      hour: h,
      avg:  bucket.length > 0
              ? Math.round((bucket.reduce((a, b) => a + b, 0) / bucket.length) * 10) / 10
              : null
    };
  });

  // ── Peak / slow hour ─────────────────────────
  const populated = hourlyAvg.filter(h => h.avg !== null);
  const peakEntry = populated.length ? populated.reduce((a, b) => a.avg > b.avg ? a : b) : null;
  const slowEntry = populated.length ? populated.reduce((a, b) => a.avg < b.avg ? a : b) : null;

  // ── Total visitors estimate ──────────────────
  // Count every upward jump in people count
  let totalVisitors = 0;
  let prev = null;
  rows.forEach(r => {
    if (prev !== null && r.people > prev) totalVisitors += (r.people - prev);
    prev = r.people;
  });

  // ── Status distribution ──────────────────────
  // Each row = ~1.5 seconds of data
  const SECS_PER_SAMPLE = 1.5;
  const dist = { not_busy_mins: 0, moderate_mins: 0, busy_mins: 0 };
  rows.forEach(r => {
    const key = statusToDistKey(r.status);
    dist[key] += SECS_PER_SAMPLE / 60;
  });
  dist.not_busy_mins = Math.round(dist.not_busy_mins);
  dist.moderate_mins  = Math.round(dist.moderate_mins);
  dist.busy_mins      = Math.round(dist.busy_mins);

  // ── Status change log ────────────────────────
  const statusLog = [];
  let statusChanges = 0;
  let prevStatus = null;
  rows.forEach(r => {
    const s = (r.status || "UNKNOWN").toUpperCase();
    if (prevStatus !== null && s !== prevStatus) {
      statusChanges++;
      statusLog.push({
        time:   r.recorded_at,
        from:   prevStatus,
        to:     s,
        people: r.people
      });
    }
    prevStatus = s;
  });

  res.json({
    store,
    period,
    peak_hour:            peakEntry ? formatHour(peakEntry.hour) : "--",
    slow_hour:            slowEntry ? formatHour(slowEntry.hour) : "--",
    total_visitors:       totalVisitors,
    avg_occupancy:        Math.round(avgOccupancy * 10) / 10,
    max_occupancy:        maxOccupancy,
    min_occupancy:        minOccupancy,
    status_changes:       statusChanges,
    status_distribution:  dist,
    hourly_avg:           hourlyAvg,
    status_log:           statusLog
  });
});

/* ════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════ */

function statusToDistKey(status) {
  const s = (status || "").toUpperCase();
  if (s === "NOT BUSY") return "not_busy_mins";
  if (s === "MODERATE") return "moderate_mins";
  if (s === "BUSY")     return "busy_mins";
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
   START SERVER
   ════════════════════════════════════════════════ */

app.listen(PORT, () => {
  console.log(`Queue Tracker Server running on port ${PORT}`);
});
