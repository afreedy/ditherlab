import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Check, Film, Layers2, Maximize2, Pause, Play, RotateCcw, UploadCloud, X } from 'lucide-react'
import { METHODS, renderDither } from './dither.js'

const DEFAULT = {
  method: 'halftone',
  cell: 8,
  threshold: 50,
  contrast: 1.35,
  brightness: 0,
  dotScale: 0.82,
  grain: 0.8,
  highlights: true,
  ink: '#f7f8ff',
  paper: '#214bcd',
  motion: 'none',
  speed: 1,
  strength: 45,
}

const PALETTES = [
  { name: 'Electric blue', ink: '#f7f8ff', paper: '#214bcd' },
  { name: 'Newsprint', ink: '#20211e', paper: '#eee9dc' },
  { name: 'Acid lime', ink: '#d6ff60', paper: '#1f2920' },
  { name: 'Cherry soda', ink: '#ffddd7', paper: '#ad2947' },
  { name: 'Ultraviolet', ink: '#d6c5ff', paper: '#352d72' },
  { name: 'Soft peach', ink: '#ac3c45', paper: '#ffe1bc' },
]

const EXAMPLES = [
  { name: 'Color shapes', url: '/sample-shapes.svg' },
  { name: 'Concentric rings', url: '/sample-rings.svg' },
]

const MOTIONS = [
  { id: 'none', name: 'Still' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'wave', name: 'Wave' },
  { id: 'drift', name: 'Drift' },
  { id: 'pulse', name: 'Pulse' },
]

function DitherBackdrop({ settings }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const source = document.createElement('canvas')
    const sourceCtx = source.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame
    let last = 0
    const resize = () => {
      const scale = Math.min(1, 1600 / window.innerWidth, 1000 / window.innerHeight)
      source.width = Math.round(window.innerWidth * scale)
      source.height = Math.round(window.innerHeight * scale)
      draw(performance.now())
    }
    const draw = now => {
      if (now - last < 90 && !reduced) { frame = requestAnimationFrame(draw); return }
      last = now
      const width = source.width
      const height = source.height
      const time = reduced ? 0 : now / 1000 * settings.speed
      const movement = 0.3 + settings.strength / 100
      sourceCtx.fillStyle = '#393939'
      sourceCtx.fillRect(0, 0, width, height)
      sourceCtx.globalCompositeOperation = 'screen'
      for (const [baseX, baseY, size, offset] of [[0.18, 0.2, 0.48, 0], [0.78, 0.57, 0.55, 2.1], [0.38, 1.0, 0.42, 4.2]]) {
        const x = (baseX + Math.sin(time * 0.3 + offset) * 0.1 * movement) * width
        const y = (baseY + Math.cos(time * 0.27 + offset) * 0.1 * movement) * height
        const radius = Math.max(width, height) * size
        const gradient = sourceCtx.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
        gradient.addColorStop(0.55, 'rgba(210,210,210,0.38)')
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        sourceCtx.fillStyle = gradient
        sourceCtx.fillRect(0, 0, width, height)
      }
      sourceCtx.globalCompositeOperation = 'source-over'
      renderDither(source, canvas, settings, reduced ? 0 : now / 1000)
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    resize()
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize) }
  }, [settings])
  return <canvas ref={canvasRef} className="dither-backdrop" aria-hidden="true" />
}

function Slider({ label, value, display, min, max, step = 1, onChange, hint }) {
  return (
    <label className="slider-control">
      <span className="control-heading"><span>{label}</span><strong>{display ?? value}</strong></span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
      {hint && <span className="control-hint">{hint}</span>}
    </label>
  )
}

