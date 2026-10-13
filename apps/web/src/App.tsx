const futureModules = ['Canchas', 'Personas', 'Profesores', 'Torneos']

function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label="Rafa Tenis, inicio">
          <span className="brand-mark" aria-hidden="true">RT</span>
          <span>Rafa Tenis</span>
        </a>
        <span className="status-pill">En construcción</span>
      </header>

      <main id="inicio">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Gestión simple para el club</p>
          <h1 id="hero-title">Un lugar claro para organizar Rafa Tenis.</h1>
          <p className="intro">
            Estamos preparando una herramienta ágil para acompañar el día a día del club,
            desde cualquier dispositivo.
          </p>
          <p className="development-notice" role="status">
            Prototipo en desarrollo: reservas todavía no disponibles.
          </p>
        </section>

        <section className="next-section" aria-labelledby="next-title">
          <div>
            <p className="eyebrow">Próximamente</p>
            <h2 id="next-title">Base preparada para crecer por etapas.</h2>
          </div>
          <ul className="module-list" aria-label="Módulos futuros previstos">
            {futureModules.map((module) => (
              <li key={module}>
                <span aria-hidden="true" />
                {module}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer>
        <span>Rafa Tenis</span>
        <span>Prototipo técnico · Argentina</span>
      </footer>
    </div>
  )
}

export default App
