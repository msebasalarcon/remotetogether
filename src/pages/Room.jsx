import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
    const { roomId } = useParams();
    const compositeCanvasRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);
    const [connected, setConnected] = useState(false);

    // Store segmentation data
    const segmentationData = useRef({
        personB: { image: null, mask: null }
    });

    useEffect(() => {
        let selfieSegmentation = null;
        let camera = null;

        const drawCanvas = () => {
            const canvas = compositeCanvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Always draw Person A's video as background
            const backgroundVideo = isRoomCreator ? localVideoRef.current : remoteVideoRef.current;
            if (backgroundVideo?.readyState >= 2) {
                ctx.drawImage(backgroundVideo, 0, 0, canvas.width, canvas.height);
            }

            // Draw Person B's segmented video on top if available
            const personBData = segmentationData.current.personB;
            if (personBData.image && personBData.mask) {
                ctx.save();
                ctx.drawImage(personBData.mask, 0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-in";
                ctx.drawImage(personBData.image, 0, 0, canvas.width, canvas.height);
                ctx.restore();
            }
        };

        const drawLoop = () => {
            drawCanvas();
            requestAnimationFrame(drawLoop);
        };

        const setupSegmentation = async () => {
            try {
                const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
                selfieSegmentation = new SelfieSegmentation({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });

                selfieSegmentation.setOptions({
                    modelSelection: 1,
                    selfieMode: true,
                });

                selfieSegmentation.onResults((results) => {
                    // Only store segmentation data if we're Person B
                    if (!isRoomCreator) {
                        segmentationData.current.personB = {
                            image: results.image,
                            mask: results.segmentationMask,
                        };
                    }
                });

                return selfieSegmentation;
            } catch (error) {
                console.error("Error setting up segmentation:", error);
                return null;
            }
        };

        const startCamera = async (video, segmentation) => {
            try {
                const { Camera } = await import("@mediapipe/camera_utils");
                camera = new Camera(video, {
                    onFrame: async () => {
                        if (segmentation) {
                            await segmentation.send({ image: video });
                        }
                    },
                    width: 640,
                    height: 480,
                });
                await camera.start();
            } catch (error) {
                console.error("Error starting camera:", error);
            }
        };

        const initPeer = async () => {
            try {
                const localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });

                localVideoRef.current.srcObject = localStream;
                await localVideoRef.current.play();

                // If we're Person B, set up segmentation immediately
                let segmentation = null;
                if (!isRoomCreator) {
                    segmentation = await setupSegmentation();
                    if (segmentation) {
                        await startCamera(localVideoRef.current, segmentation);
                    }
                }

                const peer = new Peer({
                    config: {
                        iceServers: [
                            { urls: "stun:stun.l.google.com:19302" },
                            { urls: "stun:stun1.l.google.com:19302" },
                        ],
                    },
                });

                peer.on("open", (id) => {
                    setPeerId(id);
                    if (!roomId) {
                        setIsRoomCreator(true);
                    } else {
                        // Person B connects to Person A
                        const call = peer.call(roomId, localStream);
                        call.on("stream", async (remoteStream) => {
                            remoteVideoRef.current.srcObject = remoteStream;
                            await remoteVideoRef.current.play();
                            setConnected(true);
                        });
                    }
                });

                peer.on("call", (call) => {
                    // Person A answers Person B
                    call.answer(localStream);
                    call.on("stream", async (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        await remoteVideoRef.current.play();
                        setConnected(true);
                    });
                });

                peer.on("error", (error) => {
                    console.error("Peer connection error:", error);
                    setConnected(false);
                });

                peer.on("disconnected", () => {
                    console.log("Peer disconnected");
                    setConnected(false);
                });

                drawLoop();
            } catch (error) {
                console.error("Error in peer initialization:", error);
            }
        };

        initPeer();

        return () => {
            if (camera) {
                camera.stop();
            }
            if (selfieSegmentation) {
                selfieSegmentation.close();
            }
        };
    }, [roomId, isRoomCreator]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
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

            <div className="flex flex-col items-center gap-4">
                <div className="relative">
                    <h3 className="text-lg font-semibold mb-2">
                        {connected ? "Connected - Composite View" : "Waiting for connection..."}
                    </h3>
                    <canvas
                        ref={compositeCanvasRef}
                        width={640}
                        height={480}
                        className="rounded-lg border border-gray-400"
                    />
                    {!connected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg">
                            {isRoomCreator ? "Waiting for Person B to join..." : "Connecting to room..."}
                        </div>
                    )}
                </div>
            </div>

            {/* Hidden video elements */}
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}