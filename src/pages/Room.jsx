// pages/Room.jsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Peer from "peerjs";

export default function Room() {
    const { roomId } = useParams();
    const isRoomCreator = !roomId;

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const personACanvasRef = useRef(null);
    const personBCanvasRef = useRef(null);

    const [peerId, setPeerId] = useState(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const drawCanvas = () => {
            const personACanvas = personACanvasRef.current;
            const personBCanvas = personBCanvasRef.current;
            const personAStream = isRoomCreator ? localVideoRef.current : remoteVideoRef.current;
            const personBStream = isRoomCreator ? remoteVideoRef.current : localVideoRef.current;

            const ctxA = personACanvas?.getContext("2d");
            const ctxB = personBCanvas?.getContext("2d");

            if (personAStream && personAStream.readyState >= 2) {
                ctxA.clearRect(0, 0, personACanvas.width, personACanvas.height);
                ctxA.drawImage(personAStream, 0, 0, personACanvas.width, personACanvas.height);
            }

            if (personBStream && personBStream.readyState >= 2) {
                ctxB.clearRect(0, 0, personBCanvas.width, personBCanvas.height);
                ctxB.drawImage(personBStream, 0, 0, personBCanvas.width, personBCanvas.height);
            }

            requestAnimationFrame(drawCanvas);
        };

        const init = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            localVideoRef.current.srcObject = stream;
            await localVideoRef.current.play();

            const peer = new Peer();

            peer.on("open", (id) => {
                setPeerId(id);

                if (!roomId) return;

                // Joiner: Call roomId
                const call = peer.call(roomId, stream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    setConnected(true);
                });
            });

            peer.on("call", (call) => {
                call.answer(stream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                    setConnected(true);
                });
            });

            requestAnimationFrame(drawCanvas);
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
                    <h3 className="font-semibold text-center mb-2">🅱 Person B (Full)</h3>
                    <canvas ref={personBCanvasRef} width={640} height={480} className="border shadow" />
                </div>
            </div>

            <video ref={localVideoRef} muted playsInline className="hidden" />
            <video ref={remoteVideoRef} playsInline className="hidden" />
        </div>
    );
}
