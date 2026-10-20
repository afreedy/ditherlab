import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, Check, ChevronDown, ChevronRight, FileImage, RotateCcw, RotateCw, Upload, X } from 'lucide-react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { autoOperations, warpImage } from './body-warp.js'

const GROUPS = {
  Presets: ['Classic', 'Natural', 'Slender', 'Hourglass', 'Posture', 'Muscular'],
  Ratios: ['Golden ratio', 'Head-to-shoulder', 'Leg-to-body', 'Waist-to-hip', 'Waist', 'Head'],
  'Body parts': ['Slim', 'Chest size', 'Legs', 'Leg', 'Hips', 'Shoulders'],
}
const HANDLES = [
  [0, 'Head'], [11, 'Left shoulder'], [12, 'Right shoulder'],
  [23, 'Left hip'], [24, 'Right hip'], [25, 'Left knee'], [26, 'Right knee'],
  [27, 'Left ankle'], [28, 'Right ankle'],
]
const INITIAL_GUIDES = {
  Stretch: { top: 0.38, bottom: 0.62 },
  Slim: { x: 0.5, y: 0.5, rx: 0.2, ry: 0.24, angle: 0 },
  Resize: { x: 0.5, y: 0.5, r: 0.18 },
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
let detectorPromise

function getDetector() {
  detectorPromise ||= FilesetResolver.forVisionTasks('/mediapipe').then(files => PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
  })).catch(error => { detectorPromise = null; throw error })
  return detectorPromise
}

