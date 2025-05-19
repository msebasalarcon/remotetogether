import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
    const { roomId } = useParams();
    const canvasRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pipCanvasRef = useRef(null); // Small Picture-in-Picture canvas
    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);
    const [hasUserInteracted, setHasUserInteracted] = useState(false);

    // Store segmented frame for Person B
    const bFrame = useRef({ image: null, mask: null });

    // Handle iOS requirement for user interaction before media playback
    useEffect(() => {
        const handleUserInteraction = () => {
            setHasUserInteracted(true);
            document.removeEventListener('click', handleUserInteraction);
            document.removeEventListener('touchstart', handleUserInteraction);
        };

        document.addEventListener('click', handleUserInteraction);
        document.addEventListener('touchstart', handleUserInteraction);

        return () => {
            document.removeEventListener('click', handleUserInteraction);
            document.removeEventListener('touchstart', handleUserInteraction);
        };
    }, []);

    useEffect(() => {
        if (!hasUserInteracted) return; // Wait for user interaction (iOS requirement)

        const drawMainCanvas = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d", { alpha: false });
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Always draw Person A's video as background (local for Person A, remote for Person B)
            if (isRoomCreator) {
                // Person A: Draw own local video as background
                if (localVideoRef.current && localVideoRef.current.readyState >= 2) {
                    try {
                        ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
                    } catch (e) {
                        console.error("Error drawing local video:", e);
                    }
                }
            } else {
                // Person B: Draw remote video (Person A) as background
                if (remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                    try {
                        ctx.drawImage(remoteVideoRef.current, 0, 0, canvas.width, canvas.height);
                    } catch (e) {
                        console.error("Error drawing remote video as background:", e);
                    }
                }
            }

            // Draw Person B with background removed on top
            // For Person A: This is the remote video
            // For Person B: This is the local video with background removed
            if (bFrame.current.image && bFrame.current.mask) {
                try {
                    ctx.save();
                    ctx.drawImage(bFrame.current.mask, 0, 0, canvas.width, canvas.height);
                    ctx.globalCompositeOperation = "source-in";
                    ctx.drawImage(bFrame.current.image, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                } catch (e) {
                    console.error("Error drawing segmented image:", e);
                }
            }
        };

        const drawPipCanvas = () => {
            const pipCanvas = pipCanvasRef.current;
            if (!pipCanvas || !bFrame.current.image || !bFrame.current.mask) return;

            try {
                const pipCtx = pipCanvas.getContext("2d", { alpha: false });
                pipCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);

                // Always show Person B with background removed in PiP
                pipCtx.save();
                pipCtx.drawImage(bFrame.current.mask, 0, 0, pipCanvas.width, pipCanvas.height);
                pipCtx.globalCompositeOperation = "source-in";
                pipCtx.drawImage(bFrame.current.image, 0, 0, pipCanvas.width, pipCanvas.height);
                pipCtx.restore();
            } catch (e) {
                console.error("Error drawing PiP canvas:", e);
            }
        };

        let animationFrameId;
        const drawLoop = () => {
            drawMainCanvas();
            drawPipCanvas();
            animationFrameId = requestAnimationFrame(drawLoop);
        };

        const loadSelfieSegmentation = async (video) => {
            try {
                const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
                const { Camera } = await import("@mediapipe/camera_utils");

                const selfieSegmentation = new SelfieSegmentation({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });

                selfieSegmentation.setOptions({ modelSelection: 1 });

                selfieSegmentation.onResults((results) => {
                    if (results && results.image && results.segmentationMask) {
                        bFrame.current = {
                            image: results.image,
                            mask: results.segmentationMask,
                        };
                    }
                });

                const camera = new Camera(video, {
                    onFrame: async () => {
                        if (video.readyState >= 2) {
                            try {
                                await selfieSegmentation.send({ image: video });
                            } catch (e) {
                                console.error("Error in selfie segmentation:", e);
                            }
                        }
                    },
                    width: 640,
                    height: 480,
                });

                camera.start();
            } catch (e) {
                console.error("Error loading selfie segmentation:", e);
            }
        };

        const initPeer = async () => {
            try {
                // Use more specific constraints for iOS
                const constraints = {
                    video: {
                        facingMode: "user",
                        width: { ideal: 640 },
                        height: { ideal: 480 }
                    },
                    audio: false
                };

                const localStream = await navigator.mediaDevices.getUserMedia(constraints);

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = localStream;
                    localVideoRef.current.setAttribute('playsinline', 'true');

                    const playPromise = localVideoRef.current.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            console.error("Play error:", error);
                            if (error.name === "NotAllowedError") {
                                console.log("Autoplay prevented. User interaction required.");
                            }
                        });
                    }
                }

                const newPeer = new Peer({
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' }
                        ]
                    }
                });

                newPeer.on("open", (id) => {
                    setPeerId(id);

                    if (!roomId) {
                        // Person A (room creator)
                        setIsRoomCreator(true);
                    } else {
                        // Person B (joiner)
                        setIsRoomCreator(false);

                        // Person B applies segmentation to their own video (themselves will appear with bg removed)
                        loadSelfieSegmentation(localVideoRef.current);

                        // Person B calls Person A
                        const call = newPeer.call(roomId, localStream);
                        call.on("stream", (remoteStream) => {
                            if (remoteVideoRef.current) {
                                remoteVideoRef.current.srcObject = remoteStream;
                                remoteVideoRef.current.setAttribute('playsinline', 'true');

                                const playPromise = remoteVideoRef.current.play();
                                if (playPromise !== undefined) {
                                    playPromise.catch(error => {
                                        console.error("Remote video play error:", error);
                                    });
                                }
                            }
                        });
                    }
                });

                newPeer.on("call", (call) => {
                    // Person A answers call from Person B
                    call.answer(localStream);

                    call.on("stream", (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream;
                            remoteVideoRef.current.setAttribute('playsinline', 'true');

                            const playPromise = remoteVideoRef.current.play();
                            if (playPromise !== undefined) {
                                playPromise.catch(error => {
                                    console.error("Remote video play error:", error);
                                });
                            }

                            // Person A applies segmentation to Person B's video
                            loadSelfieSegmentation(remoteVideoRef.current);
                        }
                    });
                });

                drawLoop(); // Start drawing loop
            } catch (e) {
                console.error("Error initializing peer:", e);
            }
        };

        initPeer();

        return () => {
            cancelAnimationFrame(animationFrameId);
            // Clean up resources
            if (localVideoRef.current && localVideoRef.current.srcObject) {
                localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
            if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
                remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
        };
    }, [roomId, hasUserInteracted, isRoomCreator]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            {!hasUserInteracted && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-10">
                    <button
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg text-lg"
                        onClick={() => setHasUserInteracted(true)}
                    >
                        Tap to Start Video Call
                    </button>
                </div>
            )}

            <h2 className="text-xl font-bold mb-4">
                {isRoomCreator ? "🅰️ You are Person A (Host)" : "🅱️ You are Person B (Joiner)"}
            </h2>

            <h3 className="mb-2">Your Peer ID: {peerId}</h3>

            {isRoomCreator && peerId && (
                <p className="mb-4">
                    Share this link with your friend to join: <br />
                    <code className="text-blue-600">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </p>
            )}

            <div className="relative">
                {/* Main video canvas */}
                <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    className="rounded-lg border border-gray-400"
                />

                {/* PiP canvas for Person B with removed background */}
                <canvas
                    ref={pipCanvasRef}
                    width={160}
                    height={120}
                    className="absolute top-4 right-4 rounded-md border border-gray-400 shadow-md"
                />
            </div>

            {/* Hidden video elements with playsinline attribute for iOS */}
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}