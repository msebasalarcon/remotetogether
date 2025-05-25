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
    const [isProcessing, setIsProcessing] = useState(false);
    const localVideoRef = useRef(null);
    const processedVideoRef = useRef(null);
    const segmentationCanvasRef = useRef(null);
    const peer = useRef(null);
    const segmentor = useRef(null);
    const mediaStream = useRef(null);
    let animationFrame = null;

    useEffect(() => {
        let isMounted = true;

        async function initializeSegmentation() {
            try {
                // Set up the segmentation canvas
                const canvas = segmentationCanvasRef.current;
                canvas.width = 640;
                canvas.height = 480;

                // Initialize MediaPipe Selfie Segmentation
                segmentor.current = new SelfieSegmentation({
                    locateFile: (file) => 
                        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
                });

                // Configure segmentation
                await segmentor.current.setOptions({
                    modelSelection: 1, // 1 for better quality
                    selfieMode: true,
                });

                // Get camera stream
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 640,
                        height: 480,
                        aspectRatio: 4/3,
                        frameRate: 30
                    }
                });

                if (!isMounted) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                mediaStream.current = stream;
                
                // Set up video element
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                    // Wait for video to be ready
                    await new Promise((resolve) => {
                        const videoElement = localVideoRef.current;
                        videoElement.onloadedmetadata = () => {
                            videoElement.oncanplay = resolve;
                        };
                    });
                    
                    // Ensure video playback starts
                    try {
                        await localVideoRef.current.play();
                    } catch (playError) {
                        console.warn('Video play failed, retrying:', playError);
                        // Add a small delay and try again
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await localVideoRef.current.play();
                    }
                }

                // Process frames
                segmentor.current.onResults(processResults);

                // Start the segmentation loop
                await startSegmentation();
                if (isMounted) {
                    setIsProcessing(true);
                }

                // Initialize PeerJS connection
                initializePeerConnection();

            } catch (err) {
                console.error("Initialization error:", err);
                if (isMounted) {
                    setError("Failed to initialize: " + err.message);
                    // Clean up on error
                    if (mediaStream.current) {
                        mediaStream.current.getTracks().forEach(track => track.stop());
                    }
                }
            }
        }

        initializeSegmentation();

        return () => {
            isMounted = false;
            if (mediaStream.current) {
                mediaStream.current.getTracks().forEach(track => track.stop());
            }
            if (peer.current) {
                peer.current.destroy();
            }
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
            if (segmentor.current) {
                segmentor.current.close();
            }
        };
    }, [roomId]);

    const processResults = (results) => {
        if (!results.segmentationMask || !results.image) {
            console.warn('No segmentation results available');
            return;
        }

        const canvas = segmentationCanvasRef.current;
        if (!canvas) {
            console.warn('Canvas not available');
            return;
        }

        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: true,
            desynchronized: true
        });

        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the segmentation mask
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);

        // Use the mask to clip the original image
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

        // Create a stream from the canvas and display it locally
        try {
            const processedStream = canvas.captureStream(30);
            if (processedVideoRef.current) {
                if (!processedVideoRef.current.srcObject) {
                    processedVideoRef.current.srcObject = processedStream;
                    processedVideoRef.current.play().catch(err => {
                        console.error('Error playing processed video:', err);
                    });
                }
            }

            // Send to peer if connected
            if (peer.current && roomId) {
                sendStreamToPeer(processedStream);
            }
        } catch (err) {
            console.error('Error handling processed stream:', err);
        }
    };

    const startSegmentation = async () => {
        if (!localVideoRef.current || !segmentor.current) {
            console.warn('Video or segmentor not ready');
            return;
        }

        try {
            await segmentor.current.send({ image: localVideoRef.current });
        } catch (err) {
            console.error("Error in segmentation:", err);
        }

        animationFrame = requestAnimationFrame(startSegmentation);
    };

    const initializePeerConnection = () => {
        peer.current = new Peer({
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        peer.current.on('open', () => {
            console.log('Connected to signaling server');
        });

        peer.current.on('error', (err) => {
            console.error('PeerJS error:', err);
            setError('Connection error: ' + err.message);
        });
    };

    const sendStreamToPeer = (processedStream) => {
        if (!roomId || !peer.current) {
            console.warn('Room ID or peer not available');
            return;
        }

        try {
            // Check if we already have an active call
            const existingCall = peer.current.connections[roomId]?.[0];
            if (existingCall) {
                // Update the stream of the existing call
                const senders = existingCall.peerConnection.getSenders();
                const videoSender = senders.find(sender => sender.track?.kind === 'video');
                if (videoSender) {
                    const track = processedStream.getVideoTracks()[0];
                    videoSender.replaceTrack(track).catch(console.error);
                }
            } else {
                // Create a new call
                const call = peer.current.call(roomId, processedStream);
                
                call.on('stream', (remoteStream) => {
                    if (processedVideoRef.current) {
                        processedVideoRef.current.srcObject = remoteStream;
                        processedVideoRef.current.play().catch(console.error);
                    }
                });

                call.on('error', (err) => {
                    console.error('Call error:', err);
                    setError('Call error: ' + err.message);
                });
            }
        } catch (err) {
            console.error('Error establishing call:', err);
            setError('Call error: ' + err.message);
        }
    };

    return (
        <div className="p-6 bg-gray-100 min-h-screen">
            <h2 className="text-2xl font-bold mb-6">Person B (Background Removed)</h2>
            
            {error && (
                <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-6">
                <div>
                    <h3 className="text-lg font-semibold mb-2">Your Camera</h3>
                    <div className="relative">
                        <video
                            ref={localVideoRef}
                            className="w-full rounded-lg shadow-lg"
                            playsInline
                            muted
                            autoPlay
                        />
                        {!isProcessing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                                Initializing camera...
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold mb-2">Processed View (Background Removed)</h3>
                    <div className="relative">
                        <video
                            ref={processedVideoRef}
                            className="w-full rounded-lg shadow-lg"
                            playsInline
                            autoPlay
                        />
                        {!isProcessing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                                Processing video...
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Hidden canvas for segmentation */}
            <canvas
                ref={segmentationCanvasRef}
                className="hidden"
                width={640}
                height={480}
            />
        </div>
    );
}
