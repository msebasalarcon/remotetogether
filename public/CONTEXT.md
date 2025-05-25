
# 📸 Remote Room Photo App — Developer Overview

This app allows two users in different locations to appear together in a single, realistic shared environment. Person A appears with their full background, and Person B has their background removed and is realistically composited over Person A's scene using depth-aware processing.

---

## 📂 Folder Structure

```plaintext
src/
├── Pages/
│   ├── Home.jsx         # Entry screen where users choose a role
│   ├── RoomA.jsx        # View for Person A (room creator, full video + compositing)
│   └── RoomB.jsx        # View for Person B (joins, background removed, sends stream)
```

---

## 🧭 App Flow

### 1. Home Page (`Home.jsx`)
- User selects whether they are **Person A (Host)** or **Person B (Guest)**.
- Redirected to the corresponding room: `/room-a` or `/room-b`.

---

### 2. Room A (`RoomA.jsx`)
#### Role: Host (Compositor)

##### 💡 Responsibilities:
- Captures their own webcam feed with **full background**.
- Receives Person B’s **background-removed video stream** via **PeerJS**.
- Runs **depth estimation** on their own video (Person A).
- Composites Person A and Person B’s frames using a **depth-aware canvas compositor**.
- Sends the **final composited stream back to Person B** (for recording or preview).

##### 🧱 Key Components:
- Webcam access (via `getUserMedia`)
- PeerJS server: Establish WebRTC connection and receive B’s stream
- TensorFlow.js or MediaPipe: Real-time depth map generation for Person A
- Canvas API or WebGL:
  - Draw Person A frame
  - Overlay Person B frame with pixel-wise depth check
- Stream canvas output back to Person B

---

### 3. Room B (`RoomB.jsx`)
#### Role: Guest (Segmented Participant)

##### 💡 Responsibilities:
- Captures their webcam stream.
- Runs **background removal** (MediaPipe Selfie Segmentation or BodyPix).
- Sends the **segmented video stream** (foreground only) to Person A.
- Receives the **composited stream** from Person A and displays it in real time.

##### 🧱 Key Components:
- Webcam access
- Real-time background removal (MediaPipe or BodyPix)
- PeerJS: Send processed stream to A, receive composite stream
- Display received final composite in a video element

---

## 🔁 Data & Media Flow

```plaintext
Person B
┌────────────┐
│ Camera     │
│ +          │
│ Background │
│ Removal    │
└─────┬──────┘
      │ (stream via PeerJS)
      ▼
Person A
┌────────────┐       ┌──────────────┐
│ Camera     │       │ Received B   │
│ + Depth    │◄──────┤ Segmented Vid│
└─────┬──────┘       └─────┬────────┘
      │                    │
      ▼                    ▼
      ┌───────────────────────────────┐
      │       Canvas Compositing      │◄───── Depth Z-Ordering
      └──────────┬────────────────────┘
                 ▼
        Final Composite Stream
                 │
                 ▼
      Sent to Person B (via PeerJS)
```

---

## 🎯 Features Overview

| Feature | Description |
|--------|-------------|
| Role Selection | Choose between Person A (host) and Person B (guest) |
| Real-Time Video | Live webcam streams |
| Background Removal | Person B’s background is removed locally |
| Depth Estimation | Person A's video processed for depth maps |
| Depth-Aware Compositing | Foreground of B composited into A's scene using depth ordering |
| PeerJS Communication | WebRTC used for low-latency media stream sharing |
| Canvas Compositor | Real-time layered rendering for final photo/video |
| PiP (Optional) | Show Person B’s original video in small overlay (debugging or reference) |

---

## 🛠 Technologies Used

| Area | Tool |
|------|------|
| Video Streams | WebRTC, PeerJS |
| Webcam Access | `navigator.mediaDevices.getUserMedia()` |
| Background Removal | MediaPipe Selfie Segmentation OR TensorFlow.js BodyPix |
| Depth Estimation | MiDaS (via TensorFlow.js) or MediaPipe Depth |
| Compositing | Canvas 2D / WebGL |
| UI | React, Tailwind CSS |
| Dev Tooling | Vite (frontend bundler) |

---

## 🔮 Future Enhancements

- Smoothing & interpolation for depth maps (to avoid jitter)
- Lighting estimation to match Person B’s light with A’s scene
- Dynamic background swaps or shared 3D environment
- One-click photo capture and auto-download
- Serverless or Firebase-based PeerJS signaling

---

## 🚧 MVP Goals

1. Person A receives and composites Person B’s segmented video.
2. Person A sends the final canvas stream back to Person B.
3. Both users see a realistic-looking shared video environment.

---

## ✨ Key Design Principles

- **Separation of Concerns**: A and B have distinct roles, files, and logic.
- **Realism Over Simplicity**: Prioritize depth-aware occlusion and seamless composition.
- **Web-Based Only**: All processing happens client-side using JavaScript, WebRTC, and WebGL.

---

## 📌 Notes for Developers

- Be cautious of frame drops if running multiple ML models per frame.
- Use `requestAnimationFrame()` wisely for canvas updates.
- Start small: get Person B to appear over Person A’s video first, then add depth logic.
- Use `ImageData` to directly compare depth maps per-pixel if not using WebGL.
