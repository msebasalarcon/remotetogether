import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
    const { roomId } = useParams();
    const canvasRef = useRef(null);
    const pipCanvasRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);
    const bFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        let localStream;
        let peer;

        const drawMainCanvas = () => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Draw Person A full background
            const backgroundVideo = isRoomCreator ? localVideoRef.current : remoteVideoRef.current;
            if (backgroundVideo && backgroundVideo.readyState >= 2) {
                ctx.drawImage(backgroundVideo, 0, 0, canvas.width, canvas.height);
            }
            // Draw Person B segmented overlay
            if (bFrame.current.image && bFrame.current.mask) {
                ctx.save();
                ctx.drawImage(bFrame.current.mask, 0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-in";
                ctx.drawImage(bFrame.current.image, 0, 0, canvas.width, canvas.height);
                ctx.restore();
                ctx.globalCompositeOperation = "source-over"; // reset
            }
        };

        const drawPipCanvas = () => {
            const pipCanvas = pipCanvasRef.current;
            if (!pipCanvas || !bFrame.current.image || !bFrame.current.mask) return;
            const pipCtx = pipCanvas.getContext("2d");
            pipCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
            pipCtx.save();
            pipCtx.drawImage(bFrame.current.mask, 0, 0, pipCanvas.width, pipCanvas.height);
            pipCtx.globalCompositeOperation = "source-in";
            pipCtx.drawImage(bFrame.current.image, 0, 0, pipCanvas.width, pipCanvas.height);
            pipCtx.restore();
            pipCtx.globalCompositeOperation = "source-over";
        };

        const drawLoop = () => {
            drawMainCanvas();
            drawPipCanvas();
            requestAnimationFrame(drawLoop);
        };

        const loadSegmentation = async (videoElement) => {
            const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
            const { Camera } = await import("@mediapipe/camera_utils");
            const selfieSegmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });
            selfieSegmentation.setOptions({ modelSelection: 1 });
            selfieSegmentation.onResults((results) => {
                bFrame.current = {
                    image: results.image,
                    mask: results.segmentationMask,
                };
            });
            // Start the camera or video feed for segmentation
            new Camera(videoElement, {
                onFrame: async () => {
                    await selfieSegmentation.send({ image: videoElement });
                },
                width: 640,
                height: 480,
            }).start();
        };

        const initPeer = async () => {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            localVideoRef.current.srcObject = localStream;
            localVideoRef.current.play();

            peer = new Peer();
            peer.on("open", (id) => {
                setPeerId(id);
                if (!roomId) {
                    // Person A creates room
                    setIsRoomCreator(true);
                } else {
                    // Person B joins existing room
                    const call = peer.call(roomId, localStream);
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                        // Segment Person B's own video
                        loadSegmentation(localVideoRef.current);
                    });
                }
            });

            peer.on("call", (call) => {
                // Person A receives call from B
                call.answer(localStream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    // Segment incoming Person B video
                    loadSegmentation(remoteVideoRef.current);
                });
            });

            drawLoop();
        };

        initPeer();

        return () => {
            if (peer) peer.disconnect();
            if (localStream) {
                localStream.getTracks().forEach((t) => t.stop());
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
            <div className="relative">
                <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    className="rounded-lg border border-gray-400"
                />
                <canvas
                    ref={pipCanvasRef}
                    width={160}
                    height={120}
                    className="absolute top-4 right-4 rounded-md border border-gray-400 shadow-md"
                />
            </div>
            {/* Hidden video elements for stream sources */}
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}
