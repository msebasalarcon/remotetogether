// pages/Room.jsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import "@mediapipe/selfie_segmentation/selfie_segmentation";

export default function Room() {
    const { roomId } = useParams();
    const isRoomCreator = !roomId;
    const isPersonA = isRoomCreator; // Person A is the creator
    const isPersonB = !isRoomCreator; // Person B is the joiner

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const personACanvasRef = useRef(null);
    const personBCanvasRef = useRef(null);

    const [peerId, setPeerId] = useState(null);

    useEffect(() => {
        const drawCanvases = async () => {
            const canvasA = personACanvasRef.current;
            const canvasB = personBCanvasRef.current;

            const ctxA = canvasA.getContext("2d");
            const ctxB = canvasB.getContext("2d");

            // Always match Person A and Person B to the correct video sources
            // Person A is always the creator, Person B is always the joiner
            const personAVideo = isRoomCreator ? localVideoRef.current : remoteVideoRef.current;
            const personBVideo = isRoomCreator ? remoteVideoRef.current : localVideoRef.current;

            // Set up segmentation
            const segmentor = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            segmentor.setOptions({
                modelSelection: 1,
            });

            await segmentor.initialize();

            const offscreen = document.createElement("canvas");
            offscreen.width = 640;
            offscreen.height = 480;
            const offCtx = offscreen.getContext("2d");

            const drawLoop = async () => {
                // Draw Person A (full, no effects)
                if (personAVideo.readyState >= 2) {
                    ctxA.drawImage(personAVideo, 0, 0, canvasA.width, canvasA.height);
                }

                // Draw Person B with background removed (always)
                if (personBVideo.readyState >= 2) {
                    offCtx.drawImage(personBVideo, 0, 0, offscreen.width, offscreen.height);

                    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);

                    await segmentor.send({ image: offscreen });

                    segmentor.onResults((results) => {
                        ctxB.clearRect(0, 0, canvasB.width, canvasB.height);

                        if (results.segmentationMask) {
                            ctxB.save();
                            ctxB.drawImage(results.segmentationMask, 0, 0, canvasB.width, canvasB.height);

                            ctxB.globalCompositeOperation = "source-in";
                            ctxB.drawImage(personBVideo, 0, 0, canvasB.width, canvasB.height);

                            ctxB.restore();
                        }
                    });
                }

                requestAnimationFrame(drawLoop);
            };

            drawLoop();
        };

        const init = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            localVideoRef.current.srcObject = stream;
            await localVideoRef.current.play();

            const peer = new Peer();

            peer.on("open", (id) => {
                setPeerId(id);

                if (!roomId) return;

                const call = peer.call(roomId, stream);
                call.on("stream", async (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    await remoteVideoRef.current.play();
                    drawCanvases();
                });
            });

            peer.on("call", (call) => {
                call.answer(stream);
                call.on("stream", async (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    await remoteVideoRef.current.play();
                    drawCanvases();
                });
            });

            // If you're alone, start drawing yourself
            if (isRoomCreator && !roomId) {
                drawCanvases();
            }
        };

        init();
    }, [roomId]);

    return (
        <div className="flex flex-col items-center gap-4 p-6">
            <h2 className="text-2xl font-bold">{isRoomCreator ? "🅰 Person A (Creator)" : "🅱 Person B (Joiner)"}</h2>
            <p>Your Peer ID: <code>{peerId}</code></p>

            {isRoomCreator && peerId && (
                <p>
                    Share this link:{" "}
                    <code>{`${window.location.origin}/room/${peerId}`}</code>
                </p>
            )}

            <div className="flex gap-4">
                <div>
                    <h3 className="font-semibold text-center mb-2">🅰 Person A (Full)</h3>
                    <canvas ref={personACanvasRef} width={640} height={480} className="border shadow" />
                </div>
                <div>
                    <h3 className="font-semibold text-center mb-2">🅱 Person B (No Background)</h3>
                    <canvas ref={personBCanvasRef} width={640} height={480} className="border shadow" />
                </div>
            </div>

            <video ref={localVideoRef} muted playsInline className="hidden" />
            <video ref={remoteVideoRef} playsInline className="hidden" />
        </div>
    );
}