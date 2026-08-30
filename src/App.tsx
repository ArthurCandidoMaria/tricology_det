import { useState } from 'react';
import { Header } from '@/components/Header';
import { Home } from '@/screens/Home';
import { RegisterPatient } from '@/screens/RegisterPatient';
import { SelectPatient } from '@/screens/SelectPatient';
import { Dashboard } from '@/screens/Dashboard';
import { NewSession } from '@/screens/NewSession';
import { AnalyzeByArea } from '@/screens/AnalyzeByArea';
import type { Patient } from '@/lib/types';

type View = 'home' | 'register' | 'select' | 'dashboard' | 'new-session' | 'analyze';

function App() {
  const [view, setView] = useState<View>('home');
  const [patient, setPatient] = useState<Patient | null>(null);

  function goHome() {
    setView('home');
    setPatient(null);
  }

  function openDashboard(p: Patient) {
    setPatient(p);
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
          onNewSession={() => setView('new-session')}
          onAnalyzeByArea={() => setView('analyze')}
        />
      )}

      {view === 'new-session' && patient && (
        <NewSession
          patient={patient}
          onBack={() => setView('dashboard')}
          onSaved={() => setView('dashboard')}
        />
      )}

      {view === 'analyze' && patient && (
        <AnalyzeByArea patient={patient} onBack={() => setView('dashboard')} />
      )}
    </div>
  );
}

export default App;
