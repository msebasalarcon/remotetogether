import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function Room() {
    const params = useParams();
    const navigate = useNavigate();

    const [peerId, setPeerId] = useState(null);
    const [connected, setConnected] = useState(false);

    const roomIdFromURL = params.roomId;
    const isRoomCreator = !roomIdFromURL;
    const isPersonB = !isRoomCreator;

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const outputCanvasRef = useRef(null);
    const segmentationCanvasRef = useRef(null);

    useEffect(() => {
        let localStream;
        let canvasStream;
        let segmentor;
        let animationFrameId;
        let peer;

        const initSegmentation = async () => {
            if (!isPersonB) return null;
            segmentor = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });
            segmentor.setOptions({ modelSelection: 1 });
            await segmentor.initialize();
            return segmentor;
        };

        const startPersonBSegmentation = async () => {
            if (!isPersonB || !segmentor) return;
            const segCanvas = segmentationCanvasRef.current;
            const video = localVideoRef.current;
            const ctx = segCanvas.getContext('2d');

            segmentor.onResults((results) => {
                ctx.clearRect(0, 0, segCanvas.width, segCanvas.height);
                if (results.segmentationMask) {
                    ctx.save();
                    ctx.drawImage(results.segmentationMask, 0, 0, segCanvas.width, segCanvas.height);
                    ctx.globalCompositeOperation = "source-in";
                    ctx.drawImage(video, 0, 0, segCanvas.width, segCanvas.height);
                    ctx.restore();
                }
            });

            const processFrames = () => {
                if (video.readyState >= 2) {
                    segmentor.send({ image: video });
                }
                animationFrameId = requestAnimationFrame(processFrames);
            };
            processFrames();

            canvasStream = segCanvas.captureStream(30);
            return canvasStream;
        };

        const setupStreams = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: false,
                });

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = localStream;
                    await localVideoRef.current.play();
                }

                if (isPersonB) {
                    await initSegmentation();
                    setTimeout(async () => {
                        canvasStream = await startPersonBSegmentation();
                    }, 1000);
                }

                peer = new Peer({
                    config: {
                        iceServers: [
                            { urls: "stun:stun.l.google.com:19302" },
                            { urls: "stun:stun1.l.google.com:19302" },
                        ],
                    },
                });

                peer.on("open", (id) => {
                    setPeerId(id);
                    if (isRoomCreator) {
                        navigate(`/room/${id}`, { replace: true });
                    }

                    if (isPersonB) {
                        const callWhenReady = () => {
                            if (!canvasStream) {
                                setTimeout(callWhenReady, 500);
                                return;
                            }

                            const call = peer.call(roomIdFromURL, canvasStream);
                            call.on("stream", async (remoteStream) => {
                                if (remoteVideoRef.current) {
                                    remoteVideoRef.current.srcObject = remoteStream;
                                    await remoteVideoRef.current.play();
                                    setConnected(true);
                                    startDrawingOutput();
                                }
                            });

                            call.on("error", (err) => console.error("Call error:", err));
                        };
                        callWhenReady();
                    }
                });

                peer.on("call", (call) => {
                    call.answer(localStream);
                    call.on("stream", async (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream;
                            await remoteVideoRef.current.play();
                            setConnected(true);
                            startDrawingOutput();
                        }
                    });
                });

                peer.on("error", (err) => console.error("Peer error:", err));

                setTimeout(() => {
                    startDrawingOutput();
                }, 500);
            } catch (error) {
                console.error("Error setting up streams:", error);
            }
        };

        const startDrawingOutput = () => {
            const outputCanvas = outputCanvasRef.current;
            if (!outputCanvas) return;
            const ctx = outputCanvas.getContext('2d');

            const drawLoop = () => {
                ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
                const halfWidth = outputCanvas.width / 2;

                if (isRoomCreator) {
                    if (localVideoRef.current?.readyState >= 2) {
                        ctx.drawImage(localVideoRef.current, 0, 0, halfWidth, outputCanvas.height);
                    }
                    if (remoteVideoRef.current?.readyState >= 2) {
                        ctx.drawImage(remoteVideoRef.current, halfWidth, 0, halfWidth, outputCanvas.height);
                    }
                } else {
                    if (remoteVideoRef.current?.readyState >= 2) {
                        ctx.drawImage(remoteVideoRef.current, 0, 0, halfWidth, outputCanvas.height);
                    }
                    if (segmentationCanvasRef.current) {
                        ctx.drawImage(segmentationCanvasRef.current, halfWidth, 0, halfWidth, outputCanvas.height);
                    }
                }

                ctx.font = "20px Arial";
                ctx.fillStyle = "white";
                ctx.strokeStyle = "black";
                ctx.lineWidth = 3;
                ctx.strokeText("Person A", 20, 30);
                ctx.fillText("Person A", 20, 30);
                ctx.strokeText("Person B (No Background)", halfWidth + 20, 30);
                ctx.fillText("Person B (No Background)", halfWidth + 20, 30);

                animationFrameId = requestAnimationFrame(drawLoop);
            };
            drawLoop();
        };

        setupStreams();

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            if (canvasStream) canvasStream.getTracks().forEach(t => t.stop());
            if (segmentor) segmentor.close();
            if (peer) peer.destroy();
        };
    }, [roomIdFromURL, isPersonB, isRoomCreator]);

    return (
        <div className="flex flex-col items-center gap-4 p-6">
            <h2 className="text-2xl font-bold">
                {isRoomCreator ? "🅰 Person A (Creator)" : "🅱 Person B (Joiner)"}
            </h2>

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
