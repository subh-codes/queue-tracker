import cv2
import requests
from ultralytics import YOLO
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_URL = "https://qmswebapp-c4anadadd0agf7ej.westus-01.azurewebsites.net/update"

model = YOLO("yolov8n.pt")

cap = cv2.VideoCapture(0)

def get_status(count):
    if count <= 2:
        return "LOW"
    elif count <= 5:
        return "MEDIUM"
    else:
        return "HIGH"

print("Camera starting...")

frame_skip = 8   #  BIG CHANGE (less lag)
frame_count = 0

prev_count = 0
people_count = 0

while True:
    ret, frame = cap.read()

    if not ret:
        print("Camera failed")
        break

    frame_count += 1

    # smaller frame = faster detection
    frame = cv2.resize(frame, (416, 320))

    # ONLY detect every few frames
    if frame_count % frame_skip == 0:

        raw_count = 0

        results = model(frame, verbose=False)

        for r in results:
            for box in r.boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])

                # LOWERED threshold so it detects again
                if cls == 0 and conf > 0.3:
                    raw_count += 1

        # smoothing
        people_count = int((prev_count * 0.6) + (raw_count * 0.4))
        prev_count = people_count

        status = get_status(people_count)

        print(f"People: {people_count} | Status: {status}")

        try:
            response = requests.post(
                API_URL,
                json={
                    "store": "timhortons",
                    "people": people_count,
                    "status": status
                },
                verify=False
            )

            print("Sent:", response.status_code)

        except Exception as e:
            print("Error:", e)

    # show camera (ALWAYS runs = smooth video)
    cv2.imshow("Camera", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()