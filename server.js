const express = require("express");
const path    = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ════════════════════════════════════════════════
   AZURE BLOB STORAGE
   ════════════════════════════════════════════════ */

const CONN_STR       = process.env.AZURE_STORAGE_CONNECTION_STRING || null;
const CONTAINER_NAME = "queue-analytics";
const BLOB_NAME      = "timhortons_history.json";

let blobClient        = null;
let ticketsBlobClient = null;

async function initBlob() {
  if (!CONN_STR) {
    console.warn("[BLOB] No connection string set — analytics will not persist across restarts.");
    return;
  }
  try {
    const serviceClient   = BlobServiceClient.fromConnectionString(CONN_STR);
    const containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists();
    blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

    // Tickets container
    const ticketsContainer = serviceClient.getContainerClient("tickets");
    await ticketsContainer.createIfNotExists();
    ticketsBlobClient = ticketsContainer.getBlockBlobClient("tickets.json");

    console.log("[BLOB] Azure Blob Storage ready (analytics + tickets).");
  } catch (e) {
    console.error("[BLOB] Init failed:", e.message);
  }
}

async function loadHistory() {
  if (!blobClient) return [];
  try {
    const exists = await blobClient.exists();
    if (!exists) return [];
    const download = await blobClient.download(0);
    const chunks   = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text);
  } catch (e) {
    console.error("[BLOB] Load failed:", e.message);
    return [];
  }
}

async function saveHistory(history) {
  if (!blobClient) return;
  try {
    const text = JSON.stringify(history);
    await blobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
  } catch (e) {
    console.error("[BLOB] Save failed:", e.message);
  }
}

let historyBuffer = [];
let dirtyFlag     = false;

// Customer reports
let reportsBuffer  = [];
let ticketCounter  = 0;  // increments from loaded tickets on startup

function pruneReports() {
  // Reports kept forever — no expiry
}

