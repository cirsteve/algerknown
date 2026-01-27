import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/templates/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { EntryList } from './pages/EntryList';
import { EntryDetail } from './pages/EntryDetail';
import { EntryNew } from './pages/EntryNew';
import { EntryEdit } from './pages/EntryEdit';
import { Search } from './pages/Search';
import { GraphView } from './pages/GraphView';
import { AskPage } from './pages/AskPage';
import { IngestPage } from './pages/IngestPage';
import { ChangesPage } from './pages/ChangesPage';

export default function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/entries" element={<EntryList />} />
        <Route path="/entries/new" element={<EntryNew />} />
        <Route path="/entries/:id" element={<EntryDetail />} />
        <Route path="/entries/:id/edit" element={<EntryEdit />} />
        <Route path="/search" element={<Search />} />
        <Route path="/graph" element={<GraphView />} />
        <Route path="/graph/:id" element={<GraphView />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/ingest" element={<IngestPage />} />
        <Route path="/changes" element={<ChangesPage />} />
      </Routes>
    </MainLayout>
  );
}
