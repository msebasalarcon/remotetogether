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

    const personAVideoRef = useRef(null);
    const personBVideoRef = useRef(null);
    const bFrame = useRef({ image: null, mask: null });
    const composedCanvasRef = useRef(null);

    useEffect(() => {
        const composedCanvas = document.createElement("canvas");
        composedCanvas.width = 640;
        composedCanvas.height = 480;
        composedCanvasRef.current = composedCanvas;
        const composedCtx = composedCanvas.getContext("2d");

        const drawCanvases = () => {
            composedCtx.clearRect(0, 0, composedCanvas.width, composedCanvas.height);

            if (personAVideoRef.current && personAVideoRef.current.readyState >= 2) {
                composedCtx.drawImage(personAVideoRef.current, 0, 0, composedCanvas.width, composedCanvas.height);
            }

            if (bFrame.current.image && bFrame.current.mask) {
                composedCtx.save();
                composedCtx.drawImage(bFrame.current.mask, 0, 0, composedCanvas.width, composedCanvas.height);
                composedCtx.globalCompositeOperation = "source-in";
                composedCtx.drawImage(bFrame.current.image, 0, 0, composedCanvas.width, composedCanvas.height);
                composedCtx.restore();
            }

            // Also draw on visible canvases for display
            const ctxA = personACanvasRef.current.getContext("2d");
            ctxA.clearRect(0, 0, 640, 480);
            ctxA.drawImage(personAVideoRef.current, 0, 0, 640, 480);

            const ctxB = personBCanvasRef.current.getContext("2d");
            ctxB.clearRect(0, 0, 640, 480);
            if (bFrame.current.image && bFrame.current.mask) {
                ctxB.save();
                ctxB.drawImage(bFrame.current.mask, 0, 0, 640, 480);
                ctxB.globalCompositeOperation = "source-in";
                ctxB.drawImage(bFrame.current.image, 0, 0, 640, 480);
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
                bFrame.current = {
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

            const peer = new Peer();

            peer.on("open", (id) => {
                setPeerId(id);

                if (!roomId) {
                    setIsRoomCreator(true);
                    personAVideoRef.current = localVideoRef.current;
                    personBVideoRef.current = remoteVideoRef.current;
                } else {
                    // Person B logic
                    personBVideoRef.current = localVideoRef.current;
                    const composedStream = composedCanvas.captureStream(30);
                    const call = peer.call(roomId, composedStream);

                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                        setConnected(true);
                        personAVideoRef.current = remoteVideoRef.current;
                        loadSegmentation(personBVideoRef.current);
                    });
                }
            });

            peer.on("call", (call) => {
                call.answer(localStream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    setConnected(true);
                    personAVideoRef.current = localVideoRef.current;
                    personBVideoRef.current = remoteVideoRef.current;
                    loadSegmentation(personBVideoRef.current);
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

            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}
