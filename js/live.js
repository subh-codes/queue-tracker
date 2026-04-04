function applyStatusColor(element, statusText) {
    if (!element) return;

    element.classList.remove("not-busy", "moderate", "busy", "unknown");

    const status = (statusText || "").toUpperCase().trim();

    if (status === "NOT BUSY" || status === "LOW") {
        element.classList.add("not-busy");
    } else if (status === "MODERATE" || status === "MEDIUM") {
        element.classList.add("moderate");
    } else if (status === "BUSY") {
        element.classList.add("busy");
    } else {
        element.classList.add("unknown");
    }
}

async function fetchQueueData(store) {
    try {
        const response = await fetch(`/queue?store=${store}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch data for ${store}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fetch error:", error);
        return null;
    }
}

function formatTimeParts(isoString) {
    if (!isoString) {
        return { hour: "--", mins: "--", secs: "--" };
    }
    const date = new Date(isoString);
    return {
        hour: String(date.getHours()).padStart(2, "0"),
        mins: String(date.getMinutes()).padStart(2, "0"),
        secs: String(date.getSeconds()).padStart(2, "0")
    };
}

async function refreshStoresPage() {
    const stores = ["timhortons", "starbucks", "edojapan"];

    const statusEls      = document.querySelectorAll(".status");
    const updatedHourEls = document.querySelectorAll(".updated-hour");
    const updatedMinEls  = document.querySelectorAll(".updated-mins");

    for (let i = 0; i < stores.length; i++) {
        const data = await fetchQueueData(stores[i]);
        if (!data) continue;

        if (statusEls[i]) {
            statusEls[i].textContent = data.status ?? "UNKNOWN";
            applyStatusColor(statusEls[i], data.status);
        }

        const time = formatTimeParts(data.updated);

        if (updatedHourEls[i]) updatedHourEls[i].textContent = time.hour;
        if (updatedMinEls[i])  updatedMinEls[i].textContent  = time.mins;
    }

    const now = new Date();

    const refreshHour = document.querySelector(".refresh-hour");
    const refreshMins = document.querySelector(".refresh-mins");
    const refreshSecs = document.querySelector(".refresh-seconds");

    if (refreshHour) refreshHour.textContent = String(now.getHours()).padStart(2, "0");
    if (refreshMins) refreshMins.textContent = String(now.getMinutes()).padStart(2, "0");
    if (refreshSecs) refreshSecs.textContent = String(now.getSeconds()).padStart(2, "0");
}

async function refreshSingleStorePage(store) {
    const data = await fetchQueueData(store);
    if (!data) return;

    const peopleEl      = document.querySelector(".number-of-people");
    const statusEl      = document.querySelector(".status");
    const estEl         = document.querySelector(".est");
    const hourEl        = document.querySelector(".hour");
    const minsEl        = document.querySelector(".mins");
    const secsEl        = document.querySelector(".secs");
    const busiestStartEl = document.querySelector(".esthr1");
    const busiestEndEl   = document.querySelector(".esthr2");
    const sensorEl       = document.getElementById("sensorStatus");

    if (peopleEl) peopleEl.textContent = data.people ?? "--";

    if (statusEl) {
        statusEl.textContent = data.status ?? "UNKNOWN";
        applyStatusColor(statusEl, data.status);
    }

    if (estEl) {
        estEl.textContent = data.people != null ? data.people * 2 : "--";
    }

    const time = formatTimeParts(data.updated);
    if (hourEl) hourEl.textContent = time.hour;
    if (minsEl) minsEl.textContent = time.mins;
    if (secsEl) secsEl.textContent = time.secs;

    if (busiestStartEl) busiestStartEl.textContent = data.busiest_hour_start ?? "--";
    if (busiestEndEl)   busiestEndEl.textContent   = data.busiest_hour_end   ?? "--";

    // ── Sensor status ──────────────────────────────────────────
    if (sensorEl) {
        const sensor = data.sensor ?? "UNKNOWN";
        if (sensor === "ONLINE") {
            sensorEl.textContent  = "Online";
            sensorEl.style.color  = "rgb(14, 183, 70)";
        } else if (sensor === "OFFLINE") {
            sensorEl.textContent  = "Offline";
            sensorEl.style.color  = "rgb(220, 53, 69)";
        } else {
            sensorEl.textContent  = "Unknown";
            sensorEl.style.color  = "rgb(108, 117, 125)";
        }
    }
}

function startLiveUpdates() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("stores.html")) {
        refreshStoresPage();
        setInterval(refreshStoresPage, 1500);
    } else if (path.includes("timhortons.html")) {
        refreshSingleStorePage("timhortons");
        setInterval(() => refreshSingleStorePage("timhortons"), 1500);
    } else if (path.includes("starbucks.html")) {
        refreshSingleStorePage("starbucks");
        setInterval(() => refreshSingleStorePage("starbucks"), 1500);
    } else if (path.includes("edojapan.html")) {
        refreshSingleStorePage("edojapan");
        setInterval(() => refreshSingleStorePage("edojapan"), 1500);
    }
}
