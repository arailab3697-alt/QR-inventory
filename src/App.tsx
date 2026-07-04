import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import heroImg from './assets/hero.png'
import encryptedInventory from './encryptedInventory'
import { decryptInventory } from './lib/crypto'
import {
  buildReagentIndex,
  normalizeInventory,
  type Inventory,
  type InventoryEnvelope,
  type Reagent,
} from './lib/inventory'
import './App.css'

type Mode = 'scan' | 'coverage'
type ScanStatus = 'idle' | 'running' | 'preview-only' | 'blocked' | 'error'

type ScanFeedback = {
  raw: string
  matched: boolean
  reagent?: Reagent
  source: 'camera' | 'manual'
  at: number
}

type ScanCorner = {
  x: number
  y: number
}

type ScanFrame = {
  raw: string
  matched: boolean
  reagent?: Reagent
  source: 'camera' | 'manual'
  cornerPoints?: ScanCorner[]
}

type DetectedBarcode = {
  rawValue: string
  cornerPoints?: ScanCorner[]
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
    }
  }
}

const DEMO_PASSWORD = 'cucris'
const PULSE_TEXT = 'Align a QR code inside the frame'

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function App() {
  const [mode, setMode] = useState<Mode>('scan')
  const [password, setPassword] = useState('')
  const [unlockState, setUnlockState] = useState<'locked' | 'loading' | 'open'>(
    'locked',
  )
  const [unlockError, setUnlockError] = useState('')
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanMessage, setScanMessage] = useState('Camera is idle.')
  const [lastFeedback, setLastFeedback] = useState<ScanFeedback | null>(null)
  const [scanSeed, setScanSeed] = useState(0)
  const [scannedAt, setScannedAt] = useState<Record<string, number>>({})
  const [cameraHint, setCameraHint] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<ScanFrame | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<InstanceType<NonNullable<Window['BarcodeDetector']>> | null>(
    null,
  )
  const scanLoopRef = useRef<number | null>(null)
  const drawLoopRef = useRef<number | null>(null)
  const lastObservedRef = useRef({ raw: '', at: 0 })

  const reagentIndex = useMemo(() => {
    if (!inventory) {
      return new Map<string, Reagent>()
    }

    return buildReagentIndex(inventory)
  }, [inventory])

  const shelfGroups = useMemo(() => {
    if (!inventory) {
      return []
    }

    const groups = new Map<string, Reagent[]>()
    for (const reagent of inventory.reagents) {
      const list = groups.get(reagent.shelf) ?? []
      list.push(reagent)
      groups.set(reagent.shelf, list)
    }

    return Array.from(groups.entries()).map(([shelf, reagents]) => ({
      shelf,
      reagents,
      scanned: reagents.filter((entry) => scannedAt[normalizeCode(entry.id)]).length,
    }))
  }, [inventory, scannedAt])

  const totalCount = inventory?.reagents.length ?? 0
  const scannedCount = useMemo(() => Object.keys(scannedAt).length, [scannedAt])
  const remainingCount = Math.max(totalCount - scannedCount, 0)
  const coverage = totalCount > 0 ? scannedCount / totalCount : 0
  const coverageLabel = `${Math.round(coverage * 100)}%`
  const allCaptured = totalCount > 0 && scannedCount === totalCount

  const pendingReagents = useMemo(() => {
    if (!inventory) {
      return []
    }

    return inventory.reagents.filter(
      (entry) => !scannedAt[normalizeCode(entry.id)],
    )
  }, [inventory, scannedAt])

  const stopCamera = () => {
    if (scanLoopRef.current !== null) {
      window.cancelAnimationFrame(scanLoopRef.current)
      scanLoopRef.current = null
    }
    if (drawLoopRef.current !== null) {
      window.cancelAnimationFrame(drawLoopRef.current)
      drawLoopRef.current = null
    }

    detectorRef.current = null

    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    const video = videoRef.current
    if (video) {
      video.srcObject = null
    }
  }

  useEffect(() => stopCamera, [])

  const observeCode = (
    rawValue: string,
    source: ScanFeedback['source'],
    cornerPoints?: ScanCorner[],
  ) => {
    const normalized = normalizeCode(rawValue)
    if (!normalized) {
      return
    }

    const now = Date.now()
    const isCameraRepeat =
      source === 'camera' &&
      lastObservedRef.current.raw === normalized &&
      now - lastObservedRef.current.at < 1200
    if (isCameraRepeat) {
      return
    }

    if (source === 'camera') {
      lastObservedRef.current = { raw: normalized, at: now }
    }

    const reagent = reagentIndex.get(normalized)
    const matched = Boolean(reagent)
    const frame: ScanFrame = {
      raw: rawValue.trim(),
      matched,
      reagent,
      source,
      cornerPoints,
    }

    frameRef.current = frame
    setLastFeedback({
      raw: frame.raw,
      matched,
      reagent,
      source,
      at: now,
    })
    setScanMessage(
      matched
        ? `${reagent?.name ?? 'Unknown'} matched.`
        : 'This QR code is not registered.',
    )

    if (matched && reagent) {
      setScannedAt((current) => {
        const key = normalizeCode(reagent.id)
        if (current[key]) {
          return current
        }
        return {
          ...current,
          [key]: now,
        }
      })
    }
  }

  useEffect(() => {
    if (mode !== 'scan' || unlockState !== 'open') {
      stopCamera()
      setScanMessage('Camera is stopped.')
      setScanStatus('idle')
      return
    }

    let cancelled = false
    let localDetector: InstanceType<NonNullable<Window['BarcodeDetector']>> | null =
      null

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanStatus('blocked')
        setScanMessage('This browser does not expose getUserMedia.')
        setCameraHint('The preview cannot start without camera access.')
        return
      }

      try {
        setScanStatus('idle')
        setScanMessage('Starting camera...')
        setCameraHint('')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          throw new Error('Video element is unavailable.')
        }

        video.srcObject = stream
        await video.play()

        if (window.BarcodeDetector) {
          localDetector = new window.BarcodeDetector({ formats: ['qr_code'] })
          detectorRef.current = localDetector
          setScanStatus('running')
          setScanMessage('Scanning QR codes.')
          setCameraHint('Shape Detection API is active.')
        } else {
          setScanStatus('preview-only')
          setScanMessage('Camera preview is active. Use manual entry for QR IDs.')
          setCameraHint('BarcodeDetector is not available here.')
        }

        const detectOnce = async () => {
          if (cancelled) {
            return
          }

          const currentVideo = videoRef.current
          if (
            localDetector &&
            currentVideo &&
            currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            try {
              const detected = await localDetector.detect(currentVideo)
              for (const barcode of detected) {
                if (barcode?.rawValue) {
                  observeCode(barcode.rawValue, 'camera', barcode.cornerPoints)
                }
              }
            } catch {
              setScanStatus('error')
              setScanMessage('QR detection failed.')
            }
          }

          scanLoopRef.current = window.requestAnimationFrame(detectOnce)
        }

        detectOnce()
      } catch (error) {
        if (cancelled) {
          return
        }

        setScanStatus('blocked')
        setScanMessage('Camera access was denied.')
        setCameraHint(
          error instanceof Error ? error.message : 'Camera permission was denied.',
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      stopCamera()
    }
    // observeCode is stable within each render pass and only used inside the async loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, unlockState, scanSeed])

  useEffect(() => {
    if (mode !== 'scan' || unlockState !== 'open') {
      return
    }

    let cancelled = false
    const draw = () => {
      if (cancelled) {
        return
      }

      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) {
        drawLoopRef.current = window.requestAnimationFrame(draw)
        return
      }

      const context = canvas.getContext('2d')
      if (!context) {
        drawLoopRef.current = window.requestAnimationFrame(draw)
        return
      }

      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))

      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const fallbackFrame: ScanFrame = {
        raw: '',
        matched: false,
        source: 'camera',
      }
      const frame = frameRef.current ?? fallbackFrame
      const hasVideo = video.videoWidth > 0 && video.videoHeight > 0
      const scale = hasVideo
        ? Math.max(width / video.videoWidth, height / video.videoHeight)
        : 1
      const renderWidth = hasVideo ? video.videoWidth * scale : width
      const renderHeight = hasVideo ? video.videoHeight * scale : height
      const offsetX = (width - renderWidth) / 2
      const offsetY = (height - renderHeight) / 2
      const accent = frame.matched ? '#47e6b1' : '#f0b349'

      context.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      context.lineWidth = 1
      context.strokeRect(12, 12, width - 24, height - 24)

      context.strokeStyle = accent
      context.fillStyle = frame.matched
        ? 'rgba(71, 230, 177, 0.14)'
        : 'rgba(240, 179, 73, 0.12)'
      context.lineWidth = 3

      if (frame.cornerPoints?.length === 4) {
        const mapPoint = ({ x, y }: ScanCorner) => ({
          x: offsetX + x * scale,
          y: offsetY + y * scale,
        })
        const points = frame.cornerPoints.map(mapPoint)
        context.beginPath()
        context.moveTo(points[0].x, points[0].y)
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(points[index].x, points[index].y)
        }
        context.closePath()
        context.fill()
        context.stroke()
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 240)
        const boxWidth = Math.min(width * 0.56, 340)
        const boxHeight = Math.min(height * 0.28, 160)
        const left = (width - boxWidth) / 2
        const top = (height - boxHeight) / 2
        context.save()
        context.globalAlpha = 0.7 + pulse * 0.2
        context.setLineDash([12, 10])
        context.strokeRect(left, top, boxWidth, boxHeight)
        context.fillRect(left, top, boxWidth, boxHeight)
        context.restore()
      }

      context.fillStyle = 'rgba(6, 10, 16, 0.82)'
      context.fillRect(16, height - 74, Math.min(width - 32, 330), 50)
      context.fillStyle = '#edf2ff'
      context.font = '600 13px system-ui, sans-serif'
      context.fillText(
        frame.raw ? frame.raw : PULSE_TEXT,
        28,
        height - 44,
        Math.min(width - 56, 300),
      )
      context.font = '12px system-ui, sans-serif'
      context.fillStyle = frame.matched ? '#9cf7cf' : '#f3cc8f'
      context.fillText(frame.matched ? 'VALID' : 'SCAN', 28, height - 26)

      drawLoopRef.current = window.requestAnimationFrame(draw)
    }

    drawLoopRef.current = window.requestAnimationFrame(draw)

    return () => {
      cancelled = true
      if (drawLoopRef.current !== null) {
        window.cancelAnimationFrame(drawLoopRef.current)
        drawLoopRef.current = null
      }
    }
  }, [mode, unlockState, scanSeed])

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setUnlockState('loading')
    setUnlockError('')

    try {
      const plain = await decryptInventory(
        encryptedInventory as InventoryEnvelope,
        password,
      )
      const parsed = normalizeInventory(plain)
      setInventory(parsed)
      setUnlockState('open')
      setPassword('')
      setCameraHint('Inventory decrypted successfully.')
    } catch {
      setUnlockError('Wrong password or corrupted encrypted data.')
      setUnlockState('locked')
    }
  }

  const startCamera = () => {
    if (unlockState !== 'open') {
      return
    }

    setScanSeed((value) => value + 1)
  }

  const stopAndReset = () => {
    stopCamera()
    frameRef.current = null
    lastObservedRef.current = { raw: '', at: 0 }
    setScannedAt({})
    setLastFeedback(null)
    setScanMessage('Session reset.')
    setScanStatus('idle')
    setCameraHint('')
  }

  const submitManualCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    observeCode(manualCode, 'manual')
    setManualCode('')
  }

  if (unlockState !== 'open' || !inventory) {
    return (
      <main className="unlock-screen">
        <section className="unlock-panel">
          <div className="brand-lock">
            <img src={heroImg} alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">QR Inventory</p>
              <h1>Cucris</h1>
            </div>
          </div>

          <p className="unlock-copy">
            Open the encrypted inventory data, then scan QR codes from the camera.
          </p>

          <form className="unlock-form" onSubmit={handleUnlock}>
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter the decrypt password"
            />
            <button type="submit" disabled={unlockState === 'loading'}>
              {unlockState === 'loading' ? 'Decrypting...' : 'Unlock'}
            </button>
          </form>

          {unlockError ? <p className="error-text">{unlockError}</p> : null}
          <p className="unlock-note">
            Sample password: <code>{DEMO_PASSWORD}</code>
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src={heroImg} alt="" aria-hidden="true" />
          <div>
            <p className="eyebrow">Cucris inventory</p>
            <h1>QR Inventory</h1>
          </div>
        </div>

        <div className="mode-toggle" role="tablist" aria-label="Display mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'scan'}
            className={mode === 'scan' ? 'active' : ''}
            onClick={() => setMode('scan')}
          >
            Scan
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'coverage'}
            className={mode === 'coverage' ? 'active' : ''}
            onClick={() => setMode('coverage')}
          >
            Coverage
          </button>
        </div>
      </header>

      <section className="hero-grid">
        <article className="scanner-pane panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Camera preview</p>
              <h2>QR scan</h2>
            </div>
            <div className="status-pill">
              <span className={`dot dot-${scanStatus}`} aria-hidden="true" />
              <span>{scanStatus === 'running' ? 'LIVE' : 'READY'}</span>
            </div>
          </div>

          <div className="preview-shell">
            <video
              ref={videoRef}
              className="preview-video"
              muted
              playsInline
              autoPlay
            />
            <canvas ref={canvasRef} className="preview-overlay" />
            <div className="preview-copy">
              <p>{scanMessage}</p>
              {cameraHint ? <span>{cameraHint}</span> : null}
            </div>
          </div>

          <div className="scan-actions">
            <button type="button" onClick={startCamera}>
              Start camera
            </button>
            <button type="button" className="ghost" onClick={stopCamera}>
              Stop camera
            </button>
            <button type="button" className="ghost" onClick={stopAndReset}>
              Reset session
            </button>
          </div>

          <form className="manual-form" onSubmit={submitManualCode}>
            <label className="field-label" htmlFor="manual-code">
              QR ID
            </label>
            <div className="manual-row">
              <input
                id="manual-code"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Enter a scanned ID"
              />
              <button type="submit">Check</button>
            </div>
          </form>
        </article>

        <aside className="summary-pane">
          <section className="panel summary-card">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Coverage</p>
                <h2>Progress</h2>
              </div>
              <p className="coverage-value">{coverageLabel}</p>
            </div>

            <div className="meter" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, coverage * 100))}%` }} />
            </div>

            <div className="metric-row">
              <span>
                <strong>{scannedCount}</strong> scanned
              </span>
              <span>
                <strong>{remainingCount}</strong> remaining
              </span>
              <span>
                <strong>{totalCount}</strong> total
              </span>
            </div>

            {allCaptured ? (
              <div className="complete-banner">Inspection complete</div>
            ) : (
              <p className="status-copy">
                Keep scanning until every reagent is accounted for.
              </p>
            )}
          </section>

          <section className="panel summary-card">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Focus</p>
                <h2>Latest result</h2>
              </div>
            </div>

            {lastFeedback ? (
              <div className={`focus-card ${lastFeedback.matched ? 'ok' : 'warn'}`}>
                <p className="focus-title">
                  {lastFeedback.matched ? lastFeedback.reagent?.name : 'Unregistered QR'}
                </p>
                <dl>
                  <div>
                    <dt>QR ID</dt>
                    <dd>{lastFeedback.raw}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{lastFeedback.matched ? 'valid' : 'invalid'}</dd>
                  </div>
                  <div>
                    <dt>Shelf</dt>
                    <dd>{lastFeedback.reagent?.shelf ?? '---'}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="status-copy">No scans yet.</p>
            )}
          </section>

          <section className="panel summary-card">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Shelves</p>
                <h2>Per-shelf progress</h2>
              </div>
            </div>

            <div className="shelf-list">
              {shelfGroups.map((group) => (
                <div key={group.shelf} className="shelf-row">
                  <div>
                    <strong>{group.shelf}</strong>
                    <span>
                      {group.scanned}/{group.reagents.length}
                    </span>
                  </div>
                  <div className="shelf-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${(group.scanned / group.reagents.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="panel inventory-pane">
        <div className="panel-head compact">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2>Unscanned items</h2>
          </div>
          <p className="inventory-count">{pendingReagents.length} items</p>
        </div>

        <div className="inventory-grid">
          {pendingReagents.map((reagent) => (
            <article key={reagent.id} className="inventory-item">
              <p className="item-name">{reagent.name}</p>
              <p className="item-meta">{reagent.id}</p>
              <p className="item-meta">{reagent.shelf}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
