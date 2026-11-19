import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ManageTeam from './ManageTeam.tsx'
import AuthGate from './AuthGate.tsx'
import Calendar from './Calendar.tsx'
import Migration from './Migration.tsx'
import Stage from './Stage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/migration'
      ? <Migration />
      : <AuthGate>{window.location.pathname.replace(/\/$/, '') === '/stage' ? <Stage /> : window.location.pathname.replace(/\/$/, '') === '/calendar' ? <Calendar /> : window.location.pathname.replace(/\/$/, '') === '/manage-team' ? <ManageTeam /> : <App />}</AuthGate>}
  </StrictMode>,
)

