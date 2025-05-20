import React, { useState, useEffect, useRef } from 'react';
import { Camera, Copy, Download, Share2, UserPlus, X } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';

const Room = () => {
    // Get roomId from URL params
    const { roomId: urlRoomId } = useParams();
    const navigate = useNavigate();

    const [isHost, setIsHost] = useState(false);
    const [roomId, setRoomId] = useState(urlRoomId || '');
    const [copySuccess, setCopySuccess] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [capturedImage, setCapturedImage] = useState(null);
    const [showInviteModal, setShowInviteModal] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const compositeCanvasRef = useRef(null);
    const captureCanvasRef = useRef(null);

    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);
    const peerConnectionRef = useRef(null);

    // Generate random room ID
    const generateRoomId = () => {
        return Math.random().toString(36).substring(2, 10);
    };

    // Create a new room as host
    const createRoom = async () => {
        try {
            // Get user media with video and audio
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localStreamRef.current = stream;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            // Generate a room ID
            const newRoomId = generateRoomId();
            setRoomId(newRoomId);
            setIsHost(true);
            setShowInviteModal(true);

            // Update URL to include room ID
            navigate(`/room/${newRoomId}`, { replace: true });

            // Initialize WebRTC connection (simplified - in production use a signaling server)
            initializeWebRTC();

        } catch (error) {
            console.error("Error accessing media devices:", error);
            alert("Failed to access camera and microphone. Please check permissions.");
        }
    };

    // Join an existing room
    const joinRoom = async (id) => {
        if (!id) {
            alert("Please enter a valid room ID");
            return;
        }

        try {
            // Get user media with transparent background
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localStreamRef.current = stream;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            setRoomId(id);
            setIsHost(false);

            // Update URL to include room ID
            navigate(`/room/${id}`, { replace: true });

            // Initialize WebRTC connection (simplified - in production use a signaling server)
            initializeWebRTC();

            // In a real app, you would connect to signaling server with the room ID
            // For demo purposes, simulating a connection after a delay
            setTimeout(() => {
                setIsConnected(true);
                simulateRemoteStream();
            }, 2000);

        } catch (error) {
            console.error("Error accessing media devices:", error);
            alert("Failed to access camera and microphone. Please check permissions.");
        }
    };

    // Initialize WebRTC peer connection
    const initializeWebRTC = () => {
        // In a real application, this would connect to a signaling server
        // and handle ICE candidates, SDP offers/answers, etc.

        // This is a simplified placeholder - implementation depends on your backend
        peerConnectionRef.current = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Add local tracks to the connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peerConnectionRef.current.addTrack(track, localStreamRef.current);
            });
        }

        // Handle incoming remote stream
        peerConnectionRef.current.ontrack = (event) => {
            remoteStreamRef.current = event.streams[0];
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStreamRef.current;
            }
            setIsConnected(true);
        };
    };

    // For demo purposes - simulate receiving a remote stream
    const simulateRemoteStream = async () => {
        try {
            // In a real app this would come from the peer connection
            const fakeRemoteStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });

            remoteStreamRef.current = fakeRemoteStream;

            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = fakeRemoteStream;
            }

            // Start compositing the streams
            startVideoCompositing();

        } catch (error) {
            console.error("Error simulating remote stream:", error);
        }
    };

    // Composite the video streams - host background with guest overlaid
    const startVideoCompositing = () => {
        if (!compositeCanvasRef.current) return;

        const canvas = compositeCanvasRef.current;
        const ctx = canvas.getContext('2d');

        const drawFrame = () => {
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw host video as background
            if (isHost && localVideoRef.current) {
                ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
            } else if (!isHost && remoteVideoRef.current) {
                ctx.drawImage(remoteVideoRef.current, 0, 0, canvas.width, canvas.height);
            }

            // Draw guest video with background removal (simplified)
            // In a real app, you'd use a more sophisticated background removal technique
            if (isHost && remoteVideoRef.current) {
                // For demo, we're just drawing the remote video at reduced size in corner
                ctx.drawImage(remoteVideoRef.current,
                    canvas.width - 160, canvas.height - 120, 150, 110);
            } else if (!isHost && localVideoRef.current) {
                // For demo, we're just drawing at slightly reduced opacity to simulate transparency
                ctx.globalAlpha = 0.8;
                ctx.drawImage(localVideoRef.current,
                    canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
                ctx.globalAlpha = 1.0;
            }

            requestAnimationFrame(drawFrame);
        };

        drawFrame();
    };

    // Take a picture using the composite canvas
    const takePicture = () => {
        if (!compositeCanvasRef.current || !captureCanvasRef.current) return;

        const compositeCanvas = compositeCanvasRef.current;
        const captureCanvas = captureCanvasRef.current;
        const captureContext = captureCanvas.getContext('2d');

        // Copy current composite frame to the capture canvas
        captureCanvas.width = compositeCanvas.width;
        captureCanvas.height = compositeCanvas.height;
        captureContext.drawImage(compositeCanvas, 0, 0);

        // Convert to data URL
        const imageDataUrl = captureCanvas.toDataURL('image/png');
        setCapturedImage(imageDataUrl);
    };

    // Download the captured image
    const downloadImage = () => {
        if (!capturedImage) return;

        const a = document.createElement('a');
        a.href = capturedImage;
        a.download = `remote-friends-${new Date().getTime()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // Copy room ID to clipboard
    const copyRoomIdToClipboard = () => {
        navigator.clipboard.writeText(roomId).then(
            () => {
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
            },
            (err) => console.error('Could not copy room ID: ', err)
        );
    };

    // Leave the room and cleanup
    const leaveRoom = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }

        if (remoteStreamRef.current) {
            remoteStreamRef.current.getTracks().forEach(track => track.stop());
        }

        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
        }

        setIsConnected(false);
        setRoomId('');
        setCapturedImage(null);

        // Navigate back to home
        navigate('/', { replace: true });
    };

    // Auto-join room from URL if roomId is provided
    useEffect(() => {
        if (urlRoomId && !roomId) {
            joinRoom(urlRoomId);
        }
    }, [urlRoomId]);

    // Clean up on component unmount
    useEffect(() => {
        return () => {
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }

            if (remoteStreamRef.current) {
                remoteStreamRef.current.getTracks().forEach(track => track.stop());
            }

            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
            }
        };
    }, []);

    return (
        <div className="flex flex-col items-center min-h-screen bg-gray-100 p-4">
            {/* Header */}
            <div className="w-full max-w-4xl mb-4 bg-white rounded-lg shadow p-4">
                <h1 className="text-2xl font-bold text-center text-indigo-600">Remote Friends Photo Booth</h1>
                <p className="text-center text-gray-600">Take photos with friends as if they're in your room</p>
            </div>

            {/* Main Content */}
            <div className="w-full max-w-4xl flex flex-col gap-4">
                {/* Room creation/joining if not in a room */}
                {!roomId && (
                    <div className="bg-white rounded-lg shadow p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-4 p-4 border rounded-lg border-indigo-200 bg-indigo-50">
                                <h2 className="text-xl font-semibold text-indigo-700">Create a Room</h2>
                                <p className="text-gray-600">Start a new session and invite friends</p>
                                <button
                                    onClick={createRoom}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2"
                                >
                                    <Camera size={20} />
                                    Create New Room
                                </button>
                            </div>

                            <div className="flex flex-col gap-4 p-4 border rounded-lg border-green-200 bg-green-50">
                                <h2 className="text-xl font-semibold text-green-700">Join a Room</h2>
                                <p className="text-gray-600">Enter a room ID to join</p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Enter Room ID"
                                        className="flex-1 border border-gray-300 rounded-lg px-4 py-2"
                                        onChange={(e) => setRoomId(e.target.value)}
                                    />
                                    <button
                                        onClick={() => joinRoom(roomId)}
                                        className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg"
                                    >
                                        Join
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Active Room */}
                {roomId && (
                    <div className="bg-white rounded-lg shadow p-6">
                        {/* Room Header */}
                        <div className="flex flex-wrap justify-between items-center pb-4 border-b border-gray-200 mb-4">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800">
                                    {isHost ? 'Your Room' : 'Joined Room'}
                                </h2>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-sm text-gray-600">Room ID: {roomId}</span>
                                    <button
                                        onClick={copyRoomIdToClipboard}
                                        className="text-indigo-600 hover:text-indigo-800"
                                        title="Copy Room ID"
                                    >
                                        <Copy size={16} />
                                    </button>
                                    {copySuccess && (
                                        <span className="text-xs text-green-600">Copied!</span>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 mt-2 sm:mt-0">
                                {isHost && (
                                    <button
                                        onClick={() => setShowInviteModal(true)}
                                        className="bg-indigo-100 hover:bg-indigo-200 text-indigo-800 py-1 px-3 rounded-lg flex items-center gap-1 text-sm"
                                    >
                                        <UserPlus size={16} />
                                        Invite
                                    </button>
                                )}

                                <button
                                    onClick={leaveRoom}
                                    className="bg-red-100 hover:bg-red-200 text-red-800 py-1 px-3 rounded-lg flex items-center gap-1 text-sm"
                                >
                                    <X size={16} />
                                    Leave Room
                                </button>
                            </div>
                        </div>

                        {/* Video Container */}
                        <div className="flex flex-col items-center gap-6">
                            {/* Status */}
                            {!isConnected && (
                                <div className="w-full bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                                    <p className="text-yellow-800">
                                        {isHost ? 'Waiting for someone to join...' : 'Connecting to room...'}
                                    </p>
                                </div>
                            )}

                            <div className={`w-full grid ${capturedImage ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} gap-4`}>
                                {/* Live Video Preview */}
                                <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center">
                                    {/* Composite display canvas */}
                                    <canvas
                                        ref={compositeCanvasRef}
                                        className="w-full h-full"
                                        width={640}
                                        height={360}
                                    />

                                    {/* Action button overlay */}
                                    {isConnected && (
                                        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                                            <button
                                                onClick={takePicture}
                                                className="bg-white hover:bg-gray-100 text-gray-800 rounded-full p-3 shadow-lg"
                                                title="Take Photo"
                                            >
                                                <Camera size={24} />
                                            </button>
                                        </div>
                                    )}

                                    {/* Status overlay for not connected */}
                                    {!isConnected && (
                                        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                                            <div className="text-white text-center">
                                                <div className="animate-spin mb-2 mx-auto rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                                                <p>{isHost ? 'Waiting for friend...' : 'Connecting...'}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Captured Image */}
                                {capturedImage && (
                                    <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center">
                                        <img
                                            src={capturedImage}
                                            alt="Captured with friend"
                                            className="max-w-full max-h-full"
                                        />

                                        {/* Download button */}
                                        <div className="absolute bottom-4 right-4 flex gap-2">
                                            <button
                                                onClick={downloadImage}
                                                className="bg-white hover:bg-gray-100 text-gray-800 rounded-full p-2 shadow-lg"
                                                title="Download Photo"
                                            >
                                                <Download size={20} />
                                            </button>

                                            <button
                                                onClick={() => setCapturedImage(null)}
                                                className="bg-white hover:bg-gray-100 text-gray-800 rounded-full p-2 shadow-lg"
                                                title="Discard Photo"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Hidden video elements */}
                            <div className="hidden">
                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                />
                                <video
                                    ref={remoteVideoRef}
                                    autoPlay
                                    playsInline
                                />
                                <canvas
                                    ref={captureCanvasRef}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Invite Modal */}
            {showInviteModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold">Invite a Friend</h3>
                            <button
                                onClick={() => setShowInviteModal(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="mb-6">
                            <p className="text-gray-600 mb-2">Share this room ID with your friend:</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={roomId}
                                    readOnly
                                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
                                />
                                <button
                                    onClick={copyRoomIdToClipboard}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg"
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                            {copySuccess && (
                                <p className="text-sm text-green-600 mt-1">Copied to clipboard!</p>
                            )}
                        </div>

                        <div className="flex justify-between">
                            <button
                                onClick={() => setShowInviteModal(false)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 px-4 rounded-lg"
                            >
                                Close
                            </button>

                            <button
                                onClick={() => {
                                    // In a real app, this would trigger a native share dialog
                                    try {
                                        navigator.share({
                                            title: 'Join my Photo Booth room',
                                            text: `Join my room with ID: ${roomId}`,
                                            url: window.location.href
                                        });
                                    } catch (err) {
                                        // Fallback if Web Share API not available
                                        copyRoomIdToClipboard();
                                    }
                                }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg flex items-center gap-2"
                            >
                                <Share2 size={16} />
                                Share
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Room;