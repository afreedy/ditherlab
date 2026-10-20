import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('public/mediapipe', {recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', {recursive:true});
await mkdir('public/models', {recursive:true});
const url='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const r=await fetch(url);if(!r.ok)throw new Error(`Model download failed: ${r.status}`);
await writeFile('public/models/pose_landmarker_lite.task',Buffer.from(await r.arrayBuffer()));
console.log('Installed MediaPipe runtime and pose model locally.');
