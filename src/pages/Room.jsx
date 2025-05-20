import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
    const { roomId } = useParams();
    const personACanvasRef = useRef(null);
    const personBCanvasRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);
    const [connected, setConnected] = useState(false);

    // Store frame data for segmentation
    const localFrame = useRef({ image: null, mask: null });
    const remoteFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        const drawCanvases = () => {
            // Draw Person A's normal video on top canvas
            const personACanvas = personACanvasRef.current;
            const ctxA = personACanvas.getContext("2d");
            ctxA.clearRect(0, 0, personACanvas.width, personACanvas.height);

            // Always show remote stream as Person A (with background)
            if (remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                ctxA.drawImage(remoteVideoRef.current, 0, 0, personACanvas.width, personACanvas.height);
            }

            // Draw Person B's segmented video on bottom canvas
            const personBCanvas = personBCanvasRef.current;
            const ctxB = personBCanvas.getContext("2d");
            ctxB.clearRect(0, 0, personBCanvas.width, personBCanvas.height);

            // Always show local stream as Person B (with background removed)
            if (localFrame.current.image && localFrame.current.mask) {
                ctxB.save();
                ctxB.drawImage(localFrame.current.mask, 0, 0, personBCanvas.width, personBCanvas.height);
                ctxB.globalCompositeOperation = "source-in";
                ctxB.drawImage(localFrame.current.image, 0, 0, personBCanvas.width, personBCanvas.height);
                ctxB.restore();
            }
        };

        const drawLoop = () => {
            drawCanvases();
            requestAnimationFrame(drawLoop);
        };

        const loadSegmentation = async (video) => {
            const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
            const { Camera } = await import("@mediapipe/camera_utils");

            const selfieSegmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            selfieSegmentation.setOptions({ modelSelection: 1 });

            selfieSegmentation.onResults((results) => {
                localFrame.current = {
                    image: results.image,
                    mask: results.segmentationMask,
                };
            });

            const camera = new Camera(video, {
                onFrame: async () => {
                    await selfieSegmentation.send({ image: video });
                },
                width: 640,
                height: 480,
            });

            camera.start();
        };

        const initPeer = async () => {
            const localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });

            localVideoRef.current.srcObject = localStream;
            localVideoRef.current.play();

            // Apply segmentation to local video (Person B)
            loadSegmentation(localVideoRef.current);

            const peer = new Peer();

            peer.on("open", (id) => {
                setPeerId(id);

                if (!roomId) {
                    // Person A (room creator)
                    setIsRoomCreator(true);
                } else {
                    // Person B joins
                    const call = peer.call(roomId, localStream);
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                        setConnected(true);
                    });
                }
            });

            peer.on("call", (call) => {
                call.answer(localStream); // A answers B
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    setConnected(true);
                });
            });

            drawLoop();
        };

        initPeer();
    }, [roomId]);

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
                {/* Person A's full video */}
                <div className="relative">
                    <h3 className="text-lg font-semibold mb-2">Person A (with background)</h3>
                    <canvas
                        ref={personACanvasRef}
                        width={640}
                        height={480}
                        className="rounded-lg border border-gray-400"
                    />
                    {!connected && !isRoomCreator && <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg">Waiting for connection...</div>}
                </div>

                {/* Person B's segmented video */}
                <div className="relative">
                    <h3 className="text-lg font-semibold mb-2">Person B (background removed)</h3>
                    <canvas
                        ref={personBCanvasRef}
                        width={640}
                        height={480}
                        className="rounded-lg border border-gray-400"
                    />
                    {!connected && isRoomCreator && <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg">Waiting for connection...</div>}
                </div>
            </div>

            {/* Hidden video elements */}
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}