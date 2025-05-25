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
    const [streamStatus, setStreamStatus] = useState({
        localStream: { ready: false, error: null },
        processedStream: { ready: false, error: null },
        peerConnection: { state: 'disconnected', error: null }
    });

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
                    modelSelection: 1, // Use the higher quality model
                    selfieMode: true
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
                            console.log('Local video metadata loaded');
                            setStreamStatus(prev => ({
                                ...prev,
                                localStream: { ready: true, error: null }
                            }));
                            videoElement.oncanplay = resolve;
                        };
                    });
                    
                    // Ensure video playback starts
                    try {
                        await localVideoRef.current.play();
                        console.log('Local video playback started');
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
                    setStreamStatus(prev => ({
                        ...prev,
                        localStream: { ready: false, error: err.message }
                    }));
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
            setStreamStatus(prev => ({
                ...prev,
                processedStream: { ready: false, error: 'No segmentation results' }
            }));
            return;
        }

        const canvas = segmentationCanvasRef.current;
        if (!canvas) {
            console.warn('Canvas not available');
            setStreamStatus(prev => ({
                ...prev,
                processedStream: { ready: false, error: 'Canvas not available' }
            }));
            return;
        }

        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: true
        });

        try {
            // Clear the canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the segmentation mask
            ctx.save();
            ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
            
            // Get the mask data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Process the mask to make it more binary with slight smoothing
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i];
                // Make the mask more decisive but keep some smoothing at the edges
                data[i + 3] = alpha > 128 ? 255 : alpha < 64 ? 0 : alpha * 2;
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            // Use the mask to clip the original image
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Create a stream from the canvas and display it locally
            const processedStream = canvas.captureStream(30);
            
            // Update processed stream status
            setStreamStatus(prev => ({
                ...prev,
                processedStream: { ready: true, error: null }
            }));

            if (processedVideoRef.current) {
                if (!processedVideoRef.current.srcObject) {
                    processedVideoRef.current.srcObject = processedStream;
                    processedVideoRef.current.play().catch(err => {
                        console.error('Error playing processed video:', err);
                        setStreamStatus(prev => ({
                            ...prev,
                            processedStream: { ready: false, error: err.message }
                        }));
                    });
                }
            }

            // Send to peer if connected
            if (peer.current && roomId) {
                sendStreamToPeer(processedStream);
            }
        } catch (err) {
            console.error('Error handling processed stream:', err);
            setStreamStatus(prev => ({
                ...prev,
                processedStream: { ready: false, error: err.message }
            }));
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
        if (peer.current) {
            peer.current.destroy();
        }

        peer.current = new Peer({
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            },
            debug: 3 // Enable detailed debugging
        });

        peer.current.on('open', () => {
            console.log('Connected to signaling server with ID:', peer.current.id);
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'connected', error: null }
            }));

            // Immediately try to connect to Person A
            if (roomId && mediaStream.current) {
                console.log('Attempting to call Person A at room:', roomId);
                // Get the processed stream from the canvas
                const processedStream = segmentationCanvasRef.current.captureStream(30);
                const call = peer.current.call(roomId, processedStream);
                setupCallHandlers(call);
            }
        });

        peer.current.on('error', (err) => {
            console.error('PeerJS error:', err);
            setError('Connection error: ' + err.message);
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'error', error: err.message }
            }));
        });

        peer.current.on('disconnected', () => {
            console.log('Disconnected from signaling server, attempting to reconnect...');
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'disconnected', error: null }
            }));
            // Try to reconnect
            peer.current.reconnect();
        });

        peer.current.on('close', () => {
            console.log('Call closed, attempting to reconnect...');
            // Try to reestablish the call
            if (roomId && segmentationCanvasRef.current) {
                const processedStream = segmentationCanvasRef.current.captureStream(30);
                const newCall = peer.current.call(roomId, processedStream);
                setupCallHandlers(newCall);
            }
        });
    };

    const setupCallHandlers = (call) => {
        call.on('stream', (remoteStream) => {
            console.log('Stream connection established with Person A');
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'streaming', error: null }
            }));
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            setError('Call error: ' + err.message);
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'error', error: err.message }
            }));
        });

        call.on('close', () => {
            console.log('Call closed, attempting to reconnect...');
            // Try to reestablish the call
            if (roomId && segmentationCanvasRef.current) {
                const processedStream = segmentationCanvasRef.current.captureStream(30);
                const newCall = peer.current.call(roomId, processedStream);
                setupCallHandlers(newCall);
            }
        });

        // Monitor connection state
        call.peerConnection.onconnectionstatechange = () => {
            const state = call.peerConnection.connectionState;
            console.log('PeerConnection state changed:', state);
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { 
                    state: state,
                    error: null 
                }
            }));

            // If connection fails, try to reconnect
            if (state === 'failed' || state === 'disconnected') {
                console.log('Connection lost, attempting to reconnect...');
                if (roomId && segmentationCanvasRef.current) {
                    const processedStream = segmentationCanvasRef.current.captureStream(30);
                    const newCall = peer.current.call(roomId, processedStream);
                    setupCallHandlers(newCall);
                }
            }
        };

        // Monitor ICE connection state
        call.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', call.peerConnection.iceConnectionState);
        };

        // Log ICE candidates
        call.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('New ICE candidate:', event.candidate.candidate);
            }
        };
    };

    const sendStreamToPeer = (processedStream) => {
        if (!roomId || !peer.current) {
            console.warn('Room ID or peer not available');
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'not ready', error: 'Room ID or peer not available' }
            }));
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
                    videoSender.replaceTrack(track).catch(err => {
                        console.error('Error replacing track:', err);
                        setStreamStatus(prev => ({
                            ...prev,
                            peerConnection: { state: 'error', error: 'Failed to update stream: ' + err.message }
                        }));
                    });
                }
            } else {
                // Create a new call
                console.log('Creating new call to Person A:', roomId);
                const call = peer.current.call(roomId, processedStream);
                setupCallHandlers(call);
            }
        } catch (err) {
            console.error('Error establishing call:', err);
            setError('Call error: ' + err.message);
            setStreamStatus(prev => ({
                ...prev,
                peerConnection: { state: 'error', error: err.message }
            }));
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

            {/* Debug Status Panel */}
            <div className="mt-6 p-4 bg-white rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-3">Debug Information</h3>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <h4 className="font-medium">Local Camera</h4>
                        <div className={`text-sm ${streamStatus.localStream.error ? 'text-red-600' : 'text-gray-600'}`}>
                            Status: {streamStatus.localStream.ready ? 'Ready' : 'Not Ready'}
                            {streamStatus.localStream.error && (
                                <div className="text-red-600">Error: {streamStatus.localStream.error}</div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium">Processed Stream</h4>
                        <div className={`text-sm ${streamStatus.processedStream.error ? 'text-red-600' : 'text-gray-600'}`}>
                            Status: {streamStatus.processedStream.ready ? 'Ready' : 'Not Ready'}
                            {streamStatus.processedStream.error && (
                                <div className="text-red-600">Error: {streamStatus.processedStream.error}</div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium">Peer Connection</h4>
                        <div className={`text-sm ${streamStatus.peerConnection.error ? 'text-red-600' : 'text-gray-600'}`}>
                            Status: {streamStatus.peerConnection.state}
                            {streamStatus.peerConnection.error && (
                                <div className="text-red-600">Error: {streamStatus.peerConnection.error}</div>
                            )}
                        </div>
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
