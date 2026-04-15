"use strict";
const express = require("express");
const path    = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");
const { EmailClient }       = require("@azure/communication-email");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* ════════════════════════════════════════════════
   AZURE EMAIL CONFIG
   ════════════════════════════════════════════════ */
const EMAIL_CONN_STR  = process.env.ACS_CONNECTION_STRING || "endpoint=https://qms-comms.canada.communication.azure.com/;accesskey=18BqYQI2kTyPGT5Qnb6P1HQgUyAOGro25v8Zfi42vtV20edgLSEuJQQJ99CDACULyCp1a3EDAAAAAZCSY6SG";
const EMAIL_SENDER    = "DoNotReply@112f71fa-9119-45be-a933-aa04e6d1bb1e.azurecomm.net";
const EMAIL_RECIPIENT = "subhnetarsingh@icloud.com";
const ALERT_COOLDOWN  = 10 * 60 * 1000;   // 10 min between repeat alerts per store
const OFFLINE_THRESH  = 30 * 1000;         // sensor considered offline after 30s no update

let emailClient = null;
try {
  emailClient = new EmailClient(EMAIL_CONN_STR);
  console.log("[EMAIL] Azure Communication Services ready.");
} catch (e) {
  console.error("[EMAIL] Init failed:", e.message);
}

// Track last alert time per store so we don't spam
const lastAlertSent = {};

async function sendAlert(store, subject, htmlBody) {
  if (!emailClient) return;
  const now = Date.now();
  if (lastAlertSent[store] && (now - lastAlertSent[store]) < ALERT_COOLDOWN) return; // cooldown
  lastAlertSent[store] = now;
  try {
    await emailClient.beginSend({
      senderAddress: EMAIL_SENDER,
      recipients: { to: [{ address: EMAIL_RECIPIENT }] },
      content: {
        subject,
        plainText: subject,
        html: htmlBody
      }
    });
    console.log(`[EMAIL] Alert sent for ${store}: ${subject}`);
  } catch (e) {
    console.error(`[EMAIL] Send failed for ${store}:`, e.message);
  }
}