function Slider({ label, value, min, max, onChange, negative, positive, suffix = '%' }) {
  return <label className="editor-slider"><span><strong>{label}</strong><output>{negative && value > 0 ? '+' : ''}{value}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} />{negative && <span className="editor-range-ends"><small>{negative}</small><small>0</small><small>{positive}</small></span>}</label>
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function imageData(image, maxSide, white = false) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (white) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export default function BodyEditor() {
  const [source, setSource] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [detection, setDetection] = useState('idle')
  const [mode, setMode] = useState('Manual body')
  const [group, setGroup] = useState('Presets')
  const [selection, setSelection] = useState('Classic')
  const [manualTool, setManualTool] = useState('Slim')
  const [guides, setGuides] = useState(INITIAL_GUIDES)
  const [manualStrength, setManualStrength] = useState(0)
  const [autoStrength, setAutoStrength] = useState(50)
  const [protect, setProtect] = useState(true)
  const [draftEnabled, setDraftEnabled] = useState(true)
  const [poseMove, setPoseMove] = useState(null)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [compare, setCompare] = useState(false)
  const [format, setFormat] = useState('png')
  const [zoom, setZoom] = useState(1)
  const [stageSize, setStageSize] = useState({ width: 900, height: 540 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const inputRef = useRef(null)
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const surfaceRef = useRef(null)
  const previewBase = useRef(null)
  const dragRef = useRef(null)
  const guideTouched = useRef(false)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const resize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    return () => observer.disconnect()
  }, [])

  const draft = useMemo(() => {
    if (!source || !draftEnabled) return []
    if (mode === 'Auto body') return autoStrength ? autoOperations(selection, analysis?.landmarks, autoStrength) : []
    if (mode === 'Pose') {
      if (!poseMove || !analysis?.landmarks) return []
      const point = analysis.landmarks[poseMove.index]
      return [{ kind: 'move', x: point.x, y: point.y, rx: 0.16, ry: 0.17, moveX: poseMove.x - point.x, moveY: poseMove.y - point.y }]
    }
    if (!manualStrength) return []
    if (manualTool === 'Stretch') return [{ kind: 'band-stretch', ...guides.Stretch, amount: manualStrength / 100 * 0.5 }]
    if (manualTool === 'Slim') return [{ kind: 'shape-slim', ...guides.Slim, amount: manualStrength / 100 * 0.65 }]
    const guide = guides.Resize
    return [{ kind: 'resize', x: guide.x, y: guide.y, rx: guide.r, ry: guide.r * source.width / source.height, amount: manualStrength / 100 * 0.65 }]
  }, [source, draftEnabled, mode, selection, analysis, autoStrength, manualStrength, poseMove, manualTool, guides])
  const operations = useMemo(() => [...history.flat(), ...draft], [history, draft])
  const stretchActive = operations.some(op => op.kind === 'band-stretch')

  useEffect(() => {
    if (!source) return
    previewBase.current = imageData(source.image, 1150)
    let cancelled = false
    setDetection('analyzing')
    setAnalysis(null)
    getDetector().then(detector => {
      if (cancelled) return
      const input = document.createElement('canvas')
      const scale = Math.min(1, 1280 / Math.max(source.width, source.height))
      // MediaPipe's float mask copy can abort on widths not divisible by four.
      input.width = Math.max(4, Math.round(source.width * scale / 4) * 4)
      input.height = Math.round(source.height * scale)
      input.getContext('2d').drawImage(source.image, 0, 0, input.width, input.height)
      const result = detector.detect(input)
      const landmarks = result.landmarks?.[0] || null
      const segmentation = result.segmentationMasks?.[0]
      let mask = null
      try { if (segmentation) mask = { width: segmentation.width, height: segmentation.height, data: new Float32Array(segmentation.getAsFloat32Array()) } } catch { /* Auto controls still work without a mask. */ }
      segmentation?.close()
      if (!cancelled) {
        setAnalysis({ landmarks, mask }); setDetection(landmarks ? 'ready' : 'no person')
        if (landmarks && !guideTouched.current) {
          const middle = (a, b) => ({ x: (landmarks[a].x + landmarks[b].x) / 2, y: (landmarks[a].y + landmarks[b].y) / 2 })
          const shoulder = middle(11, 12), hip = middle(23, 24), knee = middle(25, 26)
          const width = Math.abs(landmarks[11].x - landmarks[12].x)
          setGuides({
            Stretch: { top: clamp(hip.y, 0.02, 0.86), bottom: clamp(Math.max(hip.y + 0.08, knee.y), 0.1, 0.95) },
            Slim: { x: (shoulder.x + hip.x) / 2, y: (shoulder.y + hip.y) / 2, rx: clamp(width * 0.6, 0.07, 0.4), ry: clamp(Math.abs(hip.y - shoulder.y) * 0.65, 0.08, 0.45), angle: 0 },
            Resize: { x: hip.x, y: hip.y, r: clamp(width * 0.48, 0.06, 0.35) },
          })
        }
      }
    }).catch(error => { if (!cancelled) { setDetection('unavailable'); setMessage(`Body detection failed: ${error.message}`) } })
    return () => { cancelled = true }
  }, [source])

  useEffect(() => {
    if (!source || !canvasRef.current || !previewBase.current) return
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const base = previewBase.current
      canvas.width = base.width
      canvas.height = base.height
      try {
        const pixels = compare ? base : warpImage(base, operations, analysis?.mask, protect)
        canvas.getContext('2d').putImageData(pixels, 0, 0)
      } catch (error) { setMessage(`Preview failed: ${error.message}`) }
    })
    return () => cancelAnimationFrame(frame)
  }, [source, operations, analysis, protect, compare])

  useEffect(() => () => { if (source?.url) URL.revokeObjectURL(source.url) }, [source])

  function load(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('Choose an image file.'); return }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      setSource({ image, url, name: file.name, width: image.naturalWidth, height: image.naturalHeight })
      guideTouched.current = false
      setGuides(INITIAL_GUIDES); setManualStrength(0)
      setZoom(1)
      setHistory([]); setFuture([]); setPoseMove(null); setDraftEnabled(false)
      setMessage('')
    }
    image.onerror = () => { URL.revokeObjectURL(url); setMessage('This image format could not be opened in your browser.') }
    image.src = url
  }

  function apply() {
    if (!draft.length) return
    setHistory(previous => [...previous, draft])
    setFuture([])
    setDraftEnabled(false)
    setPoseMove(null)
    setMessage('Applied')
  }

  function undo() {
    if (!history.length) return
    setFuture(previous => [...previous, history.at(-1)])
    setHistory(previous => previous.slice(0, -1))
    setDraftEnabled(false)
  }

  function redo() {
    if (!future.length) return
    setHistory(previous => [...previous, future.at(-1)])
    setFuture(previous => previous.slice(0, -1))
  }

  async function exportImage() {
    if (!source || busy) return
    setBusy(true)
    setMessage('Rendering full resolution…')
    await new Promise(resolve => setTimeout(resolve, 40))
    try {
      const base = imageData(source.image, Infinity, format === 'jpeg')
      const rendered = warpImage(base, operations, analysis?.mask, protect)
      const canvas = document.createElement('canvas')
      canvas.width = base.width
      canvas.height = base.height
      canvas.getContext('2d').putImageData(rendered, 0, 0)
      const mime = `image/${format}`
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.94))
      if (!blob) throw new Error('The browser could not encode this image.')
      const name = source.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-') || 'image'
      download(blob, `${name}-edited.${format === 'jpeg' ? 'jpg' : format}`)
      setMessage(`Exported ${base.width} × ${base.height}`)
    } catch (error) { setMessage(`Export failed: ${error.message}`) }
    setBusy(false)
  }

  function pointFromEvent(event) {
    const rect = surfaceRef.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }

  function changeGuide(tool, patch) {
    guideTouched.current = true
    setGuides(previous => ({ ...previous, [tool]: { ...previous[tool], ...patch } }))
  }

  function startDrag(event, type, index) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { type, index }
    setDraftEnabled(true)
    moveDrag(event)
  }

  function moveDrag(event) {
    if (!dragRef.current || !surfaceRef.current) return
    const point = pointFromEvent(event)
    const type = dragRef.current.type
    if (type === 'pose') { setPoseMove({ index: dragRef.current.index, ...point }); return }
    if (type === 'place') {
      if (manualTool === 'Stretch') {
        const height = guides.Stretch.bottom - guides.Stretch.top
        const top = clamp(point.y - height / 2, 0, 1 - height)
        changeGuide('Stretch', { top, bottom: top + height })
      } else changeGuide(manualTool, point)
      return
    }
    if (type === 'stretch-top') changeGuide('Stretch', { top: clamp(point.y, 0, guides.Stretch.bottom - 0.04) })
    if (type === 'stretch-bottom') changeGuide('Stretch', { bottom: clamp(point.y, guides.Stretch.top + 0.04, 1) })
    if (type === 'resize-center') changeGuide('Resize', point)
    if (type === 'resize-radius') {
      const dx = (point.x - guides.Resize.x) * source.width
      const dy = (point.y - guides.Resize.y) * source.height
      changeGuide('Resize', { r: clamp(Math.hypot(dx, dy) / source.width, 0.04, 0.48) })
    }
    if (type === 'slim-center') changeGuide('Slim', point)
    if (type.startsWith('slim-') && type !== 'slim-center') {
      const guide = guides.Slim
      const dx = (point.x - guide.x) * source.width
      const dy = (point.y - guide.y) * source.height
      const angle = guide.angle * Math.PI / 180
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
      if (type === 'slim-left' || type === 'slim-right') changeGuide('Slim', { rx: clamp(Math.abs(localX) / source.width, 0.04, 0.48) })
      if (type === 'slim-top' || type === 'slim-bottom') changeGuide('Slim', { ry: clamp(Math.abs(localY) / source.height, 0.04, 0.48) })
      if (type === 'slim-rotate') changeGuide('Slim', { angle: clamp(Math.atan2(-dx, dy) * 180 / Math.PI, -75, 75) })
    }
  }

  const landmark = analysis?.landmarks
  const stretch = guides.Stretch
  const slim = guides.Slim
  const resize = guides.Resize
  const slimPoint = (localX, localY) => {
    const angle = slim.angle * Math.PI / 180
    return { x: slim.x + (localX * Math.cos(angle) - localY * Math.sin(angle)) / (source?.width || 1), y: slim.y + (localX * Math.sin(angle) + localY * Math.cos(angle)) / (source?.height || 1) }
  }
  const handle = (label, point, type) => <button aria-label={label} title={label} className="editor-drag-handle" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} onPointerDown={event => startDrag(event, type)} />
  const previewScale = source ? Math.min(1, 1150 / Math.max(source.width, source.height)) : 1
  const previewWidth = source ? Math.max(1, Math.round(source.width * previewScale)) : 1
  const previewHeight = source ? Math.max(1, Math.round(source.height * previewScale)) : 1
  const fit = Math.min(1, (stageSize.width - 44) / previewWidth, (stageSize.height - 44) / previewHeight)
  const displayWidth = Math.max(1, previewWidth * fit * zoom)
  const displayHeight = Math.max(1, previewHeight * fit * zoom)

  function focusPerson() {
    if (!landmark) return
    setZoom(3)
    const middleY = (landmark[11].y + landmark[12].y + landmark[23].y + landmark[24].y) / 4
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (stageRef.current) stageRef.current.scrollTop = middleY * previewHeight * fit * 3 - stageRef.current.clientHeight / 2 + 22
    }))
  }

  return <main className="editor-page" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); load(event.dataTransfer.files[0]) }}>
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-brand"><a href="/" aria-label="Ditherlab"><ArrowLeft size={18} /></a><span>Image editor</span></div>
        <div className="editor-header-actions"><button className="editor-quiet" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload</button><select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select><button className="editor-primary" onClick={exportImage} disabled={!source || busy}><ArrowDownToLine size={16} /> {busy ? 'Exporting' : 'Export'}</button></div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={event => { load(event.target.files[0]); event.target.value = '' }} />
      </header>
      <section className="editor-workspace">
        <div className="editor-stage">
          <div className="editor-stage-head"><div className="editor-filename"><FileImage size={16} /> {source ? <><strong>{source.name}</strong><span>{source.width} × {source.height}</span></> : <strong>No image</strong>}</div><span className="editor-process">LOCAL / 01</span></div>
          <div className="editor-stage-area" ref={stageRef}>
            {source ? <div className="editor-pan-space" style={{ width: Math.max(stageSize.width - 44, displayWidth), height: Math.max(stageSize.height - 44, displayHeight) }}><div className="editor-surface" style={{ width: displayWidth, height: displayHeight }} ref={surfaceRef} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
              <canvas ref={canvasRef} aria-label="Edited image preview" onPointerDown={event => { if (mode === 'Manual body' && !compare) startDrag(event, 'place') }} />
              {!compare && mode === 'Manual body' && <>
                <svg className="editor-overlay" viewBox={`0 0 ${source.width} ${source.height}`} preserveAspectRatio="none">
                  {manualTool === 'Stretch' && <><rect x="0" y={stretch.top * source.height} width={source.width} height={(stretch.bottom - stretch.top) * source.height} className="editor-band" /><line x1="0" x2={source.width} y1={stretch.top * source.height} y2={stretch.top * source.height} className="editor-guide-line" /><line x1="0" x2={source.width} y1={stretch.bottom * source.height} y2={stretch.bottom * source.height} className="editor-guide-line" /></>}
                  {manualTool === 'Slim' && <g transform={`translate(${slim.x * source.width} ${slim.y * source.height}) rotate(${slim.angle})`}>
                    <path d={`M ${-slim.rx * source.width} ${-slim.ry * source.height} Q ${-slim.rx * source.width * 0.68} 0 ${-slim.rx * source.width} ${slim.ry * source.height}`} className="editor-guide" />
                    <path d={`M ${slim.rx * source.width} ${-slim.ry * source.height} Q ${slim.rx * source.width * 0.68} 0 ${slim.rx * source.width} ${slim.ry * source.height}`} className="editor-guide" />
                    <line x1="0" y1={-slim.ry * source.height} x2="0" y2={slim.ry * source.height} className="editor-guide-line" />
                  </g>}
                  {manualTool === 'Resize' && <circle cx={resize.x * source.width} cy={resize.y * source.height} r={resize.r * source.width} className="editor-guide" />}
                </svg>
                {manualTool === 'Stretch' && <>{handle('Set top edge', { x: 0.94, y: stretch.top }, 'stretch-top')}{handle('Set bottom edge', { x: 0.94, y: stretch.bottom }, 'stretch-bottom')}</>}
                {manualTool === 'Slim' && <>
                  {handle('Move slim area', slimPoint(0, 0), 'slim-center')}
                  {handle('Set left edge', slimPoint(-slim.rx * source.width, 0), 'slim-left')}
                  {handle('Set right edge', slimPoint(slim.rx * source.width, 0), 'slim-right')}
                  {handle('Set top edge', slimPoint(0, -slim.ry * source.height), 'slim-top')}
                  {handle('Set bottom edge', slimPoint(0, slim.ry * source.height), 'slim-bottom')}
                  {handle('Rotate slim area', slimPoint(0, slim.ry * source.height + 44 * source.height / displayHeight), 'slim-rotate')}
                </>}
                {manualTool === 'Resize' && <>{handle('Move resize area', resize, 'resize-center')}{handle('Set circle radius', { x: resize.x + resize.r / Math.SQRT2, y: resize.y + resize.r * source.width / source.height / Math.SQRT2 }, 'resize-radius')}</>}
              </>}
              {!compare && mode === 'Pose' && landmark && HANDLES.map(([index, label]) => <button key={index} aria-label={`Move ${label}`} className="editor-drag-handle pose" style={{ left: `${(poseMove?.index === index ? poseMove.x : landmark[index].x) * 100}%`, top: `${(poseMove?.index === index ? poseMove.y : landmark[index].y) * 100}%` }} onPointerDown={event => startDrag(event, 'pose', index)} />)}
            </div></div> : <div className="editor-empty"><div className="editor-empty-cross">＋</div><button className="editor-primary" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload image</button><span>PNG · JPEG · WebP · browser supported formats</span></div>}
          </div>
          <div className="editor-stage-foot"><div className="editor-stage-tools"><button onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} onPointerCancel={() => setCompare(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') setCompare(true) }} onKeyUp={() => setCompare(false)} onBlur={() => setCompare(false)} disabled={!source} className={compare ? 'is-active' : ''} title="Hold to view original">{compare ? 'Original' : 'Hold to compare'}</button><button onClick={undo} disabled={!history.length} title="Undo"><RotateCcw size={16} /> Undo</button><button onClick={redo} disabled={!future.length} title="Redo"><RotateCw size={16} /> Redo</button></div><div className="editor-zoom-actions"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={!source || zoom <= 1}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(4, value + 0.5))} disabled={!source || zoom >= 4}>+</button><button onClick={() => setZoom(1)} disabled={!source || zoom === 1}>Fit</button><button onClick={focusPerson} disabled={!landmark}>Focus</button></div></div>
        </div>
        <aside className="editor-inspector">
          <div className="editor-inspector-head"><h1>Adjust</h1><span>01 / 03</span></div>
          <div className="editor-modes">{['Pose', 'Manual body', 'Auto body'].map(item => <button key={item} className={mode === item ? 'active' : ''} onClick={() => { setMode(item); setDraftEnabled(true); setPoseMove(null) }}>{item}</button>)}</div>
          <div className="editor-inspector-body">
            {mode === 'Manual body' && <><div className="editor-section-label">01 — TOOL</div><div className="editor-option-list">{['Stretch', 'Slim', 'Resize'].map(item => <button key={item} className={manualTool === item ? 'active' : ''} onClick={() => { setManualTool(item); setDraftEnabled(true) }}><span>{item}</span><ChevronRight size={16} /></button>)}</div><div className="editor-rule" /><div className="editor-section-label">02 — ADJUST</div><Slider label="Strength" value={manualStrength} min={-100} max={100} negative={manualTool === 'Stretch' ? 'Compress' : manualTool === 'Slim' ? 'Widen' : 'Shrink'} positive={manualTool === 'Stretch' ? 'Stretch' : manualTool === 'Slim' ? 'Slim' : 'Enlarge'} onChange={value => { setManualStrength(value); setDraftEnabled(true) }} />
              {manualTool === 'Stretch' && <Slider label="Band height" value={Math.round((stretch.bottom - stretch.top) * 100)} min={4} max={80} onChange={value => { const middle = (stretch.top + stretch.bottom) / 2; const top = clamp(middle - value / 200, 0, 1 - value / 100); changeGuide('Stretch', { top, bottom: top + value / 100 }) }} />}
              {manualTool === 'Slim' && <><Slider label="Width" value={Math.round(slim.rx * 200)} min={8} max={96} onChange={value => changeGuide('Slim', { rx: value / 200 })} /><Slider label="Height" value={Math.round(slim.ry * 200)} min={8} max={96} onChange={value => changeGuide('Slim', { ry: value / 200 })} /><Slider label="Angle" value={Math.round(slim.angle)} min={-75} max={75} suffix="°" negative="Left" positive="Right" onChange={value => changeGuide('Slim', { angle: value })} /></>}
              {manualTool === 'Resize' && <Slider label="Radius" value={Math.round(resize.r * 100)} min={4} max={48} onChange={value => changeGuide('Resize', { r: value / 100 })} />}
              <p className="editor-note">{manualTool === 'Stretch' ? 'Place the band across your legs. Positive strength lengthens the band and moves your feet lower; negative strength shortens it.' : manualTool === 'Slim' ? 'Click to move the guide. Drag its side, end, or rotation handles to fit the body part.' : 'Click to place the circle. Drag its outer handle to set the radius.'}</p></>}
            {mode === 'Auto body' && <><div className="editor-section-label">01 — CATEGORY</div><div className="editor-groups">{Object.keys(GROUPS).map(item => <button key={item} className={group === item ? 'active' : ''} onClick={() => { setGroup(item); setSelection(GROUPS[item][0]); setDraftEnabled(true) }}>{item}</button>)}</div><div className="editor-option-list">{GROUPS[group].map(item => <button key={item} className={selection === item ? 'active' : ''} onClick={() => { setSelection(item); setDraftEnabled(true) }}><span>{item}</span><ChevronRight size={16} /></button>)}</div><div className="editor-rule" /><Slider label="Strength" value={autoStrength} min={-100} max={100} negative="Reverse" positive="Apply" onChange={value => { setAutoStrength(value); setDraftEnabled(true) }} /><p className="editor-note">{detection === 'ready' ? 'Body points found. Adjustments follow the detected pose.' : detection === 'analyzing' ? 'Finding body points locally…' : detection === 'no person' ? 'No person found. Use Manual body to place an edit area.' : detection === 'unavailable' ? 'Body detection failed. Manual tools still work.' : 'Upload an image to use automatic controls.'}</p></>}
            {mode === 'Pose' && <><div className="editor-section-label">01 — POINTS</div><div className="editor-option-list">{HANDLES.map(([index, label]) => <div className="editor-pose-row" key={index}><span>{label}</span><span>{landmark ? `${Math.round(landmark[index].visibility * 100)}%` : '—'}</span></div>)}</div><p className="editor-note">{landmark ? 'Drag a body point on the image, then apply.' : 'Pose points appear when a person is found.'}</p></>}
            <div className="editor-rule" /><div className="editor-section-label">03 — IMAGE</div><button className="editor-toggle" disabled={!analysis?.mask || stretchActive} onClick={() => setProtect(value => !value)}><span>Protect background</span><span className={protect && analysis?.mask && !stretchActive ? 'editor-checkbox checked' : 'editor-checkbox'}>{protect && analysis?.mask && !stretchActive && <Check size={13} />}</span></button><p className="editor-note">{stretchActive ? 'Stretch moves the surrounding scene too; background protection is unavailable for this edit.' : analysis?.mask ? 'Detected background pixels stay in place.' : 'Available after a person is detected.'}</p>
          </div>
          <div className="editor-inspector-foot"><div className="editor-commit"><button onClick={() => { setDraftEnabled(false); setPoseMove(null) }} disabled={!draft.length}><X size={16} /> Cancel</button><button onClick={apply} disabled={!draft.length}><Check size={16} /> Apply</button></div><button className="editor-reset" onClick={() => { setHistory([]); setFuture([]); setDraftEnabled(false); setPoseMove(null) }} disabled={!history.length && !draft.length}>Reset image <ChevronDown size={15} /></button></div>
        </aside>
      </section>
    </div>
    {message && <div className="editor-toast" role="status">{message}<button aria-label="Dismiss" onClick={() => setMessage('')}><X size={14} /></button></div>}
  </main>
}
