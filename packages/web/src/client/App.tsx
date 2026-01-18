import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { EntryList } from './pages/EntryList';
import { EntryDetail } from './pages/EntryDetail';
import { EntryNew } from './pages/EntryNew';
import { EntryEdit } from './pages/EntryEdit';
import { Search } from './pages/Search';
import { GraphView } from './pages/GraphView';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/entries" element={<EntryList />} />
        <Route path="/entries/new" element={<EntryNew />} />
        <Route path="/entries/:id" element={<EntryDetail />} />
        <Route path="/entries/:id/edit" element={<EntryEdit />} />
        <Route path="/search" element={<Search />} />
        <Route path="/graph" element={<GraphView />} />
        <Route path="/graph/:id" element={<GraphView />} />
      </Routes>
    </Layout>
  );
}
