# 🟢 Queue Monitoring System

> Real-time AI-powered queue tracking for campus cafés — built with YOLOv8, Raspberry Pi, Node.js, and Microsoft Azure.

**Live Site:** [que-tracker-auhxcugrhwbgfedq.canadacentral-01.azurewebsites.net](https://que-tracker-auhxcugrhwbgfedq.canadacentral-01.azurewebsites.net/html/main.html)

---

## 📌 What It Does

The Queue Monitoring System uses a camera mounted above a café queue to automatically count people using computer vision. The live count is sent to a cloud server every 1.5 seconds and displayed on a public website accessible from any device.

Customers can check the queue status before walking over. Staff can view historical analytics through a secured admin dashboard.

---

## 🚀 Live Demo

| Page | URL |
|---|---|
| Main Page | `/html/main.html` |
| Stores | `/html/stores.html` |
| Tim Hortons Queue | `/html/timhortons.html` |
| Admin Login | `/html/admin_login.html` |
| Admin Dashboard | `/html/admin_standalone.html` |

---

## 🏗️ System Architecture

```
Raspberry Pi 4  (USB Camera + YOLOv8)
        │
        │  POST /update  (every 1.5s, HTTPS)
        ▼
Azure App Service  (Node.js + Express)
        │
        ├──► GET /queue          →  Public website (live status)
        ├──► GET /admin-analytics →  Admin dashboard (analytics)
        └──► Azure Blob Storage   →  timhortons_history.json (persistent)
                                          (saved every 30s, 7-day retention)
```

---

## ✨ Features

### Public Website
- Live people count updated every 1.5 seconds
- Colour-coded status: 🟢 NOT BUSY / 🟡 MODERATE / 🔴 BUSY
- Estimated wait time
- Fully responsive — works on mobile and desktop
- Three café locations (Tim Hortons live, Starbucks + Edo Japan ready)

### Admin Dashboard
- Secured login page
- Live status cards mirroring the public page
- Peak hour and slowest hour
- Total visitor estimate
- Average, max, and min occupancy
- Status distribution bar (time spent in each status)
- Hour-by-hour trend chart
- Status change log with timestamps
- Today and weekly view tabs

### Infrastructure
- Automatic deployment via GitHub Actions on every push to `main`
- Data persists across server restarts via Azure Blob Storage
- Raspberry Pi auto-starts tracker on boot via crontab

---

## 🧠 How the AI Works

People detection uses **YOLOv8n** (Ultralytics nano variant) running on the Raspberry Pi.

| Setting | Value |
|---|---|
| Model | YOLOv8n |
| Confidence threshold | 0.35 |
| Input image size | 640px |
| Detection class | Person only (class 0) |
| Inference interval | Every 1.5 seconds |

**Status thresholds:**
- `0–2 people` → **NOT BUSY**
- `3–6 people` → **MODERATE**
- `7+ people` → **BUSY**

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Edge device | Raspberry Pi 4 |
| Camera | USB Webcam 1280×720 |
| AI / Vision | YOLOv8n (Ultralytics) |
| Edge language | Python 3 |
| Backend runtime | Node.js 20 LTS |
| Backend framework | Express.js |
| Cloud platform | Microsoft Azure |
| App hosting | Azure App Service |
| Data storage | Azure Blob Storage |
| CI/CD | GitHub Actions |
| Frontend | HTML5 / CSS3 / Vanilla JS |
| Typography | Google Fonts — Orbitron |

---

## 📁 Project Structure

```
/
├── server.js               # Express backend — API + blob storage
├── package.json            # Dependencies
├── .github/
│   └── workflows/
│       └── main_workflow.yml  # GitHub Actions deployment
├── html/
│   ├── main.html           # Landing page
│   ├── stores.html         # Café selection
│   ├── timhortons.html     # Live queue tracker
│   ├── admin_login.html    # Admin login
│   └── admin_standalone.html  # Admin dashboard
├── css/
│   ├── main.css
│   ├── stores.css
│   └── trackinfo.css
└── js/
    └── live.js             # Shared live polling logic

Pi (not in repo):
├── timhortons_tracker.py   # YOLO detection + Azure push
└── yolov8n.pt              # AI model weights
```

---

## ⚙️ Setup and Deployment

### Azure Server

1. Clone the repository
2. Push to `main` branch — GitHub Actions deploys automatically
3. In Azure App Service → Environment Variables, add:
   ```
   AZURE_STORAGE_CONNECTION_STRING = <your blob storage connection string>
   ```
4. Azure workflow uses Node.js 20 LTS

### Raspberry Pi

1. Install dependencies:
   ```bash
   pip install ultralytics opencv-python requests
   ```

2. Edit `timhortons_tracker.py` and set:
   ```python
   AZURE_URL  = "https://your-app.azurewebsites.net/update"
   STORE_NAME = "timhortons"
   ```

3. Run manually:
   ```bash
   python timhortons_tracker.py
   ```

4. Auto-start on boot (add to crontab):
   ```bash
   @reboot sleep 10 && python /home/pi/timhortons_tracker.py >> /home/pi/tracker.log 2>&1 &
   ```

---

## 📊 Data Storage

Historical data is stored as a JSON array in **Azure Blob Storage**:

- **Container:** `queue-analytics`
- **File:** `timhortons_history.json`
- **Write interval:** Every 30 seconds
- **Retention:** 7 days (auto-pruned)
- **Recovery:** Loaded back into memory on server startup

Each record:
```json
{
  "store": "timhortons",
  "people": 7,
  "status": "BUSY",
  "recorded_at": "2026-04-04T11:19:39.499Z"
}
```

---

## 🔐 Admin Access

| Field | Value |
|---|---|
| Username | `adminque` |
| Password | `Subh7901@#` |

> Note: Admin authentication is client-side for capstone demonstration purposes.

---


## 📄 License

This project was developed as a capstone project for the ITSC program at SAIT. All rights reserved by the project team.
