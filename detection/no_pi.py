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
    if count <= 3:
        return "LOW"
    elif count <= 6:
        return "MEDIUM"
    else:
        return "HIGH"

print("Camera starting...")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Camera failed")
        break

    # Run detection
    results = model(frame)

    people_count = 0

    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])
            if cls == 0:  # 0 = person
                people_count += 1

    status = get_status(people_count)

    print(f"People: {people_count} | Status: {status}")

    # Send to Azure
    try:
        response = requests.post(API_URL, json={
            "count": people_count,
            "status": status
        })
        print("Sent to Azure:", response.status_code)
    except Exception as e:
        print("Error sending to Azure:", e)

    # Show camera (optional but helpful)
    cv2.imshow("Camera", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

    time.sleep(5)

cap.release()
cv2.destroyAllWindows()