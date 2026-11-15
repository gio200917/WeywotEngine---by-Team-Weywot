import { useEffect } from 'react';
import { ConsoleShell } from './components/layout/ConsoleShell.js';
import { useMissionStore } from './store/missionStore.js';

export default function App() {
  const initialize = useMissionStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <ConsoleShell />;
}
