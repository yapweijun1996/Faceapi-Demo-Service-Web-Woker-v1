// faceDetectionServiceWorker.js
const SW_VERSION = '1.0.1';
console.log(`Service Worker version ${SW_VERSION} started.`);

importScripts('faceEnvWorkerPatch.js');
importScripts('face-api.min.js');

let isModelLoaded = false;

// Helper to broadcast messages to all clients
async function broadcastMessage(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(client => {
        client.postMessage(message);
    });
}

const FaceDetectorOptionsDefault = new faceapi.TinyFaceDetectorOptions({
  inputSize: 128,
  scoreThreshold: 0.1,
  maxDetectedFaces: 1,
});
let face_for_loading_options = FaceDetectorOptionsDefault;

async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri('../models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('../models');
  await faceapi.nets.faceRecognitionNet.loadFromUri('../models');

  isModelLoaded = true;
  broadcastMessage({ type: 'MODELS_LOADED' });
}

async function checkModelsLoaded() {
  if (isModelLoaded) {
    console.log("checkModelsLoaded : Models are loaded.");
    broadcastMessage({ type: 'MODELS_LOADED' });
  } else {
    console.log("checkModelsLoaded : Models are not loaded yet.");
    await loadModels();
  }
}

async function detectFaces(imageData, width, height) {
  if (!isModelLoaded) {
    console.log('Models not loaded yet');
    return;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  const detections = await faceapi
    .detectAllFaces(canvas, face_for_loading_options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (detections.length > 0) {
    const landmarks = detections[0].landmarks;

    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const centerX = (leftEye[0].x + rightEye[0].x) / 2;
    const centerY = (leftEye[0].y + rightEye[0].y) / 2;

    const regionsToExtract = [
      new faceapi.Rect(centerX - 200, centerY - 100, 450, 450)
    ];

    const faceCanvas = await faceapi.extractFaces(canvas, regionsToExtract);

    const imageDatas = faceCanvas.map(face => {
      const faceCtx = face.getContext('2d');
      return faceCtx.getImageData(0, 0, face.width, face.height);
    });

    return [detections, imageDatas];
  } else {
    console.log('No face detected');
    return [null, []];
  }
}

self.addEventListener('message', async function(event) {
  const { type, imageData, width, height, face_detector_options } = event.data;

  // Handle PING separately to respond directly to the source client
  if (type === 'PING') {
    if (event.source) {
      event.source.postMessage({ type: 'PONG' });
    } else {
      // Fallback for older browsers or contexts without event.source
      broadcastMessage({ type: 'PONG' });
    }
    return;
  }

  if (typeof face_detector_options === "undefined" || face_detector_options === "undefined") {
    face_for_loading_options = FaceDetectorOptionsDefault;
  } else {
    face_for_loading_options = new faceapi.TinyFaceDetectorOptions(face_detector_options);
  }

  let detections;
  switch (type) {
    case 'LOAD_MODELS':
      await checkModelsLoaded();
      break;
    case 'DETECT_FACES':
      detections = await detectFaces(imageData, width, height);
      broadcastMessage({
        type: 'DETECTION_RESULT',
        data: {
          detections: detections,
          displaySize: { width, height }
        }
      });
      break;
    case 'WARMUP_FACES':
      detections = await detectFaces(imageData, width, height);
      broadcastMessage({
        type: 'WARMUP_RESULT',
        data: {
          detections: detections,
          displaySize: { width, height }
        }
      });
      break;
    default:
      console.warn('Unknown message type received in Service Worker:', type);
  }
});

self.addEventListener('messageerror', function(event) {
  console.error('Service Worker message error: ', event);
});

// Ensure the worker activates as soon as it finishes installing and takes control
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
