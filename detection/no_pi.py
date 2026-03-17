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

while True:
    ret, frame = cap.read()

    if not ret:
        print("Camera failed")
        break

    # Sizing
    frame = cv2.resize(frame, (640, 480))

    people_count = 0

    results = model(frame)

    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])

            # ONLY check for person (no confidence filter for now)
            if cls == 0:
                people_count += 1

    status = get_status(people_count)

    print(f"People: {people_count} | Status: {status}")

    # send to Azure
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

    # show camera
    cv2.imshow("Camera", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()