// Save a new ticket to Azure Blob tickets container
async function saveTicket(ticket) {
  if (!ticketsBlobClient) return;
  try {
    // Load existing tickets
    let existing = [];
    const exists = await ticketsBlobClient.exists();
    if (exists) {
      const download = await ticketsBlobClient.download(0);
      const chunks = [];
      for await (const chunk of download.readableStreamBody) {
        chunks.push(chunk);
      }
      existing = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    // Append new ticket
    existing.push(ticket);
    const text = JSON.stringify(existing, null, 2);
    await ticketsBlobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
    console.log(`[TICKETS] Saved ticket #${existing.length} to blob.`);
  } catch (e) {
    console.error("[TICKETS] Save failed:", e.message);
  }
}

setInterval(async () => {
  if (dirtyFlag && historyBuffer.length > 0) {
    await saveHistory(historyBuffer);
    dirtyFlag = false;
  }
}, 30000);

function pruneOldData(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  return history.filter(r => new Date(r.recorded_at) > cutoff);
}

/* ════════════════════════════════════════════════
   STORE DATA
   ════════════════════════════════════════════════ */

const storeData = {
  timhortons: { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" },
  starbucks:  { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" },
  edojapan:   { people: 0, status: "UNKNOWN", updated: null, busiest_hour_start: "--", busiest_hour_end: "--" }
};

/* ════════════════════════════════════════════════
   STATIC FILES
   ════════════════════════════════════════════════ */

app.use("/html", express.static(path.join(__dirname, "html")));
app.use("/css",  express.static(path.join(__dirname, "css")));
app.use("/js",   express.static(path.join(__dirname, "js")));

/* ════════════════════════════════════════════════
   ROOT
   ════════════════════════════════════════════════ */

app.get("/", (req, res) => {
  res.redirect("/html/main.html");
});

/* ════════════════════════════════════════════════
   SENSOR STATUS HELPER
   ════════════════════════════════════════════════ */

function getSensorStatus(updatedISO) {
  if (!updatedISO) return "OFFLINE";
  const diffSeconds = (Date.now() - new Date(updatedISO).getTime()) / 1000;
  return diffSeconds <= 10 ? "ONLINE" : "OFFLINE";
}

/* ════════════════════════════════════════════════
   GET QUEUE DATA
   ════════════════════════════════════════════════ */

app.get("/queue", (req, res) => {
  const store = (req.query.store || "timhortons").toLowerCase();
  if (!storeData[store]) return res.status(404).json({ error: "Store not found" });
  res.json({
    ...storeData[store],
    sensor: getSensorStatus(storeData[store].updated)
  });
});

/* ════════════════════════════════════════════════
   UPDATE FROM PI
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

  if (storeName === "timhortons") {
    historyBuffer.push({ store: storeName, people: peopleCount, status, recorded_at: now });
    historyBuffer = pruneOldData(historyBuffer);
    dirtyFlag = true;
  }

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
    sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    // Last 24 hours rolling — stays available even when Pi is offline
    sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const rows = historyBuffer.filter(
    r => r.store === store && new Date(r.recorded_at) >= sinceDate
  );

  if (!rows.length) return res.json(emptyAnalytics(store, period));

  // Basic stats
  const counts = rows.map(r => r.people);
  const avgOcc = counts.reduce((a, b) => a + b, 0) / counts.length;
  const maxOcc = Math.max(...counts);
  const minOcc = Math.min(...counts);

  // Hourly averages — converted to Calgary time (UTC-6 = MDT)
  const CALGARY_OFFSET_MS = 6 * 60 * 60 * 1000;
  const buckets = {};
  for (let h = 0; h < 24; h++) buckets[h] = [];
  rows.forEach(r => {
    const h = new Date(new Date(r.recorded_at).getTime() - CALGARY_OFFSET_MS).getUTCHours();
    buckets[h].push(r.people);
  });
  const hourlyAvg = Array.from({ length: 24 }, (_, h) => {
    const b = buckets[h];
    return { hour: h, avg: b.length ? Math.round(b.reduce((a, c) => a + c, 0) / b.length * 10) / 10 : null };
  });

  // Peak / slow hour
  const filled = hourlyAvg.filter(h => h.avg !== null);
  const peakH  = filled.length ? filled.reduce((a, b) => a.avg > b.avg ? a : b) : null;
  const slowH  = filled.length ? filled.reduce((a, b) => a.avg < b.avg ? a : b) : null;

  // Total visitors
  let totalVisitors = 0, prev = null;
  rows.forEach(r => {
    if (prev !== null && r.people > prev) totalVisitors += (r.people - prev);
    prev = r.people;
  });

  // Status distribution (each row ≈ 1.5s)
  const SECS = 1.5;
  const dist  = { not_busy_mins: 0, moderate_mins: 0, busy_mins: 0 };
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
      statusLog.push({ time: r.recorded_at, from: prevStatus, to: s, people: r.people });
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
    status_log:          statusLog,
    customer_reports:    reportsBuffer.filter(r => r.store === store)
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
   CUSTOMER REPORT ENDPOINT
   POST /report
   ════════════════════════════════════════════════ */

app.post("/report", (req, res) => {
  const { store, reported_status, comment } = req.body;
  const storeName = (store || "timhortons").toLowerCase();

  const validStatuses = ["NOT BUSY", "MODERATE", "BUSY"];
  if (!validStatuses.includes((reported_status || "").toUpperCase())) {
    return res.status(400).json({ error: "Invalid status" });
  }

  pruneReports();

  const ticket = {
    id:              String(++ticketCounter).padStart(7, "0"),
    store:           storeName,
    reported_status: (reported_status || "").toUpperCase(),
    comment:         (comment || "").slice(0, 200).trim(),
    submitted_at:    new Date().toISOString()
  };

  reportsBuffer.push(ticket);

  // Save to Azure Blob tickets container (non-blocking)
  saveTicket(ticket).catch(e => console.error("[TICKETS] Async save error:", e.message));

  console.log(`[REPORT] ${storeName}: ${ticket.reported_status} — "${ticket.comment}"`);
  res.json({ success: true, ticket_id: ticket.id });
});



/* ════════════════════════════════════════════════
   GET ALL TICKETS FROM BLOB
   GET /tickets
   ════════════════════════════════════════════════ */

app.get("/tickets", async (req, res) => {
  try {
    if (!ticketsBlobClient) return res.json([]);
    const exists = await ticketsBlobClient.exists();
    if (!exists) return res.json([]);
    const download = await ticketsBlobClient.download(0);
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    const tickets = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.json(tickets);
  } catch (e) {
    console.error("[TICKETS] Fetch failed:", e.message);
    res.json([]);
  }
});

/* ════════════════════════════════════════════════
   CLEAR ALL TICKETS
   POST /clear-tickets
   ════════════════════════════════════════════════ */

app.post("/clear-tickets", async (req, res) => {
  try {
    reportsBuffer = [];
    ticketCounter = 0;
    if (ticketsBlobClient) {
      const text = JSON.stringify([]);
      await ticketsBlobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
    }
    console.log("[TICKETS] All tickets cleared.");
    res.json({ success: true });
  } catch (e) {
    console.error("[TICKETS] Clear failed:", e.message);
    res.status(500).json({ error: "Clear failed" });
  }
});

/* ════════════════════════════════════════════════
   START
   ════════════════════════════════════════════════ */

initBlob().then(async () => {
  historyBuffer = await loadHistory();
  console.log(`[BLOB] Loaded ${historyBuffer.length} existing records.`);

  // Load existing tickets from blob into memory
  try {
    if (ticketsBlobClient) {
      const exists = await ticketsBlobClient.exists();
      if (exists) {
        const download = await ticketsBlobClient.download(0);
        const chunks = [];
        for await (const chunk of download.readableStreamBody) {
          chunks.push(chunk);
        }
        reportsBuffer = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        ticketCounter  = reportsBuffer.length;
        console.log(`[TICKETS] Loaded ${reportsBuffer.length} existing tickets. Counter at ${ticketCounter}.`);
      }
    }
  } catch (e) {
    console.error("[TICKETS] Load failed:", e.message);
  }

  app.listen(PORT, () => {
    console.log(`Queue Tracker Server running on port ${PORT}`);
  });
});
