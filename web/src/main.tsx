import { createRoot } from 'react-dom/client'
import './arc/vendor/foundation.css'
import './arc/console.css'
import './deck.css'
import './demo.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
