import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
    const { roomId } = useParams();
    const compositeCanvasRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const segmentationRef = useRef(null);

    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);
    const [connected, setConnected] = useState(false);

    // Store frame data for segmentation
    const localFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        let selfieSegmentation = null;
        let camera = null;

        const drawCanvas = () => {
            const canvas = compositeCanvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw background video (Person A)
            if (isRoomCreator) {
                // If I'm Person A, use my local video as background
                if (localVideoRef.current?.readyState >= 2) {
                    ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
                }
            } else {
                // If I'm Person B, use remote video (Person A) as background
                if (remoteVideoRef.current?.readyState >= 2) {
                    ctx.drawImage(remoteVideoRef.current, 0, 0, canvas.width, canvas.height);
                }
            }

            // Draw Person B's segmented video on top
            if (!isRoomCreator && localFrame.current.image && localFrame.current.mask) {
                // If I'm Person B, draw my segmented video
                ctx.save();
                ctx.drawImage(localFrame.current.mask, 0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-in";
                ctx.drawImage(localFrame.current.image, 0, 0, canvas.width, canvas.height);
                ctx.restore();
            } else if (isRoomCreator && remoteVideoRef.current?.readyState >= 2) {
                // If I'm Person A, draw remote video (Person B)
                if (segmentationRef.current?.image && segmentationRef.current.mask) {
                    ctx.save();
                    ctx.drawImage(segmentationRef.current.mask, 0, 0, canvas.width, canvas.height);
                    ctx.globalCompositeOperation = "source-in";
                    ctx.drawImage(segmentationRef.current.image, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            }
        };

        const drawLoop = () => {
            drawCanvas();
            requestAnimationFrame(drawLoop);
        };

        const loadSegmentation = async (video) => {
            try {
                const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
                const { Camera } = await import("@mediapipe/camera_utils");

                selfieSegmentation = new SelfieSegmentation({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });

                selfieSegmentation.setOptions({ modelSelection: 1 });

                selfieSegmentation.onResults((results) => {
                    if (!isRoomCreator) {
                        // If I'm Person B, store my segmented frame
                        localFrame.current = {
                            image: results.image,
                            mask: results.segmentationMask,
                        };
                    } else {
                        // If I'm Person A, store remote person's segmented frame
                        segmentationRef.current = {
                            image: results.image,
                            mask: results.segmentationMask,
                        };
                    }
                });

                camera = new Camera(video, {
                    onFrame: async () => {
                        await selfieSegmentation.send({ image: video });
                    },
                    width: 640,
                    height: 480,
                });

                camera.start();
            } catch (error) {
                console.error("Error loading segmentation:", error);
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

                const peer = new Peer();

                peer.on("open", (id) => {
                    setPeerId(id);

                    if (!roomId) {
                        // Person A (room creator)
                        setIsRoomCreator(true);
                    } else {
                        // Person B joins and needs segmentation
                        loadSegmentation(localVideoRef.current);
                        const call = peer.call(roomId, localStream);
                        call.on("stream", (remoteStream) => {
                            remoteVideoRef.current.srcObject = remoteStream;
                            remoteVideoRef.current.play().catch(console.error);
                            setConnected(true);
                        });
                    }
                });

                peer.on("call", (call) => {
                    call.answer(localStream); // A answers B
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play().catch(console.error);
                        // Person A receives B's stream, apply segmentation to remote video
                        loadSegmentation(remoteVideoRef.current);
                        setConnected(true);
                    });
                });

                drawLoop();
            } catch (error) {
                console.error("Error initializing peer:", error);
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
                    <h3 className="text-lg font-semibold mb-2">Composite View</h3>
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