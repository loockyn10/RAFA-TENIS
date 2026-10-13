import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('informa que las reservas aún no están disponibles', () => {
    render(<App />)

    expect(screen.getByText('Prototipo en desarrollo: reservas todavía no disponibles.')).toBeInTheDocument()
  })
})