function buildEmailHtml(store, title, message, color) {
  const storeLabel = { timhortons: "Tim Hortons", starbucks: "Starbucks", edojapan: "Edo Japan" }[store] || store;
  const time = new Date().toLocaleString("en-CA", { timeZone: "America/Edmonton" });
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:30px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:${color};padding:24px 28px;">
      <h1 style="margin:0;color:#fff;font-size:1.2rem;letter-spacing:0.04em;">⚠ Queue Monitoring Alert</h1>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 8px;font-size:1rem;color:#111;">${title}</h2>
      <p style="margin:0 0 20px;color:#555;font-size:0.95rem;line-height:1.6;">${message}</p>
      <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
        <tr><td style="padding:8px 12px;background:#f8f8f8;border-radius:6px;color:#777;width:120px;">Store</td><td style="padding:8px 12px;font-weight:bold;color:#111;">${storeLabel}</td></tr>
        <tr><td style="padding:8px 12px;color:#777;">Time (MST)</td><td style="padding:8px 12px;color:#111;">${time}</td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:0.8rem;color:#aaa;">Queue Monitoring System — Automated Alert<br>subhnetarsinghicloud.onmicrosoft.com</p>
    </div>
  </div>
</body>
</html>`;
}

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
    console.warn("[BLOB] No connection string — analytics will not persist.");
    return;
  }
  try {
    const serviceClient   = BlobServiceClient.fromConnectionString(CONN_STR);
    const containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists();
    blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

    const ticketsContainer = serviceClient.getContainerClient("tickets");
    await ticketsContainer.createIfNotExists();
    ticketsBlobClient = ticketsContainer.getBlockBlobClient("tickets.json");

    console.log("[BLOB] Azure Blob Storage ready.");
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
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

let reportsBuffer = [];
let ticketCounter = 0;

async function saveTicket(ticket) {
  if (!ticketsBlobClient) return;
  try {
    let existing = [];
    const exists = await ticketsBlobClient.exists();
    if (exists) {
      const download = await ticketsBlobClient.download(0);
      const chunks = [];
      for await (const chunk of download.readableStreamBody) chunks.push(chunk);
      existing = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    existing.push(ticket);
    const text = JSON.stringify(existing, null, 2);
    await ticketsBlobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
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
   SENSOR OFFLINE MONITOR
   Checks every 60s — alerts if no update in 30s
   ════════════════════════════════════════════════ */
setInterval(async () => {
  const now = Date.now();
  for (const [store, data] of Object.entries(storeData)) {
    if (!data.updated) continue; // never received data yet, skip
    const age = now - new Date(data.updated).getTime();
    if (age > OFFLINE_THRESH) {
      const storeLabel = { timhortons: "Tim Hortons", starbucks: "Starbucks", edojapan: "Edo Japan" }[store] || store;
      const mins = Math.round(age / 60000);
      await sendAlert(
        store,
        `⚠ Sensor Offline — ${storeLabel}`,
        buildEmailHtml(
          store,
          `Sensor Offline — ${storeLabel}`,
          `The Raspberry Pi sensor for <strong>${storeLabel}</strong> has not sent any data for <strong>${mins} minute${mins !== 1 ? "s" : ""}</strong>. The camera or detection script may have stopped. Please check the Raspberry Pi.`,
          "#c8102e"
        )
      );
    }
  }
}, 60 * 1000);

/* ════════════════════════════════════════════════
   STATIC FILES
   ════════════════════════════════════════════════ */
app.use("/html", express.static(path.join(__dirname, "html")));
app.use("/css",  express.static(path.join(__dirname, "css")));
app.use("/js",   express.static(path.join(__dirname, "js")));

app.get("/", (_req, res) => res.redirect("/html/main.html"));

/* ════════════════════════════════════════════════
   SENSOR STATUS HELPER
   ════════════════════════════════════════════════ */
function getSensorStatus(updatedISO) {
  if (!updatedISO) return "OFFLINE";
  const diff = (Date.now() - new Date(updatedISO).getTime()) / 1000;
  return diff <= 10 ? "ONLINE" : "OFFLINE";
}

/* ════════════════════════════════════════════════
   GET QUEUE DATA
   ════════════════════════════════════════════════ */
app.get("/queue", (req, res) => {
  const store = (req.query.store || "timhortons").toLowerCase();
  if (!storeData[store]) return res.status(404).json({ error: "Store not found" });
  res.json({ ...storeData[store], sensor: getSensorStatus(storeData[store].updated) });
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
    people: peopleCount, status, updated: now,
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
   ════════════════════════════════════════════════ */
app.get("/admin-analytics", (req, res) => {
  const store  = (req.query.store  || "timhortons").toLowerCase();
  const period = (req.query.period || "today").toLowerCase();
  const now    = new Date();
  const sinceDate = period === "weekly"
    ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = historyBuffer.filter(r => r.store === store && new Date(r.recorded_at) >= sinceDate);
  if (!rows.length) return res.json(emptyAnalytics(store, period));

  const counts  = rows.map(r => r.people);
  const avgOcc  = counts.reduce((a, b) => a + b, 0) / counts.length;
  const maxOcc  = Math.max(...counts);
  const minOcc  = Math.min(...counts);
  const CALGARY = 6 * 60 * 60 * 1000;
  const buckets = {};
  for (let h = 0; h < 24; h++) buckets[h] = [];
  rows.forEach(r => {
    const h = new Date(new Date(r.recorded_at).getTime() - CALGARY).getUTCHours();
    buckets[h].push(r.people);
  });
  const hourlyAvg = Array.from({ length: 24 }, (_, h) => {
    const b = buckets[h];
    return { hour: h, avg: b.length ? Math.round(b.reduce((a,c)=>a+c,0)/b.length*10)/10 : null };
  });
  const filled = hourlyAvg.filter(h => h.avg !== null);
  const peakH  = filled.length ? filled.reduce((a,b)=>a.avg>b.avg?a:b) : null;
  const slowH  = filled.length ? filled.reduce((a,b)=>a.avg<b.avg?a:b) : null;

  let totalVisitors = 0, prev = null;
  rows.forEach(r => { if (prev!==null && r.people>prev) totalVisitors+=(r.people-prev); prev=r.people; });

  const SECS = 1.5;
  const dist = { not_busy_mins:0, moderate_mins:0, busy_mins:0 };
  rows.forEach(r => { dist[statusKey(r.status)] += SECS/60; });
  dist.not_busy_mins = Math.round(dist.not_busy_mins);
  dist.moderate_mins  = Math.round(dist.moderate_mins);
  dist.busy_mins      = Math.round(dist.busy_mins);

  let changes=0, prevStatus=null;
  const statusLog=[];
  rows.forEach(r => {
    const s=(r.status||"UNKNOWN").toUpperCase();
    if (prevStatus!==null&&s!==prevStatus) { changes++; statusLog.push({time:r.recorded_at,from:prevStatus,to:s,people:r.people}); }
    prevStatus=s;
  });

  res.json({
    store, period,
    peak_hour:           peakH ? formatHour(peakH.hour) : "--",
    slow_hour:           slowH ? formatHour(slowH.hour) : "--",
    total_visitors:      totalVisitors,
    avg_occupancy:       Math.round(avgOcc*10)/10,
    max_occupancy:       maxOcc, min_occupancy: minOcc,
    status_changes:      changes,
    status_distribution: dist,
    hourly_avg:          hourlyAvg,
    status_log:          statusLog,
    customer_reports:    reportsBuffer.filter(r=>r.store===store)
  });
});

/* ════════════════════════════════════════════════
   CUSTOMER REPORT
   ════════════════════════════════════════════════ */
app.post("/report", (req, res) => {
  const { store, reported_status, comment } = req.body;
  const storeName = (store || "timhortons").toLowerCase();
  const validStatuses = ["NOT BUSY","MODERATE","BUSY","ISSUE"];
  if (!validStatuses.includes((reported_status||"").toUpperCase()))
    return res.status(400).json({ error: "Invalid status" });

  const rawStatus = (reported_status||"").toUpperCase();
  const priority  = rawStatus==="BUSY"?"high":rawStatus==="MODERATE"?"medium":"low";
  const ticketType = (req.body.type || "queue_status");
  const ticket = {
    id:              String(++ticketCounter).padStart(7,"0"),
    store:           storeName,
    reported_status: rawStatus,
    comment:         (comment||"").slice(0,200).trim(),
    submitted_at:    new Date().toISOString(),
    ticket_status:   "open",
    priority:        rawStatus==="ISSUE"?"high":priority,
    admin_note:      "", assignee: "", updated_at: null, type: ticketType
  };
  reportsBuffer.push(ticket);
  saveTicket(ticket).catch(e => console.error("[TICKETS] Async save error:", e.message));

  // Send email alert for BUSY or ISSUE reports
  if (rawStatus === "BUSY" || rawStatus === "ISSUE") {
    const storeLabel = { timhortons:"Tim Hortons", starbucks:"Starbucks", edojapan:"Edo Japan" }[storeName] || storeName;
    sendAlert(
      `report_${storeName}`,
      `🎫 Customer Report — ${storeLabel} (${rawStatus})`,
      buildEmailHtml(
        storeName,
        `Customer Report — ${storeLabel}`,
        `A customer submitted a <strong>${rawStatus}</strong> report for <strong>${storeLabel}</strong>.<br><br><em>"${ticket.comment || "No comment provided"}"</em><br><br>Ticket ID: #${ticket.id}`,
        rawStatus === "ISSUE" ? "#e85d04" : "#c8102e"
      )
    );
  }

  console.log(`[REPORT] ${storeName}: ${ticket.reported_status}`);
  res.json({ success: true, ticket_id: ticket.id });
});

