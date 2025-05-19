import React, { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import * as bodyPix from "@tensorflow-models/body-pix";
import "@tensorflow/tfjs";

export default function VideoRoom() {
    const [backgroundSource, setBackgroundSource] = useState("self"); // "self" or "peer"
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const canvasRef = useRef(null);
    const [model, setModel] = useState(null);

    useEffect(() => {
        bodyPix.load().then(setModel); // Load once
    }, []);

    useEffect(() => {
        const peer = new Peer();

        navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.play();

            peer.on("call", (call) => {
                call.answer(stream);
                call.on("stream", (remoteStream) => {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play();
                });
            });

            peer.on("open", (id) => {
                console.log("Share this link:", `${window.location.origin}/room/xyz?call=${id}`);
            });
        });
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            if (!model || !canvasRef.current) return;
            const ctx = canvasRef.current.getContext("2d");

            const sourceVideo =
                backgroundSource === "self" ? remoteVideoRef.current : localVideoRef.current;
            const backgroundVideo =
                backgroundSource === "self" ? localVideoRef.current : remoteVideoRef.current;

            if (!sourceVideo || !backgroundVideo) return;

            model.segmentPerson(sourceVideo).then((segmentation) => {
                const maskBackground = bodyPix.toMask(segmentation, { r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 255 });
                ctx.drawImage(backgroundVideo, 0, 0, 640, 480);
                ctx.putImageData(maskBackground, 0, 0);
                ctx.drawImage(sourceVideo, 0, 0, 640, 480);
            });
        }, 100);

        return () => clearInterval(interval);
    }, [backgroundSource, model]);

    return (
        <div className="flex flex-col items-center p-4">
            <h2 className="text-xl font-semibold mb-4">Remote Together</h2>

            <canvas ref={canvasRef} width="640" height="480" className="rounded shadow" />

            {/* Toggle button */}
            <button
                onClick={() =>
                    setBackgroundSource((prev) => (prev === "self" ? "peer" : "self"))
                }
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
            >
                Switch Background to {backgroundSource === "self" ? "Peer" : "Self"}
            </button>

            {/* Hidden raw video elements */}
            <video ref={localVideoRef} style={{ display: "none" }} playsInline muted />
            <video ref={remoteVideoRef} style={{ display: "none" }} playsInline />
        </div>
    );
}
