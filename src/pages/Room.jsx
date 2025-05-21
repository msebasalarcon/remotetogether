import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const isRoomCreator = !roomId;
    const isPersonB = !isRoomCreator;

    const [peerId, setPeerId] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [finalStream, setFinalStream] = useState(null);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const outputCanvasRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const displayCanvasRef = useRef(null);

    useEffect(() => {
        let peer, localStream, canvasStream, compositeStream, conn, segmentor;
        let animationFrameId;

        const start = async () => {
            // Get local camera
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            localVideoRef.current.srcObject = localStream;
            await localVideoRef.current.play();

            peer = new Peer();
            peer.on("open", (id) => {
                setPeerId(id);
                if (isRoomCreator) return;
                // Join as Person B
                const callInterval = setInterval(() => {
                    if (canvasStream) {
                        clearInterval(callInterval);
                        const call = peer.call(roomId, canvasStream);
                        call.on("stream", (stream) => {
                            setFinalStream(stream);
                            displayCanvasRef.current.srcObject = stream;
                            displayCanvasRef.current.play();
                        });
                    }
                }, 500);
            });

            // Person A handles incoming call
            peer.on("call", async (call) => {
                if (!isRoomCreator) return;
                call.answer(localStream);
                call.on("stream", (bStream) => {
                    setRemoteStream(bStream);
                    startCompositing(localStream, bStream);
                });
            });

            if (isPersonB) {
                // Background removal using MediaPipe
                segmentor = new SelfieSegmentation({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });
                segmentor.setOptions({ modelSelection: 1 });
                await segmentor.initialize();

                const segCanvas = segmentationCanvasRef.current;
                const ctx = segCanvas.getContext("2d");

                segmentor.onResults((results) => {
                    ctx.clearRect(0, 0, segCanvas.width, segCanvas.height);
                    if (results.segmentationMask) {
                        ctx.save();
                        ctx.drawImage(results.segmentationMask, 0, 0, segCanvas.width, segCanvas.height);
                        ctx.globalCompositeOperation = "source-in";
                        ctx.drawImage(localVideoRef.current, 0, 0, segCanvas.width, segCanvas.height);
                        ctx.restore();
                    }
                });

                const process = () => {
                    segmentor.send({ image: localVideoRef.current });
                    animationFrameId = requestAnimationFrame(process);
                };
                process();

                canvasStream = segCanvas.captureStream(30);
            }
        };

        const startCompositing = (aStream, bStream) => {
            const canvas = outputCanvasRef.current;
            const ctx = canvas.getContext("2d");

            const aVideo = document.createElement("video");
            aVideo.srcObject = aStream;
            aVideo.muted = true;
            aVideo.play();

            const bVideo = document.createElement("video");
            bVideo.srcObject = bStream;
            bVideo.play();

            const draw = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(aVideo, 0, 0, canvas.width / 2, canvas.height);
                ctx.drawImage(bVideo, canvas.width / 2, 0, canvas.width / 2, canvas.height);
                animationFrameId = requestAnimationFrame(draw);
            };
            draw();

            // Send canvas back to Person B
            compositeStream = canvas.captureStream(30);
            const call = peer.call(peerId, compositeStream);
        };

        start();

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            if (localStream) localStream.getTracks().forEach((t) => t.stop());
            if (peer) peer.destroy();
        };
    }, [roomId]);

    return (
        <div className="p-6 space-y-4 text-center">
            <h2 className="text-xl font-bold">{isRoomCreator ? "Person A (Room Creator)" : "Person B (Joiner)"}</h2>
            {isRoomCreator && peerId && (
                <div className="p-2 bg-blue-100 rounded">
                    Share this link:{" "}
                    <code className="bg-white p-1 rounded">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </div>
            )}

            <div className="flex justify-center space-x-4">
                <canvas ref={outputCanvasRef} width={640} height={480} className="border-2" />
                <video ref={displayCanvasRef} width={640} height={480} className="border-2" autoPlay playsInline muted />
            </div>

            {/* Hidden refs */}
            <div className="hidden">
                <video ref={localVideoRef} muted playsInline />
                <video ref={remoteVideoRef} playsInline />
                {isPersonB && <canvas ref={segmentationCanvasRef} width={640} height={480} />}
            </div>
        </div>
    );
}
