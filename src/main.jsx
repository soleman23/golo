import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { isPushConfigured, registerServiceWorker } from './lib/push'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Register the push service worker after load (never prompts — permission is
// only requested later from a user gesture). Skipped when push isn't configured.
if (isPushConfigured && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { registerServiceWorker() })
}
