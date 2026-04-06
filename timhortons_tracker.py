import time
from datetime import datetime
import cv2
from ultralytics import YOLO
import requests

# ════════════════════════════════════════════════
#  CONFIG
# ════════════════════════════════════════════════

AZURE_URL     = "https://que-tracker-auhxcugrhwbgfedq.canadacentral-01.azurewebsites.net/update"
STORE_NAME    = "timhortons"
CAMERA_INDEX  = 0
CONFIDENCE    = 0.35
IMG_SIZE      = 640
FRAME_WIDTH   = 1280
FRAME_HEIGHT  = 720
PUSH_INTERVAL = 1.5
MODEL_PATH    = "yolov8n.pt"

# ════════════════════════════════════════════════
#  STATUS LOGIC
# ════════════════════════════════════════════════

def get_status(people):
    if people < 3:
        return "NOT BUSY"
    elif people <= 6:
        return "MODERATE"
    else:
        return "BUSY"

# ════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════

def main():
    print("=" * 50)
    print("  Queue Tracker — Tim Hortons")
    print("  Loading YOLO model...")
    print("=" * 50)

    try:
        model = YOLO(MODEL_PATH)
        print("[OK] YOLO model loaded")
    except Exception as e:
        print(f"[ERROR] Could not load YOLO model: {e}")
        return

    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

    if not cap.isOpened():
        print("[ERROR] Could not open camera. Check CAMERA_INDEX.")
        return

    print("[OK] Camera opened")
    print("[..] Warming up camera...")

    for _ in range(5):
        ok, _ = cap.read()
        if ok:
            break
        time.sleep(0.2)

    print("[OK] Camera ready")
    print(f"[OK] Pushing to: {AZURE_URL}")
    print("-" * 50)
    print("Running. Press Ctrl+C to stop.\n")

    last_people = -1

    while True:
        loop_start = time.time()

        ok, frame = cap.read()
        if not ok or frame is None:
            print("[WARN] Camera read failed — retrying...")
            time.sleep(1)
            continue

        try:
            result = model.predict(
                source=frame,
                imgsz=IMG_SIZE,
                conf=CONFIDENCE,
                classes=[0],
                verbose=False
            )[0]

            people = len(result.boxes) if result.boxes is not None else 0
            status = get_status(people)

        except Exception as e:
            print(f"[ERROR] Detection failed: {e}")
            time.sleep(1)
            continue

        try:
            payload = {
                "store": STORE_NAME,
                "people": people,
                "busiest_hour_start": "--",
                "busiest_hour_end": "--"
            }
            response = requests.post(AZURE_URL, json=payload, timeout=3)

            if response.status_code == 200:
                if people != last_people:
                    ts = datetime.now().strftime("%H:%M:%S")
                    print(f"[{ts}] People: {people}  |  Status: {status}")
                    last_people = people
            else:
                print(f"[WARN] Azure returned {response.status_code}")

        except requests.exceptions.ConnectionError:
            print("[WARN] Could not reach Azure — check your URL and internet")
        except requests.exceptions.Timeout:
            print("[WARN] Azure request timed out")
        except Exception as e:
            print(f"[ERROR] Push failed: {e}")

        elapsed = time.time() - loop_start
        sleep_time = max(0, PUSH_INTERVAL - elapsed)
        time.sleep(sleep_time)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[STOPPED] Queue Tracker shut down.")
