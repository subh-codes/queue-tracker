import cv2
import requests
from ultralytics import YOLO
import time

# 🔴 CHANGE THIS to your Azure URL
API_URL = "qmswebapp-c4anadadd0agf7ej.westus-01.azurewebsites.net"

# Load YOLO model
model = YOLO("yolov8n.pt")

# Open laptop camera
cap = cv2.VideoCapture(0)

def get_status(count):
    if count <= 1:
        return "LOW"
    elif count <= 2:
        return "MEDIUM"
    else:
        return "HIGH"

print("Camera starting...")

frame_skip = 3
frame_count = 0

while True:
    ret, frame = cap.read()

    if not ret:
        print("Camera failed")
        break

    frame_count += 1

    # Resize for performance
    frame = cv2.resize(frame, (640, 480))

    people_count = 0

    # Only run detection every few frames
    if frame_count % frame_skip == 0:
        results = model(frame)

        for r in results:
            for box in r.boxes:
                cls = int(box.cls[0])
                if cls == 0:
                    people_count += 1

        status = get_status(people_count)

        print(f"People: {people_count} | Status: {status}")

        try:
            response = requests.post(API_URL, json={
                "count": people_count,
                "status": status
            })
            print("Sent:", response.status_code)
        except Exception as e:
            print("Error:", e)

    # Show camera smoothly
    cv2.imshow("Camera", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()