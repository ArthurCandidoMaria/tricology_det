import { useState } from 'react';
import { Header } from '@/components/Header';
import { Home } from '@/screens/Home';
import { RegisterPatient } from '@/screens/RegisterPatient';
import { SelectPatient } from '@/screens/SelectPatient';
import { Dashboard } from '@/screens/Dashboard';
import { NewSession } from '@/screens/NewSession';
import { SelectArea } from '@/screens/SelectArea';
import { AreaDashboard } from '@/screens/AreaDashboard';
import { SessionDashboard } from '@/screens/SessionDashboard';
import { AnalyzeBySession } from '@/screens/AnalyzeBySession';
import type { Patient } from '@/lib/types';
import type { SessionWithPhotos } from '@/lib/types';
import type { AreaSummary } from '@/lib/areaStats';

type View =
  | 'home'
  | 'register'
  | 'select'
  | 'dashboard'
  | 'analyze-session'
  | 'session-dashboard'
  | 'new-session'
  | 'select-area'
  | 'area-dashboard';

function App() {
  const [view, setView] = useState<View>('home');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionWithPhotos | null>(null);
  const [selectedArea, setSelectedArea] = useState<AreaSummary | null>(null);

  function goHome() {
    setView('home');
    setPatient(null);
    setSelectedSession(null);
    setSelectedArea(null);
  }

  function openDashboard(p: Patient) {
    setPatient(p);
    setSelectedSession(null);
    setSelectedArea(null);
    setView('dashboard');
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {view !== 'home' && <Header onHome={goHome} />}

      {view === 'home' && (
        <Home onRegister={() => setView('register')} onUpdate={() => setView('select')} />
      )}

      {view === 'register' && (
        <RegisterPatient onBack={goHome} onCreated={openDashboard} />
      )}

      {view === 'select' && (
        <SelectPatient onBack={goHome} onSelect={openDashboard} />
      )}

      {view === 'dashboard' && patient && (
        <Dashboard
          patient={patient}
          onBack={goHome}
          onNewSession={() => {
            setSelectedSession(null);
            setView('new-session');
          }}
          onAnalyzeBySession={() => setView('analyze-session')}
          onAnalyzeByArea={() => {
            setSelectedArea(null);
            setView('select-area');
          }}
        />
      )}

      {view === 'analyze-session' && patient && (
        <AnalyzeBySession
          patient={patient}
          onBack={() => setView('dashboard')}
          onSelectSession={(session) => {
            setSelectedSession(session);
            setView('session-dashboard');
          }}
        />
      )}

      {view === 'session-dashboard' && patient && selectedSession && (
        <SessionDashboard
          patient={patient}
          session={selectedSession}
          onBack={() => setView('dashboard')}
          onUpdate={() => setView('new-session')}
        />
      )}

      {view === 'new-session' && patient && (
        <NewSession
          patient={patient}
          sessionId={view === 'new-session' && selectedSession ? selectedSession.id : undefined}
          onBack={() => setView(selectedSession ? 'session-dashboard' : 'dashboard')}
          onSaved={() => {
            setSelectedSession(null);
            setView('dashboard');
          }}
        />
      )}

      {view === 'select-area' && patient && (
        <SelectArea
          patient={patient}
          onBack={() => setView('dashboard')}
          onSelectArea={(area) => {
            setSelectedArea(area);
            setView('area-dashboard');
          }}
        />
      )}

      {view === 'area-dashboard' && patient && selectedArea && (
        <AreaDashboard patient={patient} area={selectedArea} onBack={() => setView('select-area')} />
      )}
    </div>
  );
}

export default App;
