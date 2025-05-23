// RoomB.jsx
import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export default function RoomB() {
    const { roomId } = useParams();
    const localVideoRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const finalVideoRef = useRef(null);
    const peer = useRef(null);
    const segmentor = useRef(null);
    let animationFrame;

    useEffect(() => {
        peer.current = new Peer();
        peer.current.on("open", () => {
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.play();

                segmentor.current = new SelfieSegmentation({
                    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });
                segmentor.current.setOptions({ modelSelection: 1 });
                segmentor.current.initialize().then(() => {
                    segmentor.current.onResults(results => {
                        const ctx = segmentationCanvasRef.current.getContext("2d");
                        ctx.clearRect(0, 0, 640, 480);
                        ctx.drawImage(results.segmentationMask, 0, 0, 640, 480);
                        ctx.globalCompositeOperation = "source-in";
                        ctx.drawImage(localVideoRef.current, 0, 0, 640, 480);
                        ctx.globalCompositeOperation = "source-over";
                    });

                    const process = async () => {
                        await segmentor.current.send({ image: localVideoRef.current });
                        animationFrame = requestAnimationFrame(process);
                    };
                    process();

                    const call = peer.current.call(roomId, segmentationCanvasRef.current.captureStream(30));
                    call.on("stream", compositeStream => {
                        finalVideoRef.current.srcObject = compositeStream;
                        finalVideoRef.current.play();
                    });
                });
            });
        });

        return () => {
            peer.current.destroy();
            cancelAnimationFrame(animationFrame);
        };
    }, [roomId]);

    return (
        <div className="p-6 text-center">
            <h2 className="text-xl font-bold">Person B (Joiner)</h2>
            <video ref={finalVideoRef} autoPlay playsInline width={640} height={480} className="border" />
            <video ref={localVideoRef} muted playsInline className="hidden" />
            <canvas ref={segmentationCanvasRef} width={640} height={480} className="hidden" />
        </div>
    );
}
