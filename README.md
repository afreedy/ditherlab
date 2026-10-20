# Ditherlab

Local image dithering editor built with React and Vite.

The separate [image editor](image-editor.html) provides pose-guided body adjustments and manual stretch, slim, and resize controls. Stretch lengthens or shortens the selected vertical region to change apparent height; it moves the surrounding scene with the body. Drag the circular handles to place and size an edit; signed strength sliders reverse each effect. Use Focus to zoom to a detected person, then Apply, Undo, or Reset. Its pose model and WebAssembly files are bundled locally. Images stay in the browser; PNG, JPEG, and WebP exports use the uploaded image's original dimensions. Automatic controls require a detectable person; manual controls work on any image.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Upload an image or use a sample, adjust the dither, colors, and motion, then download a PNG or record a four-second animation. Files are processed in the browser. Exports use the image's original pixel dimensions.

```sh
npm test
npm run build
```

## Optional body-editor assets

After `npm ci`, run `npm run setup:assets` to copy the installed MediaPipe WASM runtime and download the official versioned pose model from Google. These third-party runtime/model files are not redistributed in this repository; use their upstream terms. The dithering editor works without this optional download. The public source uses original geometric SVG samples instead of the original reference photos.
