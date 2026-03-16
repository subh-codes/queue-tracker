/* ================================
QUEUE MONITORING SYSTEM SERVER
================================ */

/*
This server does 3 main things:

1. Serves the website (HTML, CSS, JS)
2. Receives people-count updates from Raspberry Pi or laptop
3. Provides queue data to the dashboard

The data is stored temporarily in memory.
No images or personal data are stored.
Only crowd counts.
*/

const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();

/* =================================
MIDDLEWARE
================================= */

/*
Allows the server to accept JSON requests
Example:
POST /update
{ "people": 3 }
*/
app.use(express.json());

/*
Allows requests from other devices
(laptop, raspberry pi, etc)
*/
app.use(cors());

/* =================================
PORT CONFIGURATION
================================= */

/*
Azure requires process.env.PORT

Locally it will run on port 3000
*/
const PORT = process.env.PORT || 3000;

/* =================================
DATA STORAGE (IN MEMORY)
================================= */

/*
Stores queue data for each food location.

Example stored data:

{
  people: 4,
  status: "MEDIUM",
  updated: "2026-03-18T02:00:00Z"
}
*/

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

/* =================================
SERVE WEBSITE FILES
================================= */

/*
These lines allow the server to host the website.
*/

app.use("/html", express.static(path.join(__dirname, "html")));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));

/* =================================
HOME PAGE
================================= */

/*
When someone visits:

https://yourwebsite.com/

This loads the main website page.
*/

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "main.html"));
});

/* =================================
GET QUEUE DATA
================================= */

/*
The website dashboard calls this endpoint.

Example request:

GET /queue?store=timhortons

Example response:

{
  "people": 3,
  "status": "LOW",
  "updated": "2026-03-18T02:10:00Z"
}
*/

app.get("/queue", (req, res) => {

  const store = (req.query.store || "timhortons").toLowerCase();

  if (!storeData[store]) {
    return res.status(404).json({ error: "Store not found" });
  }

  res.json(storeData[store]);

});

/* =================================
UPDATE QUEUE DATA
================================= */

/*
This endpoint is used by:

Laptop testing script
OR
Raspberry Pi detection script

Example request:

POST /update

{
  "store": "timhortons",
  "people": 4,
  "status": "MEDIUM"
}
*/

app.post("/update", (req, res) => {

  const {
    store,
    people,
    status,
    busiest_hour_start,
    busiest_hour_end
  } = req.body;

  const storeName = (store || "").toLowerCase();

  if (!storeData[storeName]) {
    return res.status(400).json({ error: "Invalid store" });
  }

  storeData[storeName] = {
    people: Number(people ?? 0),
    status: status || "UNKNOWN",
    updated: new Date().toISOString(),
    busiest_hour_start: busiest_hour_start ?? "--",
    busiest_hour_end: busiest_hour_end ?? "--"
  };

  console.log(`Update received for ${storeName}:`, storeData[storeName]);

  res.json({
    success: true,
    store: storeName
  });

});

/* =================================
TEST ENDPOINT
================================= */

/*
You can open this in a browser to confirm
the server is running.
*/

app.get("/test", (req, res) => {
  res.json({
    message: "Queue Monitoring System API running"
  });
});

/* =================================
START SERVER
================================= */

app.listen(PORT, () => {
  console.log(`Queue Monitoring System running on port ${PORT}`);
});