import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import CampaignsPage from './pages/CampaignsPage'
import CampaignPage from './pages/CampaignPage'
import NewCampaignPage from './pages/NewCampaignPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<CampaignsPage />} />
        <Route path="/new" element={<NewCampaignPage />} />
        <Route path="/campaigns" element={<Navigate to="/" replace />} />
        <Route path="/campaigns/:id" element={<CampaignPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}
