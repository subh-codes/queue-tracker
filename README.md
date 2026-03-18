# Occupancy Intelligence System (Capstone Project)

## Overview
The Occupancy Intelligence System is an IT-focused capstone project designed to monitor real-time crowd levels using computer vision and IoT integration.

The system uses a Raspberry Pi with a camera to detect and count people, processes the data using Python (OpenCV + YOLO), and sends the results to a cloud-hosted web dashboard on Microsoft Azure.

This solution helps businesses such as cafes, retail stores, and campus facilities reduce wait times, improve customer experience, and optimize operations.

---

## Objectives
- Implement real-time crowd detection using AI (YOLO / OpenCV)
- Integrate Raspberry Pi hardware with cloud services
- Build a live dashboard for occupancy tracking
- Deploy using Azure Web Apps
- Demonstrate a complete IT infrastructure solution

---

## System Architecture

Camera → Raspberry Pi → Detection Script (Python)
       → Backend API → Azure Cloud
       → Web Dashboard

---

## Technologies Used

Hardware:
- Raspberry Pi 5
- USB Webcam / Pi Camera

Software:
- Python
- OpenCV
- YOLO

Web & Backend:
- HTML, CSS, JavaScript
- Node.js / Express
- REST API

Cloud & DevOps:
- Microsoft Azure Web App
- GitHub
- GitHub Actions (CI/CD)

---

## Features
- Real-time people detection
- Live occupancy updates
- Cloud-hosted dashboard
- API-based communication
- Mobile-friendly interface

---

## Project Structure

capstone-project/
│
├── pi/
│   ├── detection.py
│   └── camera_setup.py
│
├── backend/
│   ├── server.js
│   └── routes/
│
├── frontend/
│   ├── html/
│   ├── css/
│   └── js/
│       └── live.js
│
├── .github/workflows/
│   └── azure-deploy.yml
│
└── README.md

---

## Setup Instructions

1. Clone Repository
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name

2. Raspberry Pi Setup
sudo apt update
sudo apt install python3-opencv
pip install ultralytics

Run:
python3 detection.py

3. Backend Setup
cd backend
npm install
node server.js

4. Frontend
Open html/main.html in browser
OR deploy via Azure Web App

---

## API Example

GET /api/occupancy

Response:
{
  "count": 12,
  "status": "Moderate"
}

---

## Use Cases
- Cafes (e.g., Tim Hortons)
- Retail stores
- Campus facilities
- Event spaces

---

## Challenges
- Raspberry Pi performance optimization
- Real-time synchronization
- Camera calibration issues
- Cloud integration debugging

---

## Future Improvements
- Multi-camera support
- Historical analytics
- Mobile app integration
- Notifications and alerts

---

  

---

## License
This project is developed for academic purposes.
