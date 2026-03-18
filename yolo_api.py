import time
import threading
from datetime import datetime
import cv2
from ultralytics import YOLO
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ===== Config =====
MODEL_PATH = "yolov8n.pt"
CAMERA_INDEX = 0
CONFIDENCE = 0.35
IMG_SIZE = 640
UPDATE_INTERVAL = 1.0   # seconds; good for live demo
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
USE_V4L2 = True

# ===== Shared state =====
state_lock = threading.Lock()
state = {
    "people": 0,
    "status": "STARTING",
    "updated": None,
    "camera": "INITIALIZING"
}

stop_event = threading.Event()


def crowd_status(n: int) -> str:
    if n <= 2:
        return "NOT BUSY"
    elif n <= 6:
        return "MODERATE"
    return "BUSY"


def update_state(people: int = None, status: str = None, camera: str = None):
    with state_lock:
        if people is not None:
            state["people"] = people
        if status is not None:
            state["status"] = status
        if camera is not None:
            state["camera"] = camera
        state["updated"] = datetime.now().isoformat(timespec="seconds")


def yolo_loop():
    try:
        model = YOLO(MODEL_PATH)
    except Exception as e:
        update_state(status=f"MODEL ERROR", camera=str(e))
        return

    backend = cv2.CAP_V4L2 if USE_V4L2 else 0
    cap = cv2.VideoCapture(CAMERA_INDEX, backend)

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

    if not cap.isOpened():
        update_state(people=0, status="CAMERA ERROR", camera="NOT OPENED")
        return

    # Small camera warm-up
    for _ in range(5):
        ok, _ = cap.read()
        if ok:
            break
        time.sleep(0.2)

    update_state(people=0, status="READY", camera="ONLINE")

    while not stop_event.is_set():
        loop_start = time.time()

        ok, frame = cap.read()
        if not ok or frame is None:
            update_state(people=0, status="CAMERA READ FAIL", camera="READ ERROR")
            time.sleep(1)
            continue

        try:
            result = model.predict(
                source=frame,
                imgsz=IMG_SIZE,
                conf=CONFIDENCE,
                classes=[0],       # person class only
                verbose=False
            )[0]

            people = len(result.boxes) if result.boxes is not None else 0
            status_text = crowd_status(people)

            update_state(
                people=people,
                status=status_text,
                camera="ONLINE"
            )

        except Exception as e:
            update_state(people=0, status="DETECTION ERROR", camera=str(e))

        # Keep a stable update interval
        elapsed = time.time() - loop_start
        sleep_time = max(0, UPDATE_INTERVAL - elapsed)
        time.sleep(sleep_time)

    cap.release()


@app.route("/status", methods=["GET"])
def status():
    with state_lock:
        return jsonify(dict(state))


@app.route("/")
def home():
    return jsonify({
        "message": "Queue Tracker API is running",
        "endpoint": "/status"
    })


if __name__ == "__main__":
    worker = threading.Thread(target=yolo_loop, daemon=True)
    worker.start()

    try:
        app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
    finally:
        stop_event.set()
