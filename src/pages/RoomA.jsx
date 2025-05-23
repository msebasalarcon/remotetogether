// RoomA.jsx
import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";

export default function RoomA() {
    const [peerId, setPeerId] = useState(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    const peer = useRef(null);
    const localStream = useRef(null);
    let animationFrame;

    useEffect(() => {
        peer.current = new Peer();
        peer.current.on("open", id => setPeerId(id));
        peer.current.on("error", console.error);

        navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(stream => {
            localStream.current = stream;
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.play();
        });

        peer.current.on("call", call => {
            call.on("stream", bStream => {
                remoteVideoRef.current.srcObject = bStream;
                remoteVideoRef.current.play();

                startCompositing(localStream.current, bStream);
                const compositeStream = compositeCanvasRef.current.captureStream(30);
                call.answer(compositeStream);
            });
        });

        return () => {
            peer.current.destroy();
            localStream.current?.getTracks().forEach(t => t.stop());
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    const startCompositing = (aStream, bStream) => {
        const canvas = compositeCanvasRef.current;
        const ctx = canvas.getContext("2d");

        const aVideo = document.createElement("video");
        aVideo.srcObject = aStream;
        aVideo.muted = true;
        aVideo.play();

        const bVideo = document.createElement("video");
        bVideo.srcObject = bStream;
        bVideo.play();

        let canvasWidth = 640;
        let canvasHeight = 480;

        aVideo.onloadedmetadata = bVideo.onloadedmetadata = () => {
            // Set canvas size based on the first video that loads
            if (!canvas.width) {
                canvasWidth = Math.min(aVideo.videoWidth, bVideo.videoWidth);
                canvasHeight = Math.min(aVideo.videoHeight, bVideo.videoHeight);
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
            }

            const draw = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw A video with alpha blending
                ctx.globalAlpha = 0.5;
                ctx.drawImage(aVideo, 0, 0, canvasWidth, canvasHeight);
                
                // Draw B video on top
                ctx.globalAlpha = 1.0;
                ctx.drawImage(bVideo, 0, 0, canvasWidth, canvasHeight);
                
                animationFrame = requestAnimationFrame(draw);
            };
            draw();
        };
    };

    return (
        <div className="p-6 text-center">
            <h2 className="text-xl font-bold">Person A (Room Creator)</h2>
            {peerId && (
                <div className="p-2 bg-blue-100 rounded">
                    Share this link: <code>{`${window.location.origin}/room/${peerId}`}</code>
                </div>
            )}
            <canvas ref={compositeCanvasRef} width={640} height={480} className="border" />
            <video ref={localVideoRef} className="hidden" />
            <video ref={remoteVideoRef} className="hidden" />
        </div>
    );
}
