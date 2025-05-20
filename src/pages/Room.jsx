// pages/Room.jsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function Room() {
    const { roomId } = useParams();
    const isRoomCreator = !roomId;
    const isPersonB = !isRoomCreator; // Person B is the joiner

    // Video references
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    // Canvas references
    const outputCanvasRef = useRef(null);  // Canvas for displaying final output
    const segmentationCanvasRef = useRef(null); // For Person B's segmentation processing

    const [peerId, setPeerId] = useState(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let localStream;
        let canvasStream;
        let segmentor;
        let animationFrameId;
        let peer;

        // Initialize MediaPipe Selfie Segmentation (only for Person B)
        const initSegmentation = async () => {
            if (!isPersonB) return null; // Only Person B needs segmentation

            console.log("Initializing segmentation for Person B");
            segmentor = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            segmentor.setOptions({
                modelSelection: 1, // Use full model for better quality
            });

            // Wait for the model to load
            await segmentor.initialize();
            return segmentor;
        };

        // Function to start processing Person B's video with background removal
        const startPersonBSegmentation = async () => {
            if (!isPersonB || !segmentor) return; // Only Person B does segmentation

            console.log("Starting Person B segmentation process");
            const segCanvas = segmentationCanvasRef.current;
            const video = localVideoRef.current;

            if (!segCanvas || !video || video.readyState < 2) {
                console.log("Video or canvas not ready yet");
                return;
            }

            const ctx = segCanvas.getContext('2d');

            // Setup segmentation results handler
            segmentor.onResults((results) => {
                // Clear canvas
                ctx.clearRect(0, 0, segCanvas.width, segCanvas.height);

                if (results.segmentationMask) {
                    // Draw the segmentation mask
                    ctx.save();
                    ctx.drawImage(results.segmentationMask, 0, 0, segCanvas.width, segCanvas.height);

                    // Use the mask as a clipping region
                    ctx.globalCompositeOperation = "source-in";

                    // Draw the original image, but only where the mask exists
                    ctx.drawImage(video, 0, 0, segCanvas.width, segCanvas.height);
                    ctx.restore();
                }
            });

            // Start processing video frames
            const processFrames = () => {
                if (video.readyState >= 2) {
                    segmentor.send({ image: video });
                }
                animationFrameId = requestAnimationFrame(processFrames);
            };

            processFrames();

            // Capture the segmentation canvas as a stream (this is what Person B will send)
            canvasStream = segCanvas.captureStream(30); // 30fps
            return canvasStream;
        };

        // Setup video streams and PeerJS connection
        const setupStreams = async () => {
            try {
                // 1. Get local media stream
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: false
                });

                // 2. Set local video source
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = localStream;
                    await localVideoRef.current.play().catch(e => console.error("Error playing local video:", e));
                }

                // 3. Initialize segmentation if we're Person B
                if (isPersonB) {
                    await initSegmentation();

                    // Wait a moment for the video to be ready
                    setTimeout(async () => {
                        // Start segmentation and get the canvas stream
                        canvasStream = await startPersonBSegmentation();
                    }, 1000);
                }

                // 4. Create peer connection
                peer = new Peer({
                    config: {
                        iceServers: [
                            { urls: "stun:stun.l.google.com:19302" },
                            { urls: "stun:stun1.l.google.com:19302" }
                        ]
                    }
                });

                peer.on("open", (id) => {
                    console.log("My peer ID is:", id);
                    setPeerId(id);

                    // If we're Person B (joiner), initiate call with our processed canvas stream
                    if (isPersonB) {
                        console.log("Person B joining room:", roomId);

                        // We need to wait until segmentation is ready and canvas stream exists
                        const makeCall = () => {
                            if (!canvasStream) {
                                console.log("Waiting for canvas stream...");
                                setTimeout(makeCall, 500); // Check again in 500ms
                                return;
                            }

                            console.log("Person B initiating call with canvas stream");
                            const call = peer.call(roomId, canvasStream);

                            call.on("stream", async (remoteStream) => {
                                console.log("Person B received Person A's stream");
                                if (remoteVideoRef.current) {
                                    remoteVideoRef.current.srcObject = remoteStream;
                                    await remoteVideoRef.current.play().catch(e => console.error("Error playing remote video:", e));
                                    setConnected(true);
                                    startDrawingOutput();
                                }
                            });

                            call.on("error", (err) => {
                                console.error("Call error:", err);
                            });
                        };

                        // Start trying to call
                        makeCall();
                    }
                });

                // Handle incoming calls (if you're Person A / room creator)
                peer.on("call", (call) => {
                    console.log("Person A received call from Person B");
                    // Person A always answers with their raw camera stream
                    call.answer(localStream);

                    call.on("stream", async (remoteStream) => {
                        console.log("Person A received Person B's segmented stream");
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream;
                            await remoteVideoRef.current.play().catch(e => console.error("Error playing remote video:", e));
                            setConnected(true);
                            startDrawingOutput();
                        }
                    });

                    call.on("error", (err) => {
                        console.error("Call error:", err);
                    });
                });

                peer.on("error", (err) => {
                    console.error("Peer error:", err);
                });

                // Start showing local content while waiting
                setTimeout(() => {
                    startDrawingOutput();
                }, 500);

            } catch (error) {
                console.error("Error setting up streams:", error);
            }
        };

        // Function to draw the final output (which videos go where depending on role)
        const startDrawingOutput = () => {
            const outputCanvas = outputCanvasRef.current;
            if (!outputCanvas) return;

            const ctx = outputCanvas.getContext('2d');

            const drawLoop = () => {
                try {
                    ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

                    // Draw side by side videos: local and remote
                    const halfWidth = outputCanvas.width / 2;

                    // Draw Person A (always on the left)
                    // For Person A, this is their local video
                    // For Person B, this is their remote video
                    if (isRoomCreator) { // Person A
                        if (localVideoRef.current && localVideoRef.current.readyState >= 2) {
                            ctx.drawImage(localVideoRef.current, 0, 0, halfWidth, outputCanvas.height);
                        }
                    } else { // Person B
                        if (remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                            ctx.drawImage(remoteVideoRef.current, 0, 0, halfWidth, outputCanvas.height);
                        }
                    }

                    // Draw Person B (always on the right)
                    // For Person A, this is the remote stream (already segmented by Person B)
                    // For Person B, this is their segmentation canvas
                    if (isRoomCreator) { // Person A viewing Person B
                        if (remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                            ctx.drawImage(remoteVideoRef.current, halfWidth, 0, halfWidth, outputCanvas.height);
                        }
                    } else { // Person B viewing themselves
                        if (segmentationCanvasRef.current) {
                            ctx.drawImage(segmentationCanvasRef.current, halfWidth, 0, halfWidth, outputCanvas.height);
                        }
                    }

                    // Draw labels
                    ctx.font = "20px Arial";
                    ctx.fillStyle = "white";
                    ctx.strokeStyle = "black";
                    ctx.lineWidth = 3;

                    // Person A label (left side)
                    ctx.strokeText("Person A", 20, 30);
                    ctx.fillText("Person A", 20, 30);

                    // Person B label (right side)
                    ctx.strokeText("Person B (No Background)", halfWidth + 20, 30);
                    ctx.fillText("Person B (No Background)", halfWidth + 20, 30);

                } catch (error) {
                    console.error("Error in draw loop:", error);
                }

                animationFrameId = requestAnimationFrame(drawLoop);
            };

            drawLoop();
        };

        // Setup everything
        setupStreams();

        // Cleanup
        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }

            if (canvasStream) {
                canvasStream.getTracks().forEach(track => track.stop());
            }

            if (segmentor) {
                segmentor.close();
            }

            if (peer) {
                peer.destroy();
            }
        };
    }, [roomId, isRoomCreator, isPersonB]);

    return (
        <div className="flex flex-col items-center gap-4 p-6">
            <h2 className="text-2xl font-bold">{isRoomCreator ? "🅰 Person A (Creator)" : "🅱 Person B (Joiner)"}</h2>

            {peerId && (
                <p className="text-lg">Your Peer ID: <code className="bg-gray-100 p-1 rounded">{peerId}</code></p>
            )}

            {isRoomCreator && peerId && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 my-2 max-w-xl">
                    <p className="font-medium">Share this link with Person B:</p>
                    <code className="block bg-white p-2 mt-1 rounded text-sm overflow-auto">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </div>
            )}

            {/* Main output canvas for both participants */}
            <div className="border-2 rounded-lg overflow-hidden shadow-lg">
                <canvas
                    ref={outputCanvasRef}
                    width={1280}
                    height={480}
                    className="bg-gray-100"
                />
            </div>

            {!connected && !isRoomCreator && (
                <p className="mt-2 text-amber-600">Connecting to room creator...</p>
            )}

            {/* Hidden video elements and processing canvas */}
            <div className="hidden">
                <video ref={localVideoRef} width="320" height="240" muted playsInline />
                <video ref={remoteVideoRef} width="320" height="240" playsInline />
                {isPersonB && (
                    <canvas ref={segmentationCanvasRef} width={640} height={480} />
                )}
            </div>
        </div>
    );
}