/* ════════════════════════════════════════════════
   TICKETS ENDPOINTS
   ════════════════════════════════════════════════ */
app.get("/tickets", async (req, res) => {
  try {
    if (!ticketsBlobClient) return res.json([]);
    const exists = await ticketsBlobClient.exists();
    if (!exists) return res.json([]);
    const download = await ticketsBlobClient.download(0);
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    res.json(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (e) { console.error("[TICKETS] Fetch failed:", e.message); res.json([]); }
});

app.post("/clear-tickets", async (req, res) => {
  try {
    reportsBuffer = []; ticketCounter = 0;
    if (ticketsBlobClient) {
      const text = JSON.stringify([]);
      await ticketsBlobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Clear failed" }); }
});

app.patch("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const { ticket_status, note, assignee, priority } = req.body;
  const validStatuses   = ["open","in_progress","resolved"];
  const validPriorities = ["high","medium","low"];
  const validAssignees  = ["Subh","Nerrisa","Navjot","Omier","Sandli",""];
  if (ticket_status && !validStatuses.includes(ticket_status))
    return res.status(400).json({ error: "Invalid ticket_status" });
  if (priority && !validPriorities.includes(priority))
    return res.status(400).json({ error: "Invalid priority" });
  if (assignee !== undefined && !validAssignees.includes(assignee))
    return res.status(400).json({ error: "Invalid assignee" });
  try {
    if (!ticketsBlobClient) return res.status(503).json({ error: "Storage not available" });
    const exists = await ticketsBlobClient.exists();
    if (!exists) return res.status(404).json({ error: "No tickets found" });
    const download = await ticketsBlobClient.download(0);
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    const tickets = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const idx = tickets.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "Ticket not found" });
    if (ticket_status !== undefined) tickets[idx].ticket_status = ticket_status;
    if (note          !== undefined) tickets[idx].admin_note    = note;
    if (assignee      !== undefined) tickets[idx].assignee      = assignee;
    if (priority      !== undefined) tickets[idx].priority      = priority;
    tickets[idx].updated_at = new Date().toISOString();
    const ri = reportsBuffer.findIndex(t => String(t.id) === String(id));
    if (ri !== -1) {
      if (ticket_status !== undefined) reportsBuffer[ri].ticket_status = ticket_status;
      if (note          !== undefined) reportsBuffer[ri].admin_note    = note;
      if (assignee      !== undefined) reportsBuffer[ri].assignee      = assignee;
      if (priority      !== undefined) reportsBuffer[ri].priority      = priority;
      reportsBuffer[ri].updated_at = tickets[idx].updated_at;
    }
    const text = JSON.stringify(tickets, null, 2);
    await ticketsBlobClient.upload(text, Buffer.byteLength(text), { overwrite: true });
    res.json({ success: true, ticket: tickets[idx] });
  } catch (e) { console.error("[TICKETS] Update failed:", e.message); res.status(500).json({ error: "Update failed" }); }
});

/* ════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════ */
function statusKey(s) {
  const u=(s||"").toUpperCase();
  if(u==="NOT BUSY")return"not_busy_mins";
  if(u==="MODERATE")return"moderate_mins";
  if(u==="BUSY")return"busy_mins";
  return"not_busy_mins";
}
function formatHour(h) {
  if(h===0)return"12:00 AM";if(h<12)return`${h}:00 AM`;if(h===12)return"12:00 PM";return`${h-12}:00 PM`;
}
function emptyAnalytics(store,period) {
  return { store, period, peak_hour:"--", slow_hour:"--", total_visitors:0, avg_occupancy:null,
    max_occupancy:null, min_occupancy:null, status_changes:0,
    status_distribution:{not_busy_mins:0,moderate_mins:0,busy_mins:0},
    hourly_avg:Array.from({length:24},(_,h)=>({hour:h,avg:null})), status_log:[] };
}

/* ════════════════════════════════════════════════
   START
   ════════════════════════════════════════════════ */
initBlob().then(async () => {
  historyBuffer = await loadHistory();
  console.log(`[BLOB] Loaded ${historyBuffer.length} existing records.`);
  try {
    if (ticketsBlobClient) {
      const exists = await ticketsBlobClient.exists();
      if (exists) {
        const download = await ticketsBlobClient.download(0);
        const chunks = [];
        for await (const chunk of download.readableStreamBody) chunks.push(chunk);
        reportsBuffer = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        ticketCounter = reportsBuffer.length;
        console.log(`[TICKETS] Loaded ${reportsBuffer.length} tickets.`);
      }
    }
  } catch (e) { console.error("[TICKETS] Load failed:", e.message); }

  app.listen(PORT, () => {
    console.log(`Queue Tracker running on port ${PORT}`);
    console.log(`[EMAIL] Alerts → ${EMAIL_RECIPIENT}`);
  });
});
