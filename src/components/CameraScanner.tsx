import { Camera, CameraOff, Flashlight, FlashlightOff, ImageUp, RefreshCw, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

type CameraScannerProps = {
  onDetected: (value: string, format?: string) => void
}

/* ── Web Audio beep for instant scan feedback ── */
export function playScanFeedback() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioCtx) {
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1200, ctx.currentTime)
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
      setTimeout(() => void ctx.close().catch(() => {}), 250)
    }
  } catch {
    // AudioContext blocked or unsupported
  }

  // Haptic vibration feedback on mobile devices
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(80)
    }
  } catch {
    // Haptics unavailable
  }
}

export function CameraScanner({ onDetected }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const nativeStreamRef = useRef<MediaStream | null>(null)
  const nativeDetectorActiveRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const detectedRef = useRef(false)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('Camera is off')
  const [error, setError] = useState('')
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  function stopCamera() {
    // Stop native loop
    nativeDetectorActiveRef.current = false
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    // Stop native media stream
    if (nativeStreamRef.current) {
      nativeStreamRef.current.getTracks().forEach(track => track.stop())
      nativeStreamRef.current = null
    }

    // Stop ZXing controls
    controlsRef.current?.stop()
    controlsRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    // Reset detection flag so next scan session can detect barcodes
    detectedRef.current = false

    setTorchOn(false)
    setTorchSupported(false)
    setActive(false)
    setMessage('Camera is off')
  }

  async function toggleTorch() {
    try {
      let track: MediaStreamTrack | null = null
      if (nativeStreamRef.current) {
        track = nativeStreamRef.current.getVideoTracks()[0] || null
      } else if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        track = videoRef.current.srcObject.getVideoTracks()[0] || null
      }

      if (track && 'applyConstraints' in track) {
        const nextTorch = !torchOn
        await track.applyConstraints({
          advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
        })
        setTorchOn(nextTorch)
      }
    } catch {
      // Torch toggle failed
    }
  }

  async function startCamera(deviceId = selectedDevice) {
    setError('')
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError('Camera access requires HTTPS. Open this site using an HTTPS address.')
      return
    }

    try {
      // Reset detection flag for new scan session
      detectedRef.current = false
      setMessage('Requesting camera permission...')

      // Query available video devices
      const availableDevices = await BrowserCodeReader.listVideoInputDevices()
      if (availableDevices.length === 0) {
        setError('No camera was found. Check that a camera is connected and enabled.')
        setMessage('Camera unavailable')
        return
      }

      setDevices(availableDevices)
      const preferredDevice = deviceId || availableDevices.find(camera => /back|rear|environment/i.test(camera.label))?.deviceId || availableDevices[0].deviceId
      setSelectedDevice(preferredDevice)

      const videoElement = videoRef.current
      if (!videoElement) throw new Error('Camera preview is not ready.')

      // High-resolution video constraints for clear 1D barcode scanning
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: preferredDevice ? { exact: preferredDevice } : undefined,
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      }

      // Check if native BarcodeDetector is supported (Chrome/Android/Edge)
      const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

      if (hasNativeDetector) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          nativeStreamRef.current = stream
          videoElement.srcObject = stream
          await videoElement.play()

          // Check torch capability
          const videoTrack = stream.getVideoTracks()[0]
          if (videoTrack) {
            const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as { torch?: boolean }
            if (capabilities.torch) {
              setTorchSupported(true)
            }
          }

          // Initialize native BarcodeDetector with 1D & 2D formats
          const barcodeFormats = [
            'code_128',
            'code_39',
            'code_93',
            'codabar',
            'ean_13',
            'ean_8',
            'itf',
            'upc_a',
            'upc_e',
            'qr_code',
            'data_matrix',
            'aztec',
            'pdf417',
          ]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detector = new (window as any).BarcodeDetector({ formats: barcodeFormats })

          nativeDetectorActiveRef.current = true
          setActive(true)
          setMessage('Align barcode or QR code inside the frame')

          const scanFrame = async () => {
            if (!nativeDetectorActiveRef.current) return
            if (videoElement.readyState >= 2 && !detectedRef.current) {
              try {
                const barcodes = await detector.detect(videoElement)
                if (barcodes.length > 0 && !detectedRef.current) {
                  detectedRef.current = true
                  const barcode = barcodes[0]
                  const rawValue = barcode.rawValue || ''
                  if (rawValue) {
                    playScanFeedback()
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const format = (barcode as any).format || ''
                    onDetected(rawValue, format)
                    stopCamera()
                    return
                  }
                }
              } catch {
                // Detection frame pass error
              }
            }
            if (nativeDetectorActiveRef.current) {
              animFrameRef.current = requestAnimationFrame(scanFrame)
            }
          }

          animFrameRef.current = requestAnimationFrame(scanFrame)
          return
        } catch {
          // Native detector init failed, fallback to ZXing below
          stopCamera()
        }
      }

      // Fallback: ZXing BrowserMultiFormatReader with TRY_HARDER and all barcode formats
      const hints = new Map<DecodeHintType, unknown>()
      hints.set(DecodeHintType.TRY_HARDER, true)
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.AZTEC,
        BarcodeFormat.PDF_417,
      ])

      const reader = new BrowserMultiFormatReader(hints)
      const controls = await reader.decodeFromConstraints(constraints, videoElement, (result, decodeError) => {
        if (result && !detectedRef.current) {
          detectedRef.current = true
          playScanFeedback()
          const format = result.getBarcodeFormat().toString()
          onDetected(result.getText(), format)
          stopCamera()
        } else if (decodeError && decodeError.name !== 'NotFoundException') {
          setError('Scanning in progress... align the code within the frame.')
        }
      })

      controlsRef.current = controls

      // Check torch capability
      if (videoElement.srcObject instanceof MediaStream) {
        const videoTrack = videoElement.srcObject.getVideoTracks()[0]
        if (videoTrack) {
          const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as { torch?: boolean }
          if (capabilities.torch) setTorchSupported(true)
        }
      }

      setActive(true)
      setMessage('Align barcode or QR code inside the frame')
    } catch (cameraError) {
      stopCamera()
      if (cameraError instanceof DOMException && cameraError.name === 'NotAllowedError') {
        setError('Camera permission was denied. Allow camera access in browser address bar, then try again.')
      } else if (cameraError instanceof DOMException && cameraError.name === 'NotFoundError') {
        setError('No camera was found. Check that a camera is connected and enabled.')
      } else {
        setError('Could not open the camera. Check browser permissions and try again.')
      }
    }
  }

  async function decodeSelectedImage(event: React.ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0]
    event.target.value = ''
    if (!image) return

    if (!image.type.startsWith('image/')) {
      setError('Choose an image from your gallery.')
      return
    }
    if (image.size > 20 * 1024 * 1024) {
      setError('Choose an image smaller than 20 MB.')
      return
    }

    stopCamera()
    setError('')
    setMessage('Reading code from image...')

    // 1. Try Native BarcodeDetector if available
    const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window
    if (hasNativeDetector) {
      try {
        const imageBitmap = await createImageBitmap(image)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'aztec', 'pdf417'],
        })
        const barcodes = await detector.detect(imageBitmap)
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          playScanFeedback()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const format = (barcodes[0] as any).format || ''
          onDetected(barcodes[0].rawValue, format)
          setMessage('Code detected from image')
          return
        }
      } catch {
        // Fallback to ZXing
      }
    }

    // 2. Try ZXing BrowserMultiFormatReader with TRY_HARDER
    const imageUrl = URL.createObjectURL(image)
    try {
      const hints = new Map<DecodeHintType, unknown>()
      hints.set(DecodeHintType.TRY_HARDER, true)
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.AZTEC,
        BarcodeFormat.PDF_417,
      ])
      const reader = new BrowserMultiFormatReader(hints)
      const result = await reader.decodeFromImageUrl(imageUrl)
      playScanFeedback()
      const format = result.getBarcodeFormat().toString()
      onDetected(result.getText(), format)
      setMessage('Code detected from image')
    } catch {
      setError('No readable barcode or QR code found in that image. Try a clearer, well-lit photo.')
      setMessage('Camera is off')
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  useEffect(() => () => stopCamera(), [])

  return <div className="camera-scanner">
    <div className={`scan-frame ${active ? 'camera-active' : ''}`}>
      <video ref={videoRef} className="camera-video" muted playsInline />
      {!active && <>
        <CameraOff size={42} strokeWidth={1.5} />
        <span>{message}</span>
      </>}
      {active && <>
        <div className="camera-target">
          <div className="laser-line" />
        </div>
        <span className="camera-status">{message}</span>
      </>}
    </div>
    <div className="camera-controls">
      {!active ? (
        <button className="primary-button" type="button" onClick={() => void startCamera()}>
          <Camera size={17} /> Open camera
        </button>
      ) : (
        <>
          <button className="outline-button" type="button" onClick={stopCamera}>
            <Square size={15} /> Stop camera
          </button>
          {torchSupported && (
            <button className={`outline-button ${torchOn ? 'active-torch' : ''}`} type="button" onClick={() => void toggleTorch()} title="Toggle Flashlight">
              {torchOn ? <FlashlightOff size={17} /> : <Flashlight size={17} />}
              {torchOn ? 'Torch Off' : 'Torch On'}
            </button>
          )}
        </>
      )}
      <input ref={imageInputRef} className="gallery-input" type="file" accept="image/*" onChange={event => void decodeSelectedImage(event)} />
      <button className="outline-button" type="button" onClick={() => imageInputRef.current?.click()}>
        <ImageUp size={17} /> Upload from gallery
      </button>
      {devices.length > 1 && (
        <label className="camera-select-label">
          Camera
          <select value={selectedDevice} onChange={event => { stopCamera(); setSelectedDevice(event.target.value); void startCamera(event.target.value) }}>
            {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>
      )}
      {!active && error && (
        <button className="icon-button" type="button" title="Try camera again" onClick={() => void startCamera()}>
          <RefreshCw size={17} />
        </button>
      )}
    </div>
    {error && <div className="error-message"><Camera size={16} />{error}</div>}
  </div>
}
