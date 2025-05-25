// RoomA.jsx
import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";

export default function RoomA() {
    const [peerId, setPeerId] = useState(null);
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const remoteCanvasRef = useRef(null);
    const peer = useRef(null);
    const animationFrameRef = useRef(null);

    // Function to render the remote video to canvas with transparency
    const renderRemoteVideo = () => {
        const canvas = remoteCanvasRef.current;
        const video = remoteVideoRef.current;

        if (!canvas || !video) return;

        // Make sure video is actually playing and has valid dimensions
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            animationFrameRef.current = requestAnimationFrame(renderRemoteVideo);
            return;
        }

        const ctx = canvas.getContext('2d', {
            alpha: true,
            willReadFrequently: true,
            desynchronized: true
        });

        // Clear the canvas with a transparent background
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            // Draw the video frame
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Get the image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Convert black pixels to transparent
            // This assumes the background is pure black (RGB: 0,0,0)
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // If the pixel is black or very close to black
                if (r < 10 && g < 10 && b < 10) {
                    // Make it transparent
                    data[i + 3] = 0;
                }
            }

            // Put the modified image data back
            ctx.putImageData(imageData, 0, 0);
        } catch (err) {
            console.error('Error drawing video to canvas:', err);
        }

        // Continue the render loop
        animationFrameRef.current = requestAnimationFrame(renderRemoteVideo);
    };

    useEffect(() => {
        // Get local stream
        navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        }).then(stream => {
            // Show local video
            localVideoRef.current.srcObject = stream;

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

                    // Set up canvas first
                    const canvas = remoteCanvasRef.current;
                    canvas.width = 640;
                    canvas.height = 480;

                    // Then set up video
                    videoElement.srcObject = remoteStream;
                    videoElement.playsInline = true;
                    videoElement.autoplay = true;
                    
                    // Start playing the video
                    videoElement.play().then(() => {
                        console.log('Remote video playing');
                        setIsConnected(true);
                        // Start render loop only after play succeeds
                        renderRemoteVideo();
                    }).catch(err => {
                        console.error('Error playing remote video:', err);
                    });
                });

                // Monitor call connection
                call.peerConnection.onconnectionstatechange = () => {
                    const state = call.peerConnection.connectionState;
                    console.log('PeerConnection state:', state);
                    if (state === 'disconnected' || state === 'failed') {
                        // Stop render loop on disconnect
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
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = null;
            }
        };
    }, []);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Room A</h1>
            
            {error && (
                <div className="bg-red-100 text-red-700 p-4 mb-4 rounded">
                    Error: {error}
                </div>
            )}

            {peerId && (
                <div className="bg-blue-100 text-blue-700 p-4 mb-4 rounded">
                    Room ID: {peerId}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <h2 className="text-lg font-semibold mb-2">Local Video</h2>
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full bg-black rounded"
                    />
                </div>
                <div>
                    <h2 className="text-lg font-semibold mb-2">
                        Remote Video
                        {isConnected && <span className="text-green-500 ml-2">(Connected)</span>}
                    </h2>
                    {/* Hidden video element to receive the stream */}
                    <video
                        ref={remoteVideoRef}
                        playsInline
                        className="hidden"
                    />
                    {/* Canvas to display the video with transparency */}
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
            </div>
        </div>
    );
}
