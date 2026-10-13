import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('informa claramente cuando falta la configuración pública de Supabase', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Conectá Rafa Tenis con Supabase.' })).toBeInTheDocument()
    expect(screen.getByText('Falta VITE_SUPABASE_URL.')).toBeInTheDocument()
  })
})
