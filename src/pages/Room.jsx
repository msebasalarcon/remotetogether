import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import { Camera } from "@mediapipe/camera_utils";

export default function Room() {
    const { roomId } = useParams();
    const [peerId, setPeerId] = useState(null);
    const [isRoomCreator, setIsRoomCreator] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const segmentedVideoRef = useRef(null); // for segmented person B video
    const finalCanvasRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const localFrame = useRef({ image: null, mask: null });

    useEffect(() => {
        const draw = () => {
            const ctx = finalCanvasRef.current?.getContext("2d");
            const localVideo = localVideoRef.current;
            const remoteVideo = remoteVideoRef.current;

            if (!ctx) return;

            ctx.clearRect(0, 0, 640, 480);

            const backgroundVideo = isRoomCreator ? localVideo : remoteVideo;
            const personBVideo = isRoomCreator ? remoteVideo : segmentedVideoRef.current;

            if (backgroundVideo?.readyState >= 2) {
                ctx.drawImage(backgroundVideo, 0, 0, 640, 480);
            }

            if (isRoomCreator && personBVideo?.readyState >= 2) {
                ctx.drawImage(personBVideo, 0, 0, 640, 480);
            }

            if (!isRoomCreator) {
                const { image, mask } = localFrame.current;
                if (image && mask) {
                    const bCtx = segmentationCanvasRef.current?.getContext("2d");
                    if (bCtx) {
                        bCtx.clearRect(0, 0, 640, 480);
                        bCtx.drawImage(mask, 0, 0, 640, 480);
                        bCtx.globalCompositeOperation = "source-in";
                        bCtx.drawImage(image, 0, 0, 640, 480);
                        bCtx.globalCompositeOperation = "source-over";
                    }
                }
            }

            requestAnimationFrame(draw);
        };

        const startSegmentation = async (video) => {
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

            const camera = new Camera(video, {
                onFrame: async () => {
                    await segmentation.send({ image: video });
                },
                width: 640,
                height: 480,
            });

            camera.start();
        };

        const init = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });

            localVideoRef.current.srcObject = stream;
            await localVideoRef.current.play();

            const peer = new Peer();

            peer.on("open", async (id) => {
                const creator = !roomId;
                setIsRoomCreator(creator);

                if (creator) {
                    setPeerId(id);
                } else {
                    // Person B starts segmentation and sends only segmented video
                    await startSegmentation(localVideoRef.current);
                    const processedStream = segmentationCanvasRef.current.captureStream(25);
                    const call = peer.call(roomId, processedStream);
                    call.on("stream", (remoteStream) => {
                        remoteVideoRef.current.srcObject = remoteStream;
                        remoteVideoRef.current.play();
                    });
                }
            });

            peer.on("call", (call) => {
                if (isRoomCreator) {
                    // A receives segmented person B stream
                    call.answer(localVideoRef.current.srcObject);
                    call.on("stream", (segmentedStream) => {
                        segmentedVideoRef.current.srcObject = segmentedStream;
                        segmentedVideoRef.current.play();
                    });

                    // After receiving B's stream, send composite back
                    const compositeStream = finalCanvasRef.current.captureStream(25);
                    const returnCall = peer.call(call.peer, compositeStream);
                } else {
                    // B receives final composited stream from A
                    call.answer();
                    call.on("stream", (compositeStream) => {
                        remoteVideoRef.current.srcObject = compositeStream;
                        remoteVideoRef.current.play();
                    });
                }
            });

            draw();
        };

        init();
    }, [roomId]);

    return (
        <div className="flex flex-col items-center space-y-4 p-6">
            <h1 className="text-2xl font-bold">
                {isRoomCreator ? "🅰️ Person A (Compositor)" : "🅱️ Person B (Segmented)"}
            </h1>

            {isRoomCreator && peerId && (
                <div className="text-sm text-blue-600">
                    Share this link: <code>{`${window.location.origin}/room/${peerId}`}</code>
                </div>
            )}

            <canvas
                ref={finalCanvasRef}
                width="640"
                height="480"
                className="border rounded shadow"
            />

            {/* Hidden */}
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
            <video ref={segmentedVideoRef} autoPlay playsInline muted className="hidden" />
            <canvas
                ref={segmentationCanvasRef}
                width="640"
                height="480"
                className="hidden"
            />
        </div>
    );
}
