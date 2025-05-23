// RoomB.jsx
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

// Silence MediaPipe logging
const originalConsoleLog = console.log;
console.log = (...args) => {
    if (args[0]?.includes?.('selfie_segmentation_solution_simd_wasm_bin.js')) return;
    originalConsoleLog(...args);
};

export default function RoomB() {
    const { roomId } = useParams();
    const [error, setError] = useState(null);
    const localVideoRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const finalVideoRef = useRef(null);
    const peer = useRef(null);
    const segmentor = useRef(null);
    const connectionActive = useRef(false);
    let animationFrame;

    useEffect(() => {
        // Initialize canvas with proper dimensions
        const canvas = segmentationCanvasRef.current;
        canvas.width = 640;
        canvas.height = 480;

        const initializeConnection = async () => {
            try {
                peer.current = new Peer({
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:global.stun.twilio.com:3478' }
                        ]
                    }
                });

                peer.current.on("open", async () => {
                    connectionActive.current = true;
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ 
                            video: { 
                                width: 640,
                                height: 480,
                                aspectRatio: 4/3
                            } 
                        });

                        if (!connectionActive.current) return;

                        localVideoRef.current.srcObject = stream;
                        await localVideoRef.current.play();
                        
                        // Initialize segmentation after video is ready
                        segmentor.current = new SelfieSegmentation({
                            locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                        });
                        
                        segmentor.current.setOptions({ 
                            modelSelection: 1,
                            selfieMode: true
                        });
                        
                        segmentor.current.onResults(results => {
                            if (!results.segmentationMask || !connectionActive.current) return;
                            
                            const ctx = canvas.getContext("2d");
                            ctx.save();
                            
                            // Clear previous frame
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            
                            // Draw the segmentation mask
                            ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
                            
                            // Only keep the foreground
                            ctx.globalCompositeOperation = "source-in";
                            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
                            
                            ctx.restore();
                        });

                        await segmentor.current.initialize();
                        
                        if (!connectionActive.current) return;

                        const process = async () => {
                            if (!connectionActive.current) return;
                            
                            if (localVideoRef.current?.readyState === 4) {
                                try {
                                    await segmentor.current.send({ 
                                        image: localVideoRef.current 
                                    });
                                } catch (err) {
                                    console.error("Error processing frame:", err);
                                }
                            }
                            if (connectionActive.current) {
                                animationFrame = requestAnimationFrame(process);
                            }
                        };
                        process();

                        // Call peer with segmented video stream
                        if (connectionActive.current) {
                            const call = peer.current.call(roomId, canvas.captureStream(30));
                            call.on("stream", compositeStream => {
                                if (finalVideoRef.current && connectionActive.current) {
                                    finalVideoRef.current.srcObject = compositeStream;
                                    finalVideoRef.current.play().catch(err => {
                                        console.error("Error playing composite stream:", err);
                                        setError("Error playing composite stream: " + err.message);
                                    });
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
                        }
                    } catch (err) {
                        console.error("Error setting up media:", err);
                        setError("Error setting up media: " + err.message);
                        connectionActive.current = false;
                    }
                });

                peer.current.on("error", err => {
                    console.error("Peer error:", err);
                    setError("Connection error: " + err.message);
                    connectionActive.current = false;
                });

                peer.current.on("disconnected", () => {
                    console.log("Peer disconnected");
                    connectionActive.current = false;
                    // Try to reconnect
                    peer.current?.reconnect();
                });

            } catch (err) {
                console.error("Initialization error:", err);
                setError("Initialization error: " + err.message);
                connectionActive.current = false;
            }
        };

        initializeConnection().catch(err => {
            console.error("Failed to initialize:", err);
            setError("Failed to initialize: " + err.message);
        });

        return () => {
            connectionActive.current = false;
            if (peer.current) {
                peer.current.destroy();
            }
            if (localVideoRef.current?.srcObject) {
                localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
            cancelAnimationFrame(animationFrame);
            segmentor.current?.close();
        };
    }, [roomId]);

    return (
        <div className="p-6 text-center">
            <h2 className="text-xl font-bold mb-4">Person B (Joiner)</h2>
            {error && (
                <div className="p-2 mb-4 bg-red-100 text-red-700 rounded">
                    {error}
                </div>
            )}
            <div className="flex justify-center gap-4">
                <div className="w-1/2">
                    <h3 className="text-lg font-semibold mb-2">Composite View</h3>
                    <video 
                        ref={finalVideoRef} 
                        autoPlay 
                        playsInline 
                        width={640} 
                        height={480} 
                        className="border" 
                    />
                </div>
            </div>
            <video 
                ref={localVideoRef} 
                muted 
                playsInline 
                width={640} 
                height={480}
                className="hidden" 
            />
            <canvas 
                ref={segmentationCanvasRef} 
                width={640} 
                height={480} 
                className="hidden" 
            />
        </div>
    );
}
