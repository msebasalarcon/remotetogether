
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

# RemoteTogether – Realistic Presence Compositing

## 🎯 Objective

RemoteTogether aims to create a **photo-realistic shared environment** where two remote individuals appear together naturally, as if physically in the same space. This requires addressing common issues like unrealistic layering, poor segmentation, depth inconsistency, and lack of physical interaction logic.

---

## 🔑 Features Overview

### 1. Dual Person ML Segmentation (Matting-Based)

Instead of basic segmentation (e.g., MediaPipe Selfie Segmentation), we use ML-based matting models that provide soft edges and higher fidelity:

- **MODNet (Mobile Dense Matting)**
- **Robust Video Matting (RVM)**
- **MediaPipe Selfie or Selfie-Segmentation as fallback**

#### Why:
- Better hair handling
- Edge feathering avoids "sticker look"
- Compatible with dynamic movement

#### How:
- Apply the matting model to both **Person A** and **Person B**
- Output includes:
  - Clean alpha masks
  - Optional background blur/removal
  - Tunable confidence thresholds

---

### 2. Depth-Aware Layering

To make the scene realistic, we need to know who appears **in front** and **behind** based on their distance to the camera.

#### Strategies:

**a. Head Size Comparison**
- Estimate bounding box around face/head
- Larger head = Closer to camera

**b. ML-Based Depth Estimation**
- Use depth estimation models like **MiDaS** or **MediaPipe Depth**
- Output: dense per-pixel depth maps
- Helps resolve occlusion and subtle overlap areas

#### Use Case:
- If Person B is closer → render Person B over Person A
- If Person A is closer → render Person A over Person B

---

### 3. Pose Detection & Interaction Awareness

Allow detection of **body language interactions** (e.g. hugs, handholding, leaning) for layered realism.

#### What the AI Does:
Use **pose estimation models**:
- MediaPipe Pose
- MoveNet
- OpenPose

These models return real-time landmark data (x, y, z, confidence) for key body points like:
- Head
- Shoulders
- Elbows
- Wrists
- Hips

**No pose bank is needed**. The models detect and deliver all poses in real time.

Example:
```json
{
  "landmarks": [
    { "name": "LEFT_SHOULDER", "x": 0.25, "y": 0.40, "z": 0.12 },
    { "name": "RIGHT_ELBOW", "x": 0.45, "y": 0.55, "z": 0.05 }
  ]
}
```

#### What You Do With It:
Write logic to interpret pose states and apply dynamic compositing.

##### Example: Hug from Behind
```js
function isHugFromBehind(poseA, poseB) {
  const aShoulders = midpoint(poseA.LEFT_SHOULDER, poseA.RIGHT_SHOULDER);
  const bWrists = [poseB.LEFT_WRIST, poseB.RIGHT_WRIST];

  const behindTorso = bWrists.every(wrist => wrist.z > aShoulders.z);
  const closeToShoulders = bWrists.every(wrist => distance(wrist, aShoulders) < 0.2);
  const headBehind = poseB.NOSE.z > poseA.NOSE.z;

  return behindTorso && closeToShoulders && headBehind;
}
```

If true:
- Render Person B’s **body behind** Person A
- Render Person B’s **arms in front**, simulating a hug

---

### 4. Layered Scene Compositing (Canvas/WebGL)

Once all masks, depths, and poses are analyzed:
- Combine Person A and B onto one canvas or rendering context
- Composite by:
  - Depth priority
  - Pose-based override (e.g. hands over body)
  - Segmentation masks

You can use:
- `<canvas>` 2D API (for basic)
- **WebGL/WebGPU** (for performance + 3D depth blending)

---

### 5. Lighting & Color Matching

To avoid mismatch between Person A and B:

#### Apply:
- **Auto White Balance Correction**
- **Color Histogram Matching**
- **Contrast & Brightness Equalization**
- **Skin Tone Normalization**
- Optional: Apply a shared **LUT (Look-Up Table)** filter

✅ This ensures both people look like they were lit in the same room.

---

### 6. Post-processing for Photo-Quality Output

After compositing:
- Clean segmentation artifacts (e.g. aliasing around hair, floating pixels)
- Feather edges
- Remove noise
- Enhance lighting gradients and shadows
- Normalize resolution and frame rates

---

## 🛠️ Tech Stack Recommendations

| Component                  | Suggested Tool / Library         |
|---------------------------|----------------------------------|
| Person Segmentation       | MODNet, RVM, or MediaPipe        |
| Depth Estimation          | MiDaS, MediaPipe Depth API       |
| Pose Detection            | MediaPipe Pose, MoveNet          |
| Layering & Compositing    | HTML Canvas, WebGL, WebGPU       |
| Color Matching            | OpenCV.js or custom LUT logic    |
| Post Processing           | TensorFlow.js, OpenCV.js         |

---

## ✅ Summary

RemoteTogether now becomes a **pose-aware, depth-aware, lighting-matched, ML-enhanced compositing engine** for truly immersive remote presence.

No more stickers. No more flat cutouts. This is **shared space realism**.

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
