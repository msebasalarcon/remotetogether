// Room.jsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function Room() {
    const { roomId } = useParams();
    const isRoomCreator = !roomId;
    const [peerId, setPeerId] = useState(null);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    const finalVideoRef = useRef(null);

    useEffect(() => {
        let peer, localStream, remoteStream, segmentor;
        let animationFrame;

        const setup = async () => {
            peer = new Peer();
            peer.on("open", (id) => {
                setPeerId(id);
                if (!isRoomCreator) {
                    joinRoom(id);
                }
            });

            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            localVideoRef.current.srcObject = localStream;
            await localVideoRef.current.play();

            peer.on("call", async (call) => {
                if (!isRoomCreator) return;

                // Person A: Answer with full local video
                call.answer(localStream);

                // Get B's stream (background-removed)
                call.on("stream", async (bStream) => {
                    remoteVideoRef.current.srcObject = bStream;
                    await remoteVideoRef.current.play();

                    // Start compositing A + B
                    startCompositing(localStream, bStream);

                    // Send final composited stream back to B
                    const compositeStream = compositeCanvasRef.current.captureStream(30);
                    const returnCall = peer.call(call.peer, compositeStream);
                });
            });
        };

        const joinRoom = async (myId) => {
            // Person B: Initialize MediaPipe
            segmentor = new SelfieSegmentation({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });
            segmentor.setOptions({ modelSelection: 1 });
            await segmentor.initialize();

            const segCanvas = segmentationCanvasRef.current;
            const segCtx = segCanvas.getContext("2d");

            segmentor.onResults((results) => {
                segCtx.clearRect(0, 0, segCanvas.width, segCanvas.height);
                segCtx.save();
                segCtx.drawImage(results.segmentationMask, 0, 0, segCanvas.width, segCanvas.height);
                segCtx.globalCompositeOperation = "source-in";
                segCtx.drawImage(localVideoRef.current, 0, 0, segCanvas.width, segCanvas.height);
                segCtx.restore();
            });

            const processFrame = async () => {
                await segmentor.send({ image: localVideoRef.current });
                animationFrame = requestAnimationFrame(processFrame);
            };

            processFrame();

            const processedStream = segCanvas.captureStream(30);
            const call = peer.call(roomId, processedStream);

            // Listen for final stream from A
            call.on("stream", (finalStream) => {
                finalVideoRef.current.srcObject = finalStream;
                finalVideoRef.current.play();
            });
        };

        const startCompositing = (aStream, bStream) => {
            const canvas = compositeCanvasRef.current;
            const ctx = canvas.getContext("2d");

            const aVideo = document.createElement("video");
            aVideo.srcObject = aStream;
            aVideo.play();

            const bVideo = document.createElement("video");
            bVideo.srcObject = bStream;
            bVideo.play();

            const draw = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(aVideo, 0, 0, canvas.width, canvas.height);
                ctx.drawImage(bVideo, 0, 0, canvas.width, canvas.height);
                animationFrame = requestAnimationFrame(draw);
            };

            draw();
        };

        setup();

        return () => {
            cancelAnimationFrame(animationFrame);
            if (peer) peer.destroy();
            if (localStream) localStream.getTracks().forEach((track) => track.stop());
        };
    }, [roomId]);

    const isPersonA = !roomId;

    return (
        <div className="p-6 space-y-4 text-center">
            <h2 className="text-xl font-bold">{isPersonA ? "Person A (Room Creator)" : "Person B (Joiner)"}</h2>

            {isPersonA && peerId && (
                <div className="p-2 bg-blue-100 rounded">
                    Share this link:{" "}
                    <code className="bg-white p-1 rounded">
                        {`${window.location.origin}/room/${peerId}`}
                    </code>
                </div>
            )}

            <div className="flex justify-center space-x-4">
                {isPersonA ? (
                    <canvas ref={compositeCanvasRef} width={640} height={480} className="border" />
                ) : (
                    <video ref={finalVideoRef} autoPlay playsInline width={640} height={480} className="border" />
                )}
            </div>

            {/* Hidden working elements */}
            <div className="hidden">
                <video ref={localVideoRef} muted playsInline />
                <video ref={remoteVideoRef} playsInline />
                <canvas ref={segmentationCanvasRef} width={640} height={480} />
            </div>
        </div>
    );
}
