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

    const localFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        const drawCanvas = () => {
            const canvas = compositeCanvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Background: Always draw Person A (host)
            const backgroundVideo = isRoomCreator ? localVideoRef.current : remoteVideoRef.current;
            if (backgroundVideo && backgroundVideo.readyState >= 2) {
                ctx.drawImage(backgroundVideo, 0, 0, canvas.width, canvas.height);
            }

            // Foreground: Draw Person B (guest) with background removed
            if (!isRoomCreator) {
                // If I’m Person B, draw myself with segmentation
                const { image, mask } = localFrame.current;
                if (image && mask) {
                    ctx.save();
                    ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
                    ctx.globalCompositeOperation = "source-in";
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            } else {
                // If I’m Person A, draw Person B (already pre-segmented)
                const overlayVideo = remoteVideoRef.current;
                if (overlayVideo && overlayVideo.readyState >= 2) {
                    ctx.drawImage(overlayVideo, 0, 0, canvas.width, canvas.height);
                }
            }
        };

        const drawLoop = () => {
            drawCanvas();
            requestAnimationFrame(drawLoop);
        };

        const loadSegmentation = async (videoElement) => {
            const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
            const { Camera } = await import("@mediapipe/camera_utils");

            const segmentation = new SelfieSegmentation({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            segmentation.setOptions({ modelSelection: 1 });

            segmentation.onResults((results) => {
                localFrame.current = {
                    image: results.image,
                    mask: results.segmentationMask,
                };
            });

            const camera = new Camera(videoElement, {
                onFrame: async () => {
                    await segmentation.send({ image: videoElement });
                },
                width: 640,
                height: 480,
            });

            camera.start();
        };

        const initPeer = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });

            localVideoRef.current.srcObject = stream;
            await localVideoRef.current.play();

            const peer = new Peer();
            peer.on("open", (id) => {
                setPeerId(id);

                if (!roomId) {
                    setIsRoomCreator(true);
                } else {
                    // Person B (joiner)
                    const call = peer.call(roomId, stream);
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                        setConnected(true);
                    });
                }
            });

            peer.on("call", (call) => {
                call.answer(stream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    setConnected(true);
                });
            });

            if (roomId) {
                // B only
                await loadSegmentation(localVideoRef.current);
            }

            drawLoop();
        };

        initPeer();
    }, [roomId]);

    const takeScreenshot = () => {
        const canvas = compositeCanvasRef.current;
        const link = document.createElement("a");
        link.download = "virtual-selfie.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-6">
            <h2 className="text-2xl font-bold">
                {isRoomCreator ? "🅰️ Person A (Room Creator)" : "🅱️ Person B (Joiner)"}
            </h2>

            <div className="text-sm text-gray-600">
                Your Peer ID: <span className="font-mono">{peerId}</span>
            </div>

            {isRoomCreator && peerId && (
                <div className="text-center text-blue-700">
                    Share this link with your friend: <br />
                    <code>{`${window.location.origin}/room/${peerId}`}</code>
                </div>
            )}

            <div className="relative">
                <canvas
                    ref={compositeCanvasRef}
                    width={640}
                    height={480}
                    className="rounded-lg border shadow"
                />
                {!connected && (
                    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center text-white text-lg rounded-lg">
                        {isRoomCreator ? "Waiting for Person B..." : "Connecting to Room..."}
                    </div>
                )}
            </div>

            <button
                onClick={takeScreenshot}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
            >
                📸 Take Virtual Photo
            </button>

            {/* Hidden video elements */}
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}
