import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CameraScanner } from '../../src/features/scanner/components/CameraScanner'

describe('camera scanner smoke test', () => {
  it('renders camera UI and allows retry when camera is off', () => {
    const view = render(<CameraScanner onDetected={() => undefined} />)

    expect(view.getByText(/Camera is off/i)).toBeTruthy()
    expect(view.container.querySelector('button')?.textContent).toMatch(/Open camera/i)
    expect(view.queryByText(/Upload from gallery/i)).toBeNull()
  })

  it('prevents opening the camera while the session is paused', () => {
    const view = render(<CameraScanner onDetected={() => undefined} disabled />)

    expect(view.getByText(/Scanning is paused/i)).toBeTruthy()
    expect(view.getByRole('button', { name: /Scanning paused/i })).toHaveProperty('disabled', true)
  })
})
