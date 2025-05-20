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
    // Add remote frame data for Person B's segmented video
    const remoteFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        const drawCanvases = () => {
            const canvasA = personACanvasRef.current;
            const ctxA = canvasA.getContext("2d");
            ctxA.clearRect(0, 0, canvasA.width, canvasA.height);

            const canvasB = personBCanvasRef.current;
            const ctxB = canvasB.getContext("2d");
            ctxB.clearRect(0, 0, canvasB.width, canvasB.height);

            if (isRoomCreator) {
                // — Person A view —
                // Top: local raw
                if (localVideoRef.current.readyState >= 2) {
                    ctxA.drawImage(localVideoRef.current, 0, 0, canvasA.width, canvasA.height);
                }
                // Bottom: remote segmented (using remoteFrame data)
                if (remoteFrame.current.image && remoteFrame.current.mask) {
                    ctxB.save();
                    ctxB.drawImage(remoteFrame.current.mask, 0, 0, canvasB.width, canvasB.height);
                    ctxB.globalCompositeOperation = "source-in";
                    ctxB.drawImage(remoteFrame.current.image, 0, 0, canvasB.width, canvasB.height);
                    ctxB.restore();
                } else if (remoteVideoRef.current.readyState >= 2) {
                    // Fallback to raw video if segmented data isn't available yet
                    ctxB.drawImage(remoteVideoRef.current, 0, 0, canvasB.width, canvasB.height);
                }
            } else {
                // — Person B view —
                // Top: remote raw
                if (remoteVideoRef.current.readyState >= 2) {
                    ctxA.drawImage(remoteVideoRef.current, 0, 0, canvasA.width, canvasA.height);
                }
                // Bottom: local segmented
                if (localFrame.current.image && localFrame.current.mask) {
                    ctxB.save();
                    ctxB.drawImage(localFrame.current.mask, 0, 0, canvasB.width, canvasB.height);
                    ctxB.globalCompositeOperation = "source-in";
                    ctxB.drawImage(localFrame.current.image, 0, 0, canvasB.width, canvasB.height);
                    ctxB.restore();
                }
            }
        };

        const drawLoop = () => {
            drawCanvases();
            requestAnimationFrame(drawLoop);
        };

        const loadSegmentation = async (video, frameRef) => {
            const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
            const { Camera } = await import("@mediapipe/camera_utils");
            const segmenter = new SelfieSegmentation({
                locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`,
            });
            segmenter.setOptions({ modelSelection: 1 });
            segmenter.onResults((results) => {
                frameRef.current = {
                    image: results.image,
                    mask: results.segmentationMask,
                };
            });
            const camera = new Camera(video, {
                onFrame: () => segmenter.send({ image: video }),
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
                setIsRoomCreator(!roomId);

                // Person B: segment local stream and send data to Person A
                if (roomId) {
                    loadSegmentation(localVideoRef.current, localFrame);

                    // Connect to Person A
                    const call = peer.call(roomId, localStream);
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                        setConnected(true);
                    });

                    // Send segmentation data to Person A periodically
                    setInterval(() => {
                        if (localFrame.current.image && localFrame.current.mask && call.peerConnection) {
                            // We can't send the actual frames over the data connection,
                            // so for a real implementation you'd need to send the segmentation
                            // data as a separate video track or through WebRTC data channels
                        }
                    }, 100);
                }
            });

            peer.on("call", (call) => {
                // Person A answers
                call.answer(localStream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();

                    // Apply segmentation to the remote video for Person A
                    loadSegmentation(remoteVideoRef.current, remoteFrame);

                    setConnected(true);
                });
            });

            drawLoop();
        };

        initPeer();
    }, [roomId, isRoomCreator]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <h2 className="text-xl font-bold mb-4">
                {isRoomCreator ? "🅰️ You are Person A (Host)" : "🅱️ You are Person B (Joiner)"}
            </h2>
            <h3 className="mb-2">Your Peer ID: {peerId}</h3>
            {isRoomCreator && peerId && (
                <p className="mb-4">
                    Share this link with your friend:<br />
                    <code className="text-blue-600">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </p>
            )}
            <div className="flex flex-col items-center gap-4">
                <div className="relative">
                    <h3 className="text-lg font-semibold mb-2">Person A (with background)</h3>
                    <canvas ref={personACanvasRef} width={640} height={480}
                        className="rounded-lg border border-gray-400" />
                    {!connected && !isRoomCreator && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg">
                            Waiting for connection...
                        </div>
                    )}
                </div>
                <div className="relative">
                    <h3 className="text-lg font-semibold mb-2">Person B (background removed)</h3>
                    <canvas ref={personBCanvasRef} width={640} height={480}
                        className="rounded-lg border border-gray-400" />
                    {!connected && isRoomCreator && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg">
                            Waiting for connection...
                        </div>
                    )}
                </div>
            </div>
            <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
        </div>
    );
}