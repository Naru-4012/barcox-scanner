import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CameraScanner } from '../components/CameraScanner'

describe('camera scanner smoke test', () => {
  it('renders camera UI and allows retry when camera is off', () => {
    const view = render(<CameraScanner onDetected={() => undefined} />)

    expect(view.getByText(/Camera is off/i)).toBeTruthy()
    expect(view.container.querySelector('button')?.textContent).toMatch(/Open camera/i)
    expect(view.container.textContent).toMatch(/Upload from gallery/i)
  })
})
