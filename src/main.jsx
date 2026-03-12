import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ChartPage } from './components/ChartPage.jsx'
import { applyTheme, getTheme } from './lib/theme.js'

// Apply saved theme before first paint — prevents flash of wrong colours
applyTheme(getTheme());

const isChartPopup = new URLSearchParams(window.location.search).has('chart');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isChartPopup ? <ChartPage /> : <App />}
  </StrictMode>,
)
