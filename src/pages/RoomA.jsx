// RoomA.jsx
import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

// Silence MediaPipe logging
const originalConsoleLog = console.log;
console.log = (...args) => {
    if (args[0]?.includes?.('selfie_segmentation_solution_simd_wasm_bin.js')) return;
    originalConsoleLog(...args);
};

export default function RoomA() {
    const [peerId, setPeerId] = useState(null);
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const remoteCanvasRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    const localSegmentationCanvasRef = useRef(null);
    const backgroundOnlyCanvasRef = useRef(null);
    const peer = useRef(null);
    const segmentor = useRef(null);
    const animationFrameRef = useRef(null);
    let segmentationFrame = null;

    // Performance-optimized segmentation settings
    const segmentationSettings = {
        modelSelection: 1, // Landscape model for better quality
        threshold: 0.75, // Optimized threshold
        temporalSmoothing: true,
        smoothingStrength: 0.6
    };

    // Face measurements for both persons - using useState for real-time updates
    const [faceMeasurements, setFaceMeasurements] = useState({
        personA: { faceWidth: 0, depthEstimate: 1 },
        personB: { faceWidth: 0, depthEstimate: 1 }
    });

    // Temporal smoothing for Person A
    const maskHistoryA = useRef([]);
    const maxHistoryFrames = 2;
    let frameCount = 0;

    // Initialize MediaPipe segmentation for Person A
    const initializeSegmentation = async () => {
        try {
            segmentor.current = new SelfieSegmentation({
                locateFile: (file) => 
                    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
            });

            await segmentor.current.setOptions({
                modelSelection: segmentationSettings.modelSelection,
                selfieMode: true
            });

            segmentor.current.onResults(processPersonASegmentation);
            console.log('Person A segmentation initialized');
        } catch (err) {
            console.error('Failed to initialize Person A segmentation:', err);
        }
    };

    // Calculate face measurements for Person A
    const calculatePersonAMeasurements = (imageData) => {
        // Skip expensive calculations most of the time
        if (frameCount % 15 !== 0) return faceMeasurements.personA;
        
        let left = imageData.width;
        let right = 0;
        let top = imageData.height;
        let bottom = 0;
        
        // Sample every 4th pixel for performance
        for (let y = 0; y < imageData.height; y += 4) {
            for (let x = 0; x < imageData.width; x += 4) {
                const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
                if (alpha > 128) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        }

        const faceWidth = right - left;
        const faceSizeRatio = faceWidth / imageData.width;
        const depthEstimate = 1 / Math.max(faceSizeRatio, 0.1);

        const newMeasurements = {
            faceWidth,
            depthEstimate
        };

        // Update state to trigger re-render
        setFaceMeasurements(prev => ({
            ...prev,
            personA: newMeasurements
        }));

        return newMeasurements;
    };

    // Temporal smoothing for Person A mask
    const applyTemporalSmoothingA = (currentMask) => {
        if (!segmentationSettings.temporalSmoothing) return currentMask;

        maskHistoryA.current.push(currentMask);
        
        if (maskHistoryA.current.length > maxHistoryFrames) {
            maskHistoryA.current.shift();
        }

        if (maskHistoryA.current.length < 2) return currentMask;

        const smoothedMask = new ImageData(
            new Uint8ClampedArray(currentMask.data),
            currentMask.width,
            currentMask.height
        );

        const alpha = segmentationSettings.smoothingStrength;
        const prevMask = maskHistoryA.current[maskHistoryA.current.length - 2];

        // Only smooth alpha channel for performance
        for (let i = 3; i < currentMask.data.length; i += 4) {
            smoothedMask.data[i] = alpha * currentMask.data[i] + 
                                   (1 - alpha) * prevMask.data[i];
        }

        return smoothedMask;
    };

    // Process Person A segmentation results
    const processPersonASegmentation = (results) => {
        if (!results.segmentationMask || !results.image) return;

        const canvas = localSegmentationCanvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
        });

        try {
            frameCount++;
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw segmentation mask (no mirroring needed - MediaPipe handles orientation)
            ctx.save();
            ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
            
            // Get mask data and process
            let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Fast threshold processing
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i];
                
                if (alpha > segmentationSettings.threshold * 255) {
                    data[i + 3] = 255; // Fully visible
                } else if (alpha > (segmentationSettings.threshold * 0.3) * 255) {
                    const edgeStrength = (alpha - segmentationSettings.threshold * 0.3 * 255) / 
                                       (segmentationSettings.threshold * 0.7 * 255);
                    data[i + 3] = Math.floor(edgeStrength * 255);
                } else {
                    data[i + 3] = 0; // Fully transparent
                }
            }
            
            imageData = new ImageData(data, canvas.width, canvas.height);
            
            // Apply temporal smoothing
            imageData = applyTemporalSmoothingA(imageData);
            
            // Calculate Person A measurements
            calculatePersonAMeasurements(imageData);
            
            // Store the mask for compositing
            ctx.putImageData(imageData, 0, 0);
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            ctx.restore();

        } catch (err) {
            console.error('Error processing Person A segmentation:', err);
        }
    };

    // Start Person A segmentation loop
    const startPersonASegmentation = async () => {
        if (!localVideoRef.current || !segmentor.current) {
            segmentationFrame = requestAnimationFrame(startPersonASegmentation);
            return;
        }

        try {
            await segmentor.current.send({ image: localVideoRef.current });
        } catch (err) {
            console.error("Error in Person A segmentation:", err);
        }

        segmentationFrame = requestAnimationFrame(startPersonASegmentation);
    };

    // Extract Person B face measurements from received stream
    const extractPersonBMeasurements = (canvas) => {
        if (frameCount % 15 !== 0) return faceMeasurements.personB;

        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        let left = canvas.width;
        let right = 0;
        let top = canvas.height;
        let bottom = 0;
        
        // Sample every 4th pixel for performance
        for (let y = 0; y < canvas.height; y += 4) {
            for (let x = 0; x < canvas.width; x += 4) {
                const alpha = imageData.data[(y * canvas.width + x) * 4 + 3];
                if (alpha > 128) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        }

        const faceWidth = right - left;
        const faceSizeRatio = faceWidth / canvas.width;
        const depthEstimate = 1 / Math.max(faceSizeRatio, 0.1);

        const newMeasurements = {
            faceWidth,
            depthEstimate
        };

        // Update state to trigger re-render
        setFaceMeasurements(prev => ({
            ...prev,
            personB: newMeasurements
        }));

        return newMeasurements;
    };

    // Determine depth order based on face sizes
    const isPersonAInFront = () => {
        const personA = faceMeasurements.personA;
        const personB = faceMeasurements.personB;
        
        // If both have valid measurements, compare face widths
        if (personA.faceWidth > 0 && personB.faceWidth > 0) {
            return personA.faceWidth > personB.faceWidth;
        }
        
        // Default to Person A in front if no valid comparison
        return true;
    };

    // Function to render the remote video to canvas with transparency
    const renderRemoteVideo = () => {
        const canvas = remoteCanvasRef.current;
        const video = remoteVideoRef.current;

        if (!canvas || !video || video.readyState < 2) return;

        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: true
        });

        // Clear the canvas with a transparent background
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            // Draw the video frame first
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Get the image data to process transparency
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Convert background pixels to transparent
            // Use more conservative thresholds to avoid removing dark clothing
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Calculate luminance to detect dark/black background pixels
                const luminance = (r * 0.299 + g * 0.587 + b * 0.114);
                
                // More conservative thresholds to preserve dark clothing
                if (luminance < 8) {
                    data[i + 3] = 0; // Fully transparent (pure black background)
                } else if (luminance < 12) {
                    // Very narrow transition zone for pure background edges
                    const alpha = Math.floor((luminance - 8) / 4 * 255);
                    data[i + 3] = alpha;
                } else {
                    // Keep original alpha for everything else (including dark clothing)
                    data[i + 3] = 255;
                }
            }

            // Put the modified image data back
            ctx.putImageData(imageData, 0, 0);

            // Extract Person B measurements for depth comparison
            extractPersonBMeasurements(canvas);

        } catch (err) {
            console.error('Error drawing remote video to canvas:', err);
        }

        // Request next frame
        requestAnimationFrame(renderRemoteVideo);
    };

    // Extract and render background with Person A removed
    const renderBackgroundOnly = () => {
        const localVideo = localVideoRef.current;
        const localSegmentationCanvas = localSegmentationCanvasRef.current;
        const backgroundCanvas = backgroundOnlyCanvasRef.current;

        if (!backgroundCanvas || !localVideo || localVideo.readyState < 2) {
            requestAnimationFrame(renderBackgroundOnly);
            return;
        }

        const ctx = backgroundCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
        });

        // Clear the canvas
        ctx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);

        try {
            // Mirror the video to match segmentation orientation
            ctx.save();
            ctx.scale(-1, 1);
            ctx.translate(-backgroundCanvas.width, 0);
            
            // Draw Person A's full video (mirrored)
            ctx.drawImage(localVideo, 0, 0, backgroundCanvas.width, backgroundCanvas.height);
            
            ctx.restore();
            
            if (localSegmentationCanvas) {
                // Get the segmentation mask to remove Person A
                const segCtx = localSegmentationCanvas.getContext('2d');
                const segImageData = segCtx.getImageData(0, 0, localSegmentationCanvas.width, localSegmentationCanvas.height);
                const backgroundImageData = ctx.getImageData(0, 0, backgroundCanvas.width, backgroundCanvas.height);
                
                // Remove Person A from background using inverse mask
                for (let i = 0; i < segImageData.data.length; i += 4) {
                    const alpha = segImageData.data[i + 3];
                    if (alpha > 50) { // Where Person A is present
                        // Make these pixels more transparent to show background removal
                        const blendFactor = alpha / 255;
                        backgroundImageData.data[i] = backgroundImageData.data[i] * (1 - blendFactor * 0.9);
                        backgroundImageData.data[i + 1] = backgroundImageData.data[i + 1] * (1 - blendFactor * 0.9);
                        backgroundImageData.data[i + 2] = backgroundImageData.data[i + 2] * (1 - blendFactor * 0.9);
                        backgroundImageData.data[i + 3] = backgroundImageData.data[i + 3] * (1 - blendFactor * 0.7); // Make more transparent
                    }
                }
                
                // Put the background-only image back
                ctx.putImageData(backgroundImageData, 0, 0);
            }

        } catch (err) {
            console.error('Error extracting background:', err);
        }

        // Request next frame
        requestAnimationFrame(renderBackgroundOnly);
    };

    // Enhanced composite rendering with depth-aware layering
    const renderComposite = () => {
        const backgroundOnlyCanvas = backgroundOnlyCanvasRef.current;
        const localSegmentationCanvas = localSegmentationCanvasRef.current;
        const remoteCanvas = remoteCanvasRef.current;
        const compositeCanvas = compositeCanvasRef.current;

        if (!compositeCanvas) {
            animationFrameRef.current = requestAnimationFrame(renderComposite);
            return;
        }

        const ctx = compositeCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
        });

        // Clear the canvas
        ctx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);

        try {
            // Step 1: Draw the background (with Person A already removed)
            if (backgroundOnlyCanvas) {
                ctx.drawImage(backgroundOnlyCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
            }

            // Step 2: Determine depth order and composite segmented persons
            const personAInFront = isPersonAInFront();

            if (personAInFront) {
                // Person A is closer: Background -> Person B -> Person A
                
                // Draw Person B (behind Person A)
                if (remoteCanvas) {
                    ctx.drawImage(remoteCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
                }
                
                // Draw Person A segmented (in front)
                if (localSegmentationCanvas) {
                    ctx.drawImage(localSegmentationCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
                }
            } else {
                // Person B is closer: Background -> Person A -> Person B
                
                // Draw Person A segmented (behind Person B)
                if (localSegmentationCanvas) {
                    ctx.drawImage(localSegmentationCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
                }
                
                // Draw Person B (in front)
                if (remoteCanvas) {
                    ctx.drawImage(remoteCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
                }
            }

        } catch (err) {
            console.error('Error in composite rendering:', err);
        }

        animationFrameRef.current = requestAnimationFrame(renderComposite);
    };

    useEffect(() => {
        // Get local stream
        navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                aspectRatio: 4/3,
                frameRate: 30
            },
            audio: false
        }).then(async stream => {
            // Show local video
            localVideoRef.current.srcObject = stream;

            // Set up canvases
            const remoteCanvas = remoteCanvasRef.current;
            const compositeCanvas = compositeCanvasRef.current;
            const localSegmentationCanvas = localSegmentationCanvasRef.current;
            const backgroundOnlyCanvas = backgroundOnlyCanvasRef.current;
            
            remoteCanvas.width = 640;
            remoteCanvas.height = 480;
            compositeCanvas.width = 640;
            compositeCanvas.height = 480;
            localSegmentationCanvas.width = 640;
            localSegmentationCanvas.height = 480;
            backgroundOnlyCanvas.width = 640;
            backgroundOnlyCanvas.height = 480;

            // Initialize Person A segmentation
            await initializeSegmentation();

            // Wait for video to be ready before starting segmentation
            localVideoRef.current.onloadedmetadata = () => {
                setTimeout(() => {
                    startPersonASegmentation();
                    renderBackgroundOnly(); // Start background extraction loop
                }, 1000); // Give video time to stabilize
            };

            // Initialize peer
            peer.current = new Peer({
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            });

            // Handle peer open
            peer.current.on('open', id => {
                console.log('My peer ID:', id);
                setPeerId(id);
            });

            // Handle incoming calls
            peer.current.on('call', call => {
                console.log('Receiving call');
                
                // Answer call with our stream
                call.answer(stream);

                // Handle incoming stream
                call.on('stream', remoteStream => {
                    console.log('Received remote stream');
                    
                    const videoElement = remoteVideoRef.current;
                    if (!videoElement) return;

                    // Set up video
                    videoElement.srcObject = remoteStream;
                    videoElement.playsInline = true;
                    videoElement.autoplay = true;
                    
                    // Start playing the video
                    videoElement.play().then(() => {
                        console.log('Remote video playing');
                        setIsConnected(true);
                        
                        // Start all render loops
                        if (animationFrameRef.current) {
                            cancelAnimationFrame(animationFrameRef.current);
                        }
                        renderRemoteVideo();
                        renderBackgroundOnly();
                        renderComposite();
                    }).catch(err => {
                        console.error('Error playing remote video:', err);
                    });
                });

                // Monitor call connection
                call.peerConnection.onconnectionstatechange = () => {
                    const state = call.peerConnection.connectionState;
                    console.log('PeerConnection state:', state);
                    if (state === 'disconnected' || state === 'failed') {
                        // Stop render loops on disconnect
                        if (animationFrameRef.current) {
                            cancelAnimationFrame(animationFrameRef.current);
                        }
                    }
                };
            });

        }).catch(err => {
            console.error('Failed to get local stream:', err);
            setError(err.message);
        });

        // Cleanup
        return () => {
            if (peer.current) {
                peer.current.destroy();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (segmentationFrame) {
                cancelAnimationFrame(segmentationFrame);
            }
            if (segmentor.current) {
                segmentor.current.close();
            }
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = null;
            }
        };
    }, []);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Room A (Depth-Aware Host)</h1>
            
            {error && (
                <div className="bg-red-100 text-red-700 p-4 mb-4 rounded">
                    Error: {error}
                </div>
            )}

            {peerId && (
                <div className="bg-blue-100 text-blue-700 p-4 mb-4 rounded">
                    <div className="font-semibold">Room ID: {peerId}</div>
                    <div className="text-sm mt-1">Share this ID with Person B to connect</div>
                </div>
            )}

            {/* Depth Information Panel */}
            <div className="mb-4 p-4 bg-white rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-3">Depth Analysis (Real-time)</h3>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <h4 className="font-medium">Person A (You)</h4>
                        <div className="text-xs text-gray-600">
                            <div>Head Size: <span className="font-mono text-blue-600">{faceMeasurements.personA.faceWidth.toFixed(0)}px</span></div>
                            <div>Depth Ratio: <span className="font-mono text-blue-600">{faceMeasurements.personA.depthEstimate.toFixed(2)}</span></div>
                            <div className="text-xs text-gray-400 mt-1">
                                {faceMeasurements.personA.faceWidth > 0 ? 
                                    '✓ Detected' : '⏳ Calculating...'}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium">Person B (Remote)</h4>
                        <div className="text-xs text-gray-600">
                            <div>Head Size: <span className="font-mono text-green-600">{faceMeasurements.personB.faceWidth.toFixed(0)}px</span></div>
                            <div>Depth Ratio: <span className="font-mono text-green-600">{faceMeasurements.personB.depthEstimate.toFixed(2)}</span></div>
                            <div className="text-xs text-gray-400 mt-1">
                                {faceMeasurements.personB.faceWidth > 0 ? 
                                    '✓ Detected' : (isConnected ? '⏳ Calculating...' : '❌ Not Connected')}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium">Layer Order</h4>
                        <div className="text-xs">
                            {isPersonAInFront() ? (
                                <div className="text-blue-600">
                                    <div>🎭 <strong>Person A (Front)</strong></div>
                                    <div>👤 Person B (Behind)</div>
                                    <div>🏞️ Background</div>
                                    <div className="text-xs text-gray-400 mt-1">
                                        A: {faceMeasurements.personA.faceWidth}px &gt; B: {faceMeasurements.personB.faceWidth}px
                                    </div>
                                </div>
                            ) : (
                                <div className="text-green-600">
                                    <div>👤 <strong>Person B (Front)</strong></div>
                                    <div>🎭 Person A (Behind)</div>
                                    <div>🏞️ Background</div>
                                    <div className="text-xs text-gray-400 mt-1">
                                        B: {faceMeasurements.personB.faceWidth}px &gt; A: {faceMeasurements.personA.faceWidth}px
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* Real-time Measurements Update Indicator */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-500 flex items-center justify-between">
                        <span>
                            Measurements update: Every {frameCount % 15 === 0 ? '✓' : '⏳'} 15 frames
                        </span>
                        <span className="font-mono">
                            Frame: {frameCount}
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-5 gap-4">
                <div>
                    <h2 className="text-lg font-semibold mb-2">Your Camera</h2>
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full bg-black rounded"
                        style={{ transform: 'scaleX(-1)' }}
                    />
                </div>
                <div>
                    <h2 className="text-lg font-semibold mb-2">Your Segmentation</h2>
                    <canvas
                        ref={localSegmentationCanvasRef}
                        className="w-full rounded"
                        style={{
                            backgroundColor: '#f0f0f0',
                            backgroundImage: 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                            backgroundSize: '20px 20px',
                            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                        }}
                    />
                </div>
                <div>
                    <h2 className="text-lg font-semibold mb-2">Background Only</h2>
                    <canvas
                        ref={backgroundOnlyCanvasRef}
                        className="w-full rounded bg-black"
                    />
                </div>
                <div>
                    <h2 className="text-lg font-semibold mb-2">
                        Person B
                        {isConnected && <span className="text-green-500 ml-2">(Connected)</span>}
                    </h2>
                    {/* Hidden video element to receive the stream */}
                    <video
                        ref={remoteVideoRef}
                        playsInline
                        className="hidden"
                    />
                    {/* Canvas to display Person B with transparency */}
                    <canvas
                        ref={remoteCanvasRef}
                        className="w-full rounded"
                        style={{
                            backgroundColor: '#f0f0f0',
                            backgroundImage: 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                            backgroundSize: '20px 20px',
                            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                        }}
                    />
                </div>
                <div>
                    <h2 className="text-lg font-semibold mb-2">Depth-Aware Composite</h2>
                    <canvas
                        ref={compositeCanvasRef}
                        className="w-full rounded bg-black"
                    />
                </div>
            </div>
        </div>
    );
}
