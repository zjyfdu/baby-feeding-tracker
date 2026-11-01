import {createRoot} from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Qoder Sites injects a "Made with Qoder" badge into the served HTML.
const removeSiteBadge = () => {
  document.getElementById('qoder-sites-watermark')?.remove()
}
new MutationObserver(removeSiteBadge).observe(document.documentElement, {
  childList: true,
})
removeSiteBadge()
document.addEventListener('DOMContentLoaded', removeSiteBadge)

createRoot(document.getElementById('root')!).render(<App />)