function SectionTitle({ title, accessory }) {
  return <div className="section-title"><h3>{title}</h3>{accessory}</div>
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function cleanName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'image'
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT)
  const [source, setSource] = useState(null)
  const [tab, setTab] = useState('dither')
  const [playing, setPlaying] = useState(false)
  const [compare, setCompare] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  const [zoom, setZoom] = useState(1)
  const fileInput = useRef(null)
  const preview = useRef(null)
  const elapsed = useRef(0)

  const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value }))

  const loadImage = useCallback((url, name, objectUrl = false) => {
    const image = new Image()
    image.onload = () => {
      setSource({ image, url, name, objectUrl })
      setMessage('')
      elapsed.current = 0
    }
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(url)
      setMessage('This image could not be opened. Try a PNG, JPEG, WebP or GIF.')
    }
    image.src = url
  }, [])

  useEffect(() => { loadImage(EXAMPLES[0].url, EXAMPLES[0].name) }, [loadImage])
  useEffect(() => () => { if (source?.objectUrl) URL.revokeObjectURL(source.url) }, [source])

  useEffect(() => {
    if (!source || !preview.current) return
    let frame
    let lastDraw = 0
    const start = performance.now() - elapsed.current * 1000
    const draw = now => {
      if (!preview.current) return
      if (!playing || now - lastDraw > 65) {
        elapsed.current = playing ? (now - start) / 1000 : elapsed.current
        try {
          renderDither(source.image, preview.current, settings, elapsed.current, true)
          setMessage(previous => previous.startsWith('Could not render') ? '' : previous)
        } catch (error) {
          setMessage(`Could not render preview: ${error.message}`)
          return
        }
        lastDraw = now
      }
      if (playing) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [source, settings, playing])

  const chooseFile = file => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setMessage('Please choose an image file.')
      return
    }
    loadImage(URL.createObjectURL(file), file.name, true)
  }

  const exportPNG = () => {
    if (!source) return
    try {
      const canvas = document.createElement('canvas')
      renderDither(source.image, canvas, settings, elapsed.current)
      canvas.toBlob(blob => {
        if (blob) download(blob, `${cleanName(source.name)}-dither.png`)
        else setMessage('PNG export failed in this browser.')
      }, 'image/png')
    } catch (error) {
      setMessage(`PNG export failed: ${error.message}`)
    }
  }

  const exportVideo = () => {
    if (!source || recording) return
    const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']
      .find(type => window.MediaRecorder?.isTypeSupported(type))
    if (!mime) {
      setMessage('Video recording is unavailable in this browser. PNG export still works.')
      return
    }
    try {
      const canvas = document.createElement('canvas')
      renderDither(source.image, canvas, settings, 0)
      const stream = canvas.captureStream(15)
      const capture = new MediaRecorder(stream, { mimeType: mime })
      const chunks = []
      let frame
      let stopped = false
      let last = 0
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      capture.onerror = () => setMessage('Animation recording failed in this browser.')
      capture.onstop = () => {
        stopped = true
        cancelAnimationFrame(frame)
        stream.getTracks().forEach(track => track.stop())
        setRecording(false)
        if (chunks.length) {
          const extension = mime.includes('mp4') ? 'mp4' : 'webm'
          download(new Blob(chunks, { type: mime }), `${cleanName(source.name)}-dither.${extension}`)
        }
      }
      capture.start()
      setRecording(true)
      const start = performance.now()
      const draw = now => {
        if (stopped) return
        if (now - start >= 4000) {
          capture.stop()
          return
        }
        if (now - last >= 1000 / 15) {
          renderDither(source.image, canvas, settings, (now - start) / 1000)
          last = now
        }
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
    } catch (error) {
      setRecording(false)
      setMessage(`Animation export failed: ${error.message}`)
    }
  }

  const activeMethod = METHODS.find(method => method.id === settings.method)
  const activePalette = PALETTES.find(palette => palette.ink === settings.ink && palette.paper === settings.paper)
  const videoSupported = typeof window !== 'undefined' && !!window.MediaRecorder
  const dimensions = source ? `${source.image.naturalWidth.toLocaleString()} × ${source.image.naturalHeight.toLocaleString()}` : '—'

  return (
    <div className="app-shell" onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }}>
      <DitherBackdrop settings={settings} />
      <div className="body-grid">
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => { chooseFile(event.target.files[0]); event.target.value = '' }} />
        <main className="workspace">
          <div className="workspace-header"><div className="brand">Ditherlab</div><div className="header-actions"><a className="button" style={{display:'inline-flex',alignItems:'center',textDecoration:'none'}} href="/image-editor.html">Image editor</a><button className="button subtle" onClick={() => fileInput.current?.click()}>Upload</button><button className="button primary" onClick={exportPNG} disabled={!source}>Download</button></div></div>

          <div className="stage">
            <div className="stage-top"><div className="file-meta"><span className="file-icon"><Layers2 size={16} /></span><span><strong>{source?.name ?? 'Loading...'}</strong><small>{dimensions} PX</small></span></div><div className="stage-top-right"><span className="method-badge">{activeMethod?.name}</span><button title="Reset all controls" className="stage-icon" onClick={() => { setSettings(DEFAULT); setPlaying(false); elapsed.current = 0 }}><RotateCcw size={16} /></button></div></div>
            <div className="canvas-zone">
              <div className="canvas-glow" />
              {source && <div className="canvas-frame" style={{ '--zoom': zoom }}><canvas ref={preview} aria-label="Dithered image preview" />{compare && <img className="compare-image" src={source.url} alt="Original image" />}</div>}
              {!source && <div className="empty-preview">Loading image preview…</div>}
            </div>
            <div className="stage-bottom"><div className="sample-switch">{EXAMPLES.map(example => <button key={example.name} title={example.name} aria-label={`Load ${example.name} sample`} className={source?.url === example.url ? 'selected' : ''} onClick={() => loadImage(example.url, example.name)}><img src={example.url} alt="" /></button>)}</div><div className="compare-wrap"><button className="compare-button" onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerCancel={() => setCompare(false)} onPointerLeave={() => setCompare(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') setCompare(true) }} onKeyUp={() => setCompare(false)}><Maximize2 size={15} /> Compare</button></div><div className="zoom-actions"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.7, +(value - 0.15).toFixed(2)))}>−</button><strong>{Math.round(zoom * 100)}%</strong><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(1.3, +(value + 0.15).toFixed(2)))}>+</button></div></div>
          </div>
        </main>

        <aside className="inspector">
          <div className="inspector-header"><h2>Controls</h2><button className="stage-icon" title="Reset controls" onClick={() => setSettings(DEFAULT)}><RotateCcw size={17} /></button></div>
          <div className="tabs" role="tablist" aria-label="Editor controls">
            <button role="tab" aria-selected={tab === 'dither'} className={tab === 'dither' ? 'active' : ''} onClick={() => setTab('dither')}>Dither</button>
            <button role="tab" aria-selected={tab === 'color'} className={tab === 'color' ? 'active' : ''} onClick={() => setTab('color')}>Color</button>
            <button role="tab" aria-selected={tab === 'motion'} className={tab === 'motion' ? 'active' : ''} onClick={() => setTab('motion')}>Motion</button>
          </div>
          <div className="inspector-scroll">
            {tab === 'dither' && <>
              <SectionTitle title="Method" />
              <div className="method-list">{METHODS.map(method => <button key={method.id} className={`method-option ${settings.method === method.id ? 'active' : ''}`} onClick={() => update('method', method.id)}><span><strong>{method.name}</strong></span>{settings.method === method.id && <Check size={16} />}</button>)}</div>
              <div className="section-rule" />
              <SectionTitle title="Adjust" />
              <Slider label="Grid size" value={settings.cell} display={`${settings.cell} px`} min={3} max={22} onChange={value => update('cell', value)} />
              <Slider label="Threshold" value={settings.threshold} display={`${settings.threshold}%`} min={5} max={95} onChange={value => update('threshold', value)} />
              <Slider label="Contrast" value={settings.contrast} display={settings.contrast.toFixed(2)} min={0.4} max={2.5} step={0.05} onChange={value => update('contrast', value)} />
              <Slider label="Brightness" value={settings.brightness} display={`${settings.brightness > 0 ? '+' : ''}${settings.brightness}`} min={-50} max={50} onChange={value => update('brightness', value)} />
              {settings.method === 'halftone' && <Slider label="Dot size" value={settings.dotScale} display={`${Math.round(settings.dotScale * 100)}%`} min={0.35} max={1.2} step={0.01} onChange={value => update('dotScale', value)} />}
              {settings.method === 'noise' && <Slider label="Grain" value={settings.grain} display={`${Math.round(settings.grain * 100)}%`} min={0.1} max={1.5} step={0.05} onChange={value => update('grain', value)} />}
              <button className="setting-toggle" onClick={() => update('highlights', !settings.highlights)}><span><strong>Ink from highlights</strong></span><span className={`switch ${settings.highlights ? 'on' : ''}`}>{settings.highlights && <Check size={13} />}</span></button>
            </>}

            {tab === 'color' && <>
              <SectionTitle title="Palettes" />
              <div className="palette-grid">{PALETTES.map(palette => <button key={palette.name} className={`palette-option ${activePalette?.name === palette.name ? 'active' : ''}`} onClick={() => setSettings(previous => ({ ...previous, ink: palette.ink, paper: palette.paper }))}><span className="palette-preview" style={{ background: palette.paper }}><i style={{ background: palette.ink }} /><i style={{ background: palette.ink }} /><i style={{ background: palette.ink }} /></span><strong>{palette.name}</strong>{activePalette?.name === palette.name && <Check size={15} />}</button>)}</div>
              <div className="section-rule" />
              <SectionTitle title="Custom colors" />
              <div className="color-inputs"><label><span>Ink / foreground</span><span className="color-field"><input aria-label="Ink color" type="color" value={settings.ink} onChange={event => update('ink', event.target.value)} /><strong>{settings.ink.toUpperCase()}</strong></span></label><label><span>Paper / background</span><span className="color-field"><input aria-label="Paper color" type="color" value={settings.paper} onChange={event => update('paper', event.target.value)} /><strong>{settings.paper.toUpperCase()}</strong></span></label></div>
              <button className="outline-button" onClick={() => setSettings(previous => ({ ...previous, ink: previous.paper, paper: previous.ink }))}>Swap colors <ArrowRight size={16} /></button>
            </>}

            {tab === 'motion' && <>
              <SectionTitle title="Animation" />
              <div className="motion-grid">{MOTIONS.map(motion => <button key={motion.id} className={`motion-option ${settings.motion === motion.id ? 'active' : ''}`} onClick={() => update('motion', motion.id)}><span className={`motion-glyph motion-${motion.id}`}>{motion.id === 'none' ? '◼' : motion.id === 'shimmer' ? '✳' : motion.id === 'wave' ? '〰' : motion.id === 'drift' ? '➚' : '◉'}</span><strong>{motion.name}</strong></button>)}</div>
              <div className="section-rule" />
              <SectionTitle title="Playback" />
              <Slider label="Speed" value={settings.speed} display={`${settings.speed.toFixed(1)}×`} min={0.2} max={3} step={0.1} onChange={value => update('speed', value)} />
              <Slider label="Strength" value={settings.strength} display={`${settings.strength}%`} min={0} max={100} onChange={value => update('strength', value)} />
              <button className="play-button" onClick={() => setPlaying(value => !value)} disabled={settings.motion === 'none'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}{playing ? 'Pause preview' : 'Play preview'}</button>
              <div className="section-rule" />
              <SectionTitle title="Export animation" />
              <button className="record-button" onClick={exportVideo} disabled={!videoSupported || !source || recording || settings.motion === 'none'}><Film size={17} />{recording ? 'Recording 4 seconds…' : 'Record animation'}<ArrowDownToLine size={16} /></button>
              {!videoSupported && <p className="control-hint">This browser does not support video recording.</p>}
            </>}
          </div>
        </aside>
      </div>
      {dragging && <div className="drop-overlay"><UploadCloud size={40} /><strong>Drop image</strong></div>}
      {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}><X size={17} /></button></div>}
    </div>
  )
}
