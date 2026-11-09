import { Camera, CameraOff, Flashlight, FlashlightOff, RefreshCw, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { playScanFeedback } from '../services/scanFeedback'

type CameraScannerProps = {
  onDetected: (value: string, format?: string) => void
  disabled?: boolean
}

export const SUPPORTED_BARCODE_FORMATS = [
  BarcodeFormat.AZTEC,
  BarcodeFormat.CODABAR,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODE_128,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.EAN_8,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
  BarcodeFormat.MAXICODE,
  BarcodeFormat.PDF_417,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.MICRO_QR_CODE,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
]

function createReader() {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.TRY_HARDER, true)
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_BARCODE_FORMATS)
  return new BrowserMultiFormatReader(hints)
}

export function CameraScanner({ onDetected, disabled = false }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const onDetectedRef = useRef(onDetected)
  const detectedRef = useRef(false)
  const startingRef = useRef(false)
  const cameraRequestRef = useRef(0)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('Camera is off')
  const [error, setError] = useState('')
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    if (disabled) {
      stopCamera()
      setMessage('Scanning is paused')
    }
  }, [disabled])

  function stopCamera(resetDetection = true) {
    cameraRequestRef.current += 1
    controlsRef.current?.stop()
    controlsRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    if (resetDetection) detectedRef.current = false

    setTorchOn(false)
    setTorchSupported(false)
    setActive(false)
    setMessage('Camera is off')
  }

  async function toggleTorch() {
    try {
      let track: MediaStreamTrack | null = null
      if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        track = videoRef.current.srcObject.getVideoTracks()[0] || null
      }

      if (track && 'applyConstraints' in track) {
        const nextTorch = !torchOn
        await track.applyConstraints({
          advanced: [{ torch: nextTorch } as MediaTrackConstraintSet & { torch: boolean }],
        })
        setTorchOn(nextTorch)
      }
    } catch {
      setError('The flashlight could not be toggled on this camera.')
    }
  }

  async function startCamera(deviceId = selectedDevice) {
    if (disabled) return
    if (startingRef.current) return
    startingRef.current = true
    stopCamera()
    const requestId = ++cameraRequestRef.current
    setError('')
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError('Camera access requires HTTPS. Open this site using an HTTPS address.')
      startingRef.current = false
      return
    }

    try {
      detectedRef.current = false
      setMessage('Requesting camera permission...')

      // Query available video devices
      const availableDevices = await BrowserCodeReader.listVideoInputDevices()
      if (requestId !== cameraRequestRef.current) return
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

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: preferredDevice ? { exact: preferredDevice } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      }

      const reader = createReader()
      const controls = await reader.decodeFromConstraints(constraints, videoElement, result => {
        if (requestId === cameraRequestRef.current && result && !detectedRef.current) {
          detectedRef.current = true
          playScanFeedback()
          const format = result.getBarcodeFormat().toString()
          onDetectedRef.current(result.getText(), format)
          stopCamera(false)
        }
      })

      if (requestId !== cameraRequestRef.current) {
        controls.stop()
        return
      }
      controlsRef.current = controls
      if (detectedRef.current) {
        stopCamera(false)
        return
      }

      if (videoElement.srcObject instanceof MediaStream) {
        const videoTrack = videoElement.srcObject.getVideoTracks()[0]
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities()
          if ('torch' in capabilities && Boolean(capabilities.torch)) setTorchSupported(true)
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
    } finally {
      startingRef.current = false
    }
  }

  useEffect(() => () => {
    cameraRequestRef.current += 1
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

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
        <button className="primary-button" type="button" disabled={disabled} onClick={() => void startCamera()}>
          <Camera size={17} /> {disabled ? 'Scanning paused' : 'Open camera'}
        </button>
      ) : (
        <>
          <button className="outline-button" type="button" onClick={() => stopCamera()}>
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
      {devices.length > 1 && (
        <label className="camera-select-label">
          Camera
          <select disabled={disabled} value={selectedDevice} onChange={event => { stopCamera(); setSelectedDevice(event.target.value); void startCamera(event.target.value) }}>
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
