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
  at?: number
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

function normalizeShelf(value: string) {
  const shelf = value.trim()
  return shelf || 'その他'
}

function splitShelfHierarchy(value: string) {
  const shelf = normalizeShelf(value)
  const parts = shelf.split(/\s+/).filter(Boolean)

  if (parts.length <= 1) {
    return { parent: shelf, child: '' }
  }

  return {
    parent: parts[0],
    child: parts.slice(1).join(' '),
  }
}

type PendingShelfLeaf = {
  label: string
  reagents: Reagent[]
}

type PendingShelfGroup = {
  parent: string
  directReagents: Reagent[]
  children: PendingShelfLeaf[]
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
  const [searchTargetCode, setSearchTargetCode] = useState('')
  const [searchTargetIds, setSearchTargetIds] = useState<string[]>([])
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanMessage, setScanMessage] = useState('Camera is idle.')
  const [lastFeedback, setLastFeedback] = useState<ScanFeedback | null>(null)
  const [scanSeed, setScanSeed] = useState(0)
  const [scannedAt, setScannedAt] = useState<Record<string, number>>({})
  const [cameraHint, setCameraHint] = useState('')
  const [showAllShelves, setShowAllShelves] = useState(false)
  const [showUnscannedItems, setShowUnscannedItems] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameListRef = useRef<ScanFrame[]>([])
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

  const searchTargetSet = useMemo(() => new Set(searchTargetIds), [searchTargetIds])

  const shelfGroups = useMemo(() => {
    if (!inventory) {
      return []
    }

    const groups = new Map<string, Reagent[]>()
    for (const reagent of inventory.reagents) {
      const shelf = normalizeShelf(reagent.shelf)
      const list = groups.get(shelf) ?? []
      list.push(reagent)
      groups.set(shelf, list)
    }

    return Array.from(groups.entries())
      .map(([shelf, reagents]) => ({
        shelf,
        reagents,
        scanned: reagents.filter((entry) => scannedAt[normalizeCode(entry.id)]).length,
      }))
      .sort((left, right) => {
        if (right.scanned !== left.scanned) {
          return right.scanned - left.scanned
        }

        return left.shelf.localeCompare(right.shelf)
      })
  }, [inventory, scannedAt])

  const visibleShelfGroups = useMemo(() => {
    if (showAllShelves) {
      return shelfGroups
    }

    return shelfGroups.slice(0, 3)
  }, [shelfGroups, showAllShelves])

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

  const pendingShelfGroups = useMemo<PendingShelfGroup[]>(() => {
    const parentGroups = new Map<
      string,
      {
        directReagents: Reagent[]
        childGroups: Map<string, Reagent[]>
      }
    >()

    for (const reagent of pendingReagents) {
      const { parent, child } = splitShelfHierarchy(reagent.shelf)
      const group = parentGroups.get(parent) ?? {
        directReagents: [],
        childGroups: new Map<string, Reagent[]>(),
      }

      if (child) {
        const list = group.childGroups.get(child) ?? []
        list.push(reagent)
        group.childGroups.set(child, list)
      } else {
        group.directReagents.push(reagent)
      }

      parentGroups.set(parent, group)
    }

    return Array.from(parentGroups.entries())
      .map(([parent, group]) => ({
        parent,
        directReagents: group.directReagents.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        children: Array.from(group.childGroups.entries())
          .map(([label, reagents]) => ({
            label,
            reagents: reagents.sort((left, right) => left.name.localeCompare(right.name)),
          }))
          .sort((left, right) => left.label.localeCompare(right.label)),
      }))
      .sort((left, right) => left.parent.localeCompare(right.parent))
  }, [pendingReagents])

  const hasSearchTargets = searchTargetIds.length > 0

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
    frameListRef.current = []

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
    const isSearchTarget = searchTargetSet.has(normalized)
    const frame: ScanFrame = {
      raw: rawValue.trim(),
      matched,
      reagent,
      source,
      cornerPoints,
      at: now,
    }

    frameListRef.current = [
      ...frameListRef.current.filter((f) => now - (f.at ?? 0) < 300),
      frame,
    ]

    setLastFeedback({
      raw: frame.raw,
      matched,
      reagent,
      source,
      at: now,
    })
    setScanMessage(
      isSearchTarget
        ? `${reagent?.name ?? 'Target QR'} found.`
        : matched
          ? `${reagent?.name ?? 'Unknown'} matched.`
          : 'This QR code is not registered, but it is allowed as a warning.',
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
  }, [mode, unlockState, scanSeed, searchTargetSet])

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
        at: Date.now(),
      }
      const frames = frameListRef.current.length > 0 ? frameListRef.current : [fallbackFrame]

      const hasVideo = video.videoWidth > 0 && video.videoHeight > 0
      const scale = hasVideo
        ? Math.max(width / video.videoWidth, height / video.videoHeight)
        : 1
      const renderWidth = hasVideo ? video.videoWidth * scale : width
      const renderHeight = hasVideo ? video.videoHeight * scale : height
      const offsetX = (width - renderWidth) / 2
      const offsetY = (height - renderHeight) / 2

      context.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      context.lineWidth = 1
      context.strokeRect(12, 12, width - 24, height - 24)

      for (const frame of frames) {
        const normalizedFrame = normalizeCode(frame.raw)
        const isSearchTarget = searchTargetSet.has(normalizedFrame)
        const accent = isSearchTarget
          ? '#ff5d5d'
          : frame.matched
            ? '#47e6b1'
            : '#f0b349'
        context.strokeStyle = accent
        context.fillStyle = isSearchTarget
          ? 'rgba(255, 93, 93, 0.18)'
          : frame.matched
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
        } else if (frame === frames[0] && frame.raw === '') {
          // Pulse animation for the center if no frames are detected
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
      }

      context.fillStyle = 'rgba(6, 10, 16, 0.82)'
      context.fillRect(16, height - 74, Math.min(width - 32, 330), 50)
      context.fillStyle = '#edf2ff'
      context.font = '600 13px system-ui, sans-serif'
      context.fillText(
        frames[0].raw ? frames[0].raw : PULSE_TEXT,
        28,
        height - 44,
        Math.min(width - 56, 300),
      )
      context.font = '12px system-ui, sans-serif'
      context.fillStyle = frames[0].matched ? '#9cf7cf' : '#f3cc8f'
      context.fillText(frames[0].matched ? 'VALID' : 'SCAN', 28, height - 26)

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
    frameListRef.current = []
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

  const submitSearchTarget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeCode(searchTargetCode)
    if (!normalized) {
      return
    }

    setSearchTargetIds((current) =>
      current.includes(normalized) ? current : [...current, normalized],
    )
    setSearchTargetCode('')
  }

  const removeSearchTarget = (target: string) => {
    setSearchTargetIds((current) => current.filter((entry) => entry !== target))
  }

  const clearSearchTargets = () => {
    setSearchTargetIds([])
  }

  const isWarningResult = Boolean(lastFeedback && !lastFeedback.matched)

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
              <p className={isWarningResult ? 'warning-underline' : ''}>
                {scanMessage}
              </p>
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

          <details className="help-details">
            <summary>どうしてもQRコードが読めない時</summary>
            <div className="help-details-body">
              <p className="status-copy">
                カメラで読めないときだけ、QR ID を手入力して確認できます。
              </p>
              <form className="manual-form" onSubmit={submitManualCode}>
                <label className="field-label" htmlFor="manual-code">
                  QR ID
                </label>
                <div className="manual-row">
                  <input
                    id="manual-code"
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder="Paste or type a QR ID"
                  />
                  <button type="submit">Check</button>
                </div>
              </form>
            </div>
          </details>

          <section className="search-target-panel">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Search targets</p>
                <h2>探索中 IDs</h2>
              </div>
              <p className="inventory-count">{searchTargetIds.length} ids</p>
            </div>

            <p className="status-copy">
              ID を登録しておくと、見つかった領域を赤で強調します。
            </p>

            <form className="manual-form" onSubmit={submitSearchTarget}>
              <label className="field-label" htmlFor="search-target-code">
                Add target ID
              </label>
              <div className="manual-row">
                <input
                  id="search-target-code"
                  value={searchTargetCode}
                  onChange={(event) => setSearchTargetCode(event.target.value)}
                  placeholder="Enter an ID to search for"
                />
                <button type="submit">Add</button>
              </div>
            </form>

            <div className="target-actions">
              <button
                type="button"
                className="ghost"
                onClick={clearSearchTargets}
                disabled={!hasSearchTargets}
              >
                Clear all
              </button>
            </div>

            {hasSearchTargets ? (
              <div className="target-chip-list">
                {searchTargetIds.map((target) => (
                  <button
                    key={target}
                    type="button"
                    className="target-chip"
                    onClick={() => removeSearchTarget(target)}
                    title="Click to remove"
                  >
                    {target}
                  </button>
                ))}
              </div>
            ) : (
              <p className="status-copy">No exploration targets registered yet.</p>
            )}
          </section>
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
              <div className="focus-card">
                <p className="focus-title">
                  {lastFeedback.matched ? lastFeedback.reagent?.name : 'Unregistered QR'}
                </p>
                <dl>
                  <div>
                    <dt>QR ID</dt>
                    <dd className={isWarningResult ? 'warning-underline' : ''}>
                      {lastFeedback.raw}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{lastFeedback.matched ? 'valid' : 'warning'}</dd>
                  </div>
                  <div>
                    <dt>Shelf</dt>
                    <dd>{lastFeedback.reagent ? normalizeShelf(lastFeedback.reagent.shelf) : '---'}</dd>
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
              <button
                type="button"
                className="ghost shelf-toggle"
                onClick={() => setShowAllShelves((value) => !value)}
              >
                {showAllShelves ? '簡易表示' : '詳細'}
              </button>
            </div>

            <div className="shelf-list">
              {visibleShelfGroups.map((group) => (
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
            {!showAllShelves && shelfGroups.length > visibleShelfGroups.length ? (
              <p className="status-copy shelf-note">
                Showing top {visibleShelfGroups.length} shelves by scanned count.
              </p>
            ) : null}
          </section>
        </aside>
      </section>

      <section className="panel inventory-pane">
        <div className="panel-head compact">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2>Unscanned items</h2>
          </div>
          <div className="inventory-head-actions">
            <p className="inventory-count">{pendingReagents.length} items</p>
            <button
              type="button"
              className="ghost shelf-toggle"
              onClick={() => setShowUnscannedItems((value) => !value)}
            >
              {showUnscannedItems ? '折りたたむ' : '展開'}
            </button>
          </div>
        </div>

        {showUnscannedItems ? (
          <div className="inventory-shelves">
            {pendingShelfGroups.map((group) => {
              const childCount = group.children.reduce(
                (total, child) => total + child.reagents.length,
                0,
              )
              const totalCount = group.directReagents.length + childCount

              return (
              <details key={group.parent} className="inventory-shelf inventory-shelf-parent">
                <summary>
                  <div>
                    <strong>{group.parent}</strong>
                    <span>{totalCount} items</span>
                  </div>
                </summary>
                <div className="inventory-shelf-children">
                  {group.directReagents.length ? (
                    <div className="inventory-shelf-direct">
                      <div className="inventory-shelf-direct-head">
                        <strong>親直下</strong>
                        <span>{group.directReagents.length} items</span>
                      </div>
                      <div className="inventory-grid">
                        {group.directReagents.map((reagent) => (
                          <article key={reagent.id} className="inventory-item">
                            <p className="item-name">{reagent.name}</p>
                            <p className="item-meta">{reagent.id}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {group.children.map((child) => (
                    <details key={`${group.parent} ${child.label}`} className="inventory-shelf inventory-shelf-child">
                      <summary>
                        <div>
                          <strong>{child.label}</strong>
                          <span>{child.reagents.length} items</span>
                        </div>
                      </summary>
                      <div className="inventory-grid">
                        {child.reagents.map((reagent) => (
                          <article key={reagent.id} className="inventory-item">
                            <p className="item-name">{reagent.name}</p>
                            <p className="item-meta">{reagent.id}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
              )
            })}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
