// RoomA.jsx
import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as bodyPix from '@tensorflow-models/body-pix';

// Ensure TensorFlow.js is properly initialized
tf.setBackend('webgl');
tf.ready().then(() => console.log('TensorFlow.js initialized'));

// WebGL shaders for depth-aware compositing
const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_texCoord = vec2(1.0 - a_texCoord.x, a_texCoord.y);
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_personA;
    uniform sampler2D u_personB;
    uniform sampler2D u_depthA;
    uniform float u_threshold;
    
    void main() {
        vec4 colorA = texture2D(u_personA, v_texCoord);
        vec4 colorB = texture2D(u_personB, v_texCoord);
        float depthA = texture2D(u_depthA, v_texCoord).r;
        
        // If person B has alpha (background removed) and person A has a person detected
        if (colorB.a > 0.1 && depthA < 0.1) {
            gl_FragColor = colorB;
        } else {
            gl_FragColor = colorA;
        }
    }
`;

// Initialize TensorFlow.js asynchronously
async function initializeTensorFlow() {
    try {
        await tf.setBackend('webgl');
        await tf.ready();
        console.log('TensorFlow.js initialized with backend:', tf.getBackend());
        // Test WebGL context
        const testTensor = tf.tensor([1, 2, 3]);
        testTensor.dispose();
        return true;
    } catch (err) {
        console.error('TensorFlow.js initialization failed:', err);
        return false;
    }
}

export default function RoomA() {
    const [peerId, setPeerId] = useState(null);
    const [error, setError] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    
    // Video refs
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    
    // Canvas refs
    const depthCanvasRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    
    // WebGL context and program refs
    const glRef = useRef(null);
    const programRef = useRef(null);
    
    // Other refs
    const peer = useRef(null);
    const bodyPixModel = useRef(null);
    const mediaStream = useRef(null);
    const animationFrameRef = useRef(null);

    useEffect(() => {
        let isMounted = true;

        async function initialize() {
            try {
                console.log('Starting initialization...');
                
                // Initialize TensorFlow.js
                const tfInitialized = await initializeTensorFlow();
                if (!tfInitialized) {
                    throw new Error('TensorFlow.js initialization failed');
                }
                console.log('TensorFlow.js initialized successfully');

                // Request camera access first
                console.log('Requesting camera access...');
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 640,
                        height: 480,
                        aspectRatio: 4/3,
                        frameRate: 30
                    }
                });
                console.log('Camera access granted');

                if (!isMounted) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                mediaStream.current = stream;
                
                // Set up video element
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                    console.log('Waiting for video to be ready...');
                    
                    // Wait for video to be ready
                    await new Promise((resolve) => {
                        const videoElement = localVideoRef.current;
                        videoElement.onloadedmetadata = () => {
                            console.log('Video metadata loaded');
                            videoElement.oncanplay = () => {
                                console.log('Video can play');
                                resolve();
                            };
                        };
                    });
                    
                    // Ensure video playback starts
                    try {
                        await localVideoRef.current.play();
                        console.log('Video playback started');
                    } catch (playError) {
                        console.warn('Video play failed, retrying:', playError);
                        // Add a small delay and try again
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await localVideoRef.current.play();
                        console.log('Video playback started (retry)');
                    }
                }

                // Initialize WebGL for compositing
                console.log('Initializing WebGL...');
                await initializeWebGL();
                console.log('WebGL initialized');

                // Load BodyPix model with retries
                console.log('Loading BodyPix model...');
                let retries = 3;
                while (retries > 0) {
                    try {
                        bodyPixModel.current = await bodyPix.load({
                            architecture: 'MobileNetV1',
                            outputStride: 16,
                            multiplier: 0.75,
                            quantBytes: 2
                        });
                        console.log('BodyPix model loaded successfully');
                        break;
                    } catch (err) {
                        retries--;
                        console.warn(`BodyPix load attempt failed, ${retries} retries left:`, err);
                        if (retries === 0) throw err;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                if (!isMounted) return;

                // Mark as initialized and start processing
                console.log('Starting frame processing...');
                setIsInitialized(true);
                setIsProcessing(true);

                // Initialize PeerJS
                console.log('Initializing PeerJS...');
                initializePeerConnection();

            } catch (err) {
                console.error("Initialization error:", err);
                if (isMounted) {
                    setError("Failed to initialize: " + (err.message || 'Unknown error'));
                    // Clean up any partial initialization
                    if (mediaStream.current) {
                        mediaStream.current.getTracks().forEach(track => track.stop());
                    }
                }
            }
        }

        initialize();

        return () => {
            console.log('Cleaning up...');
            isMounted = false;
            if (mediaStream.current) {
                mediaStream.current.getTracks().forEach(track => track.stop());
            }
            if (peer.current) {
                peer.current.destroy();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (glRef.current) {
                const gl = glRef.current;
                if (programRef.current) {
                    gl.deleteProgram(programRef.current);
                }
            }
        };
    }, []);

    // Start frame processing when initialization is complete
    useEffect(() => {
        if (isInitialized && isProcessing) {
            console.log('Starting frame processing loop');
            processFrames();
        }
    }, [isInitialized, isProcessing]);

    const initializeWebGL = async () => {
        const canvas = compositeCanvasRef.current;
        canvas.width = 640;
        canvas.height = 480;
        
        const gl = canvas.getContext('webgl2', { 
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        
        console.log('WebGL context initialized');
        glRef.current = gl;

        // Set viewport
        gl.viewport(0, 0, canvas.width, canvas.height);

        // Create shader program
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        const program = createProgram(gl, vertexShader, fragmentShader);
        programRef.current = program;

        // Set up attributes and uniforms
        setupWebGLBuffers(gl, program);

        // Clear canvas with a transparent background
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    };

    const createShader = (gl, type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
        }
        return shader;
    };

    const createProgram = (gl, vertexShader, fragmentShader) => {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
        }
        return program;
    };

    const setupWebGLBuffers = (gl, program) => {
        // Create a buffer for the position (vertices)
        const positionBuffer = gl.createBuffer();
        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
             1.0,  1.0,
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        // Create a buffer for the texture coordinates (flipped horizontally)
        const texCoordBuffer = gl.createBuffer();
        const texCoords = new Float32Array([
            1.0, 0.0,  // flip horizontally by swapping x coordinates
            0.0, 0.0,
            1.0, 1.0,
            0.0, 1.0,
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        // Set up attributes
        const positionLocation = gl.getAttribLocation(program, "a_position");
        const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
    };

    const processFrames = async () => {
        if (!localVideoRef.current) {
            console.warn('Video element not ready');
            animationFrameRef.current = requestAnimationFrame(processFrames);
            return;
        }
        if (!bodyPixModel.current) {
            console.warn('BodyPix model not ready');
            animationFrameRef.current = requestAnimationFrame(processFrames);
            return;
        }
        if (!isProcessing || !isInitialized) {
            console.warn('Processing not started or not initialized');
            animationFrameRef.current = requestAnimationFrame(processFrames);
            return;
        }

        try {
            // Get person segmentation
            const segmentation = await bodyPixModel.current.segmentPerson(localVideoRef.current, {
                flipHorizontal: false,
                internalResolution: 'medium',
                segmentationThreshold: 0.7,
                maxDetections: 1
            });
            
            if (!segmentation) {
                console.warn('No segmentation result');
                animationFrameRef.current = requestAnimationFrame(processFrames);
                return;
            }

            // Convert to image data
            const depthCanvas = depthCanvasRef.current;
            if (!depthCanvas) {
                console.warn('Depth canvas not found');
                animationFrameRef.current = requestAnimationFrame(processFrames);
                return;
            }

            const depthCtx = depthCanvas.getContext('2d', {
                willReadFrequently: true,
                alpha: true
            });

            // Ensure canvas dimensions match video
            depthCanvas.width = 640;
            depthCanvas.height = 480;

            const imageData = depthCtx.createImageData(depthCanvas.width, depthCanvas.height);
            
            // Convert segmentation mask to grayscale
            const data = imageData.data;
            for (let i = 0; i < segmentation.data.length; i++) {
                const j = i * 4;
                const value = segmentation.data[i] ? 255 : 0;
                data[j] = value;     // R
                data[j + 1] = value; // G
                data[j + 2] = value; // B
                data[j + 3] = 255;   // A
            }
            
            depthCtx.putImageData(imageData, 0, 0);
            
            // Debug: draw a test pattern
            depthCtx.fillStyle = 'red';
            depthCtx.fillRect(0, 0, 100, 100);
            
            // Composite the frames with WebGL
            compositeFrames();
            
        } catch (err) {
            console.error("Frame processing error:", err);
        }

        animationFrameRef.current = requestAnimationFrame(processFrames);
    };

    const compositeFrames = () => {
        if (!glRef.current || !programRef.current) {
            console.warn('WebGL context or program not initialized');
            return;
        }

        const gl = glRef.current;
        const program = programRef.current;

        // Clear canvas
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);

        try {
            // Create and bind textures
            if (localVideoRef.current && localVideoRef.current.readyState >= 2) {
                createAndBindTexture(gl, 0, "u_personA", localVideoRef.current);
            }
            
            if (remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                createAndBindTexture(gl, 1, "u_personB", remoteVideoRef.current);
            }
            
            if (depthCanvasRef.current) {
                createAndBindTexture(gl, 2, "u_depthA", depthCanvasRef.current);
            }

            // Set depth threshold uniform
            const thresholdLocation = gl.getUniformLocation(program, "u_threshold");
            gl.uniform1f(thresholdLocation, 0.5);

            // Draw
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Check for WebGL errors
            const error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('WebGL error:', error);
            }
        } catch (err) {
            console.error('Error in compositeFrames:', err);
        }
    };

    const createAndBindTexture = (gl, unit, uniformName, source) => {
        if (!source) {
            console.warn(`Source for ${uniformName} is null`);
            return;
        }

        gl.activeTexture(gl.TEXTURE0 + unit);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        try {
            // Upload the image into the texture
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } catch (err) {
            console.error(`Error uploading texture for ${uniformName}:`, err);
        }

        // Set the uniform
        const location = gl.getUniformLocation(programRef.current, uniformName);
        if (location === null) {
            console.warn(`Uniform ${uniformName} not found`);
        } else {
            gl.uniform1i(location, unit);
        }
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

        peer.current.on('open', (id) => {
            setPeerId(id);
            console.log('Connected to signaling server');
        });

        peer.current.on('call', (call) => {
            // Answer with composite stream
            const compositeStream = compositeCanvasRef.current.captureStream(30);
            call.answer(compositeStream);

            // Handle incoming stream (Person B's segmented video)
            call.on('stream', (remoteStream) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play().catch(console.error);
                }
            });

            call.on('error', (err) => {
                console.error('Call error:', err);
                setError('Call error: ' + err.message);
            });
        });

        peer.current.on('error', (err) => {
            console.error('PeerJS error:', err);
            setError('Connection error: ' + err.message);
        });
    };

    return (
        <div className="p-6 bg-gray-100 min-h-screen">
            <h2 className="text-2xl font-bold mb-6">Person A (Room Creator)</h2>
            
            {error && (
                <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            {peerId && (
                <div className="mb-4 p-4 bg-blue-100 text-blue-700 rounded-lg">
                    Share this link: <code className="px-2 py-1 bg-blue-50 rounded">{`${window.location.origin}/room/${peerId}`}</code>
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
                                Initializing...
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold mb-2">Composite View</h3>
                    <canvas
                        ref={compositeCanvasRef}
                        width={640}
                        height={480}
                        className="w-full rounded-lg shadow-lg"
                    />
                </div>
            </div>

            {/* Debug view */}
            <div className="mt-6">
                <h3 className="text-lg font-semibold mb-2">Debug View (Depth Map)</h3>
                <canvas
                    ref={depthCanvasRef}
                    width={640}
                    height={480}
                    className="w-full rounded-lg shadow-lg"
                />
            </div>

            {/* Hidden elements */}
            <div className="hidden">
                <video ref={remoteVideoRef} playsInline autoPlay />
            </div>
        </div>
    );
}
