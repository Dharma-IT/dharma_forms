import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ManageTeam from './ManageTeam.tsx'
import AuthGate from './AuthGate.tsx'
import Calendar from './Calendar.tsx'
import Migration from './Migration.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>{window.location.pathname.replace(/\/$/, '') === '/migration' ? <Migration /> : window.location.pathname.replace(/\/$/, '') === '/calendar' ? <Calendar /> : window.location.pathname.replace(/\/$/, '') === '/manage-team' ? <ManageTeam /> : <App />}</AuthGate>
  </StrictMode>,
)

