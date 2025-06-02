import * as ort from 'onnxruntime-web';

// Initialize ONNX Runtime Web
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.proxy = false;

class MODNetSegmenter {
    private session: ort.InferenceSession | null = null;
    private isInitialized: boolean = false;

    constructor() {
        this.initializeModel();
    }

    private async initializeModel() {
        try {
            // Initialize ONNX runtime session with WASM backend
            this.session = await ort.InferenceSession.create('/models/modnet.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                enableCpuMemArena: true,
                enableMemPattern: true,
                executionMode: 'sequential'
            });
            
            this.isInitialized = true;
            console.log("MODNet model initialized successfully");
        } catch (error) {
            console.error("Failed to initialize MODNet model:", error);
            throw error;
        }
    }

    private async preprocessImage(videoElement: HTMLVideoElement): Promise<Float32Array> {
        // Create a canvas to get image data
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d')!;
        
        // Draw video frame to canvas
        ctx.drawImage(videoElement, 0, 0);
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;
        
        // Convert to float32 and normalize to [-1, 1]
        const float32Data = new Float32Array(data.length / 4 * 3);
        for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
            float32Data[j] = (data[i] / 127.5) - 1;     // R
            float32Data[j + 1] = (data[i + 1] / 127.5) - 1; // G
            float32Data[j + 2] = (data[i + 2] / 127.5) - 1; // B
        }
        
        return float32Data;
    }

    public async processFrame(videoElement: HTMLVideoElement): Promise<ImageData | null> {
        if (!this.isInitialized || !this.session) {
            console.warn("Model not initialized yet");
            return null;
        }

        try {
            // Preprocess the image
            const inputData = await this.preprocessImage(videoElement);
            
            // Create tensor
            const inputTensor = new ort.Tensor('float32', inputData, [1, 3, videoElement.videoHeight, videoElement.videoWidth]);
            
            // Run inference
            const outputs = await this.session.run({
                'input': inputTensor
            });
            
            // Get output tensor
            const outputData = outputs['output'].data as Float32Array;
            
            // Convert output to ImageData
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d')!;
            
            // Draw original frame
            ctx.drawImage(videoElement, 0, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            // Apply mask to alpha channel
            for (let i = 0; i < outputData.length; i++) {
                imageData.data[i * 4 + 3] = outputData[i] * 255;
            }
            
            return imageData;
        } catch (error) {
            console.error("Error processing frame:", error);
            return null;
        }
    }

    public isReady(): boolean {
        return this.isInitialized;
    }

    public async getFaceMeasurements(videoElement: HTMLVideoElement): Promise<{
        eyeDistance: number;
        faceWidth: number;
        depthEstimate: number;
    } | null> {
        if (!this.isInitialized) {
            return null;
        }

        try {
            // Get segmentation mask
            const imageData = await this.processFrame(videoElement);
            if (!imageData) return null;

            // Calculate face measurements from the mask
            const measurements = this.calculateFaceMeasurements(imageData);
            return measurements;
        } catch (error) {
            console.error("Error getting face measurements:", error);
            return null;
        }
    }

    private calculateFaceMeasurements(imageData: ImageData): {
        eyeDistance: number;
        faceWidth: number;
        depthEstimate: number;
    } {
        // Find the bounding box of the face in the mask
        let left = imageData.width;
        let right = 0;
        let top = imageData.height;
        let bottom = 0;

        for (let y = 0; y < imageData.height; y++) {
            for (let x = 0; x < imageData.width; x++) {
                const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
                if (alpha > 128) { // If pixel is part of the foreground
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        }

        // Calculate face width and approximate eye distance
        const faceWidth = right - left;
        const faceHeight = bottom - top;
        const eyeDistance = faceWidth * 0.4; // Approximate eye distance as 40% of face width

        // Estimate depth based on face size relative to frame
        const faceSizeRatio = faceWidth / imageData.width;
        const depthEstimate = 1 / faceSizeRatio; // Inverse relationship with face size

        return {
            eyeDistance,
            faceWidth,
            depthEstimate
        };
    }
}

export default MODNetSegmenter; 