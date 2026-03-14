const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* STORE DATA MEMORY */

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

/* STATIC FILES */

app.use("/html", express.static(path.join(__dirname, "html")));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));

/* ROOT PAGE */

app.get("/", (req, res) => {
  res.redirect("/html/main.html");
});

/* GET QUEUE DATA */

app.get("/queue", (req, res) => {

  const store = (req.query.store || "timhortons").toLowerCase();

  if (!storeData[store]) {
    return res.status(404).json({ error: "Store not found" });
  }

  res.json(storeData[store]);

});

/* UPDATE DATA FROM RASPBERRY PI OR SENSOR */

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

/* START SERVER */

app.listen(PORT, () => {
  console.log(`Queue Tracker Server running on port ${PORT}`);
});