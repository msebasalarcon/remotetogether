// RoomA.jsx
import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";

export default function RoomA() {
    const [peerId, setPeerId] = useState(null);
    const [error, setError] = useState(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    const peer = useRef(null);
    const localStream = useRef(null);
    const connectionActive = useRef(false);
    let animationFrame;

    useEffect(() => {
        // Initialize canvas
        const canvas = compositeCanvasRef.current;
        canvas.width = 640;
        canvas.height = 480;

        const initializePeerConnection = async () => {
            try {
                peer.current = new Peer({
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:global.stun.twilio.com:3478' }
                        ]
                    }
                });

                peer.current.on("open", id => {
                    setPeerId(id);
                    connectionActive.current = true;
                });

                peer.current.on("error", err => {
                    console.error("Peer connection error:", err);
                    setError("Connection error: " + err.message);
                    connectionActive.current = false;
                });

                peer.current.on("disconnected", () => {
                    console.log("Peer disconnected");
                    connectionActive.current = false;
                    // Try to reconnect
                    peer.current?.reconnect();
                });

                // Get local stream with specific dimensions
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        width: 640,
                        height: 480,
                        aspectRatio: 4/3
                    },
                    audio: false 
                });

                localStream.current = stream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                    await localVideoRef.current.play().catch(console.error);
                }

                peer.current.on("call", async call => {
                    try {
                        call.on("stream", bStream => {
                            if (remoteVideoRef.current && connectionActive.current) {
                                remoteVideoRef.current.srcObject = bStream;
                                remoteVideoRef.current.play().catch(console.error);
                                startCompositing(localStream.current, bStream);
                            }
                        });

                        call.on("error", err => {
                            console.error("Call error:", err);
                            setError("Call error: " + err.message);
                        });

                        call.on("close", () => {
                            console.log("Call closed");
                            connectionActive.current = false;
                        });

                        if (compositeCanvasRef.current && connectionActive.current) {
                            const compositeStream = compositeCanvasRef.current.captureStream(30);
                            call.answer(compositeStream);
                        }
                    } catch (err) {
                        console.error("Error handling call:", err);
                        setError("Error handling call: " + err.message);
                    }
                });
            } catch (err) {
                console.error("Initialization error:", err);
                setError("Initialization error: " + err.message);
            }
        };

        initializePeerConnection().catch(err => {
            console.error("Failed to initialize:", err);
            setError("Failed to initialize: " + err.message);
        });

        return () => {
            connectionActive.current = false;
            if (peer.current) {
                peer.current.destroy();
            }
            if (localStream.current) {
                localStream.current.getTracks().forEach(track => track.stop());
            }
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    const startCompositing = (aStream, bStream) => {
        if (!connectionActive.current) return;

        const canvas = compositeCanvasRef.current;
        canvas.style.backgroundColor = 'transparent';
        
        // Create context with alpha channel support
        const ctx = canvas.getContext("2d", {
            alpha: true
        });

        const aVideo = document.createElement("video");
        aVideo.srcObject = aStream;
        aVideo.muted = true;
        
        const bVideo = document.createElement("video");
        bVideo.srcObject = bStream;

        const startDrawing = () => {
            if (!connectionActive.current) return;

            const draw = () => {
                if (!connectionActive.current) return;

                // Clear with transparency
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw person A's video first
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(aVideo, 0, 0, canvas.width, canvas.height);
                
                // Draw person B's video with transparency
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(bVideo, 0, 0, canvas.width, canvas.height);
                
                if (connectionActive.current) {
                    animationFrame = requestAnimationFrame(draw);
                }
            };

            draw();
        };

        // Start drawing when both videos are ready
        Promise.all([
            new Promise(resolve => {
                aVideo.onloadedmetadata = () => {
                    aVideo.play().then(resolve).catch(console.error);
                };
            }),
            new Promise(resolve => {
                bVideo.onloadedmetadata = () => {
                    bVideo.play().then(resolve).catch(console.error);
                };
            })
        ]).then(startDrawing).catch(err => {
            console.error("Error starting video playback:", err);
            setError("Error starting video playback: " + err.message);
        });
    };

    return (
        <div className="p-6">
            <h2 className="text-xl font-bold mb-4">Person A (Room Creator)</h2>
            {error && (
                <div className="p-2 mb-4 bg-red-100 text-red-700 rounded">
                    {error}
                </div>
            )}
            {peerId && (
                <div className="p-2 bg-blue-100 rounded mb-4">
                    Share this link: <code>{`${window.location.origin}/room/${peerId}`}</code>
                </div>
            )}
            <div className="flex gap-4">
                <div className="w-1/2">
                    <h3 className="text-lg font-semibold mb-2">Person A (Original)</h3>
                    <video 
                        ref={localVideoRef} 
                        autoPlay 
                        playsInline 
                        width={640} 
                        height={480} 
                        className="border"
                    />
                </div>
                <div className="w-1/2">
                    <h3 className="text-lg font-semibold mb-2">Person B (No Background)</h3>
                    <video 
                        ref={remoteVideoRef} 
                        autoPlay 
                        playsInline 
                        width={640} 
                        height={480} 
                        className="border"
                        style={{ backgroundColor: 'transparent' }}
                    />
                </div>
            </div>
            <canvas 
                ref={compositeCanvasRef} 
                width={640} 
                height={480} 
                className="hidden"
                style={{ backgroundColor: 'transparent' }}
            />
        </div>
    );
}
