import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function Room() {
    const { roomId } = useParams();
    const isRoomCreator = !roomId;
    const isPersonB = !isRoomCreator;

    const [peerId, setPeerId] = useState(null);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const outputCanvasRef = useRef(null);
    const displayVideoRef = useRef(null);

    useEffect(() => {
        let peer, localStream, backgroundRemovedStream, compositeStream;
        let animationFrameId;
        let segmentor;

        const start = async () => {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });
            localVideoRef.current.srcObject = localStream;
            await localVideoRef.current.play();

            peer = new Peer();

            peer.on("open", async (id) => {
                setPeerId(id);

                if (isPersonB) {
                    // 🧠 Load MediaPipe with versioned CDN
                    segmentor = new SelfieSegmentation({
                        locateFile: (file) =>
                            `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.4/${file}`,
                    });
                    segmentor.setOptions({ modelSelection: 1 });
                    segmentor.onResults((results) => {
                        const canvas = segmentationCanvasRef.current;
                        const ctx = canvas.getContext("2d");
                        ctx.clearRect(0, 0, canvas.width, canvas.height);

                        if (results.segmentationMask) {
                            ctx.save();
                            ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
                            ctx.globalCompositeOperation = "source-in";
                            ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
                            ctx.restore();
                        }
                    });

                    await segmentor.initialize();

                    const processFrame = () => {
                        segmentor.send({ image: localVideoRef.current });
                        animationFrameId = requestAnimationFrame(processFrame);
                    };
                    processFrame();

                    // ⛲ Capture Person B background-removed stream
                    backgroundRemovedStream = segmentationCanvasRef.current.captureStream(30);

                    // 📞 Call Person A with background-removed stream
                    const call = peer.call(roomId, backgroundRemovedStream);
                    call.on("stream", (finalCompositedStream) => {
                        displayVideoRef.current.srcObject = finalCompositedStream;
                        displayVideoRef.current.play();
                    });
                }
            });

            // 👂 Handle incoming calls
            peer.on("call", (call) => {
                if (!isRoomCreator) return;

                call.answer(localStream); // Send A's full stream

                call.on("stream", (bStream) => {
                    remoteVideoRef.current.srcObject = bStream;
                    remoteVideoRef.current.play();
                    startCompositing(localStream, bStream);
                });
            });
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
            bVideo.muted = true;
            bVideo.play();

            const draw = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(aVideo, 0, 0, canvas.width, canvas.height); // Full background
                ctx.drawImage(bVideo, 0, 0, canvas.width, canvas.height); // Overlay person B
                animationFrameId = requestAnimationFrame(draw);
            };

            draw();

            // 🔄 Send composite stream to B
            compositeStream = canvas.captureStream(30);
            const callBack = peer.call(peerId, compositeStream); // Call B with final stream
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
            <h2 className="text-xl font-bold">
                {isRoomCreator ? "Person A (Room Creator)" : "Person B (Joiner)"}
            </h2>

            {isRoomCreator && peerId && (
                <div className="p-2 bg-blue-100 rounded">
                    Share this link:{" "}
                    <code className="bg-white p-1 rounded">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </div>
            )}

            <div className="flex justify-center space-x-4">
                {isRoomCreator ? (
                    <canvas
                        ref={outputCanvasRef}
                        width={640}
                        height={480}
                        className="border-2"
                    />
                ) : (
                    <video
                        ref={displayVideoRef}
                        width={640}
                        height={480}
                        autoPlay
                        playsInline
                        className="border-2"
                    />
                )}
            </div>

            <div className="hidden">
                <video ref={localVideoRef} muted playsInline />
                <video ref={remoteVideoRef} playsInline />
                <canvas ref={segmentationCanvasRef} width={640} height={480} />
            </div>
        </div>
    );
}
