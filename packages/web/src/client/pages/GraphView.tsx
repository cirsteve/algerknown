import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, LinkGraph, IndexEntryRef } from '../lib/api';

export function GraphView() {
  const { id } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<IndexEntryRef[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string>(id || '');
  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    api.getEntries().then(setEntries).catch(console.error);
  }, []);

  useEffect(() => {
    if (id) {
      setSelectedEntry(id);
    }
  }, [id]);

  useEffect(() => {
    async function loadGraph() {
      if (!selectedEntry) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await api.getGraph(selectedEntry, 2);
        setGraph(data);
      } catch (err) {
        console.error('Graph error:', err);
        setGraph(null);
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, [selectedEntry]);

  useEffect(() => {
    if (!graph || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;

    // Clear
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    if (graph.nodes.length === 0) return;

    // Simple force-directed layout
    const nodePositions = new Map<string, { x: number; y: number }>();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    // Position nodes in a circle
    graph.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / graph.nodes.length;
      nodePositions.set(node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });

    // Put selected node in center
    if (selectedEntry && nodePositions.has(selectedEntry)) {
      nodePositions.set(selectedEntry, { x: centerX, y: centerY });
    }

    // Draw edges
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (const edge of graph.edges) {
      const from = nodePositions.get(edge.source);
      const to = nodePositions.get(edge.target);
      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        // Draw relationship label
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(edge.relationship.replace(/_/g, ' '), midX, midY);
      }
    }

    // Draw nodes
    for (const node of graph.nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const isSelected = node.id === selectedEntry;
      const nodeRadius = isSelected ? 30 : 20;

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? '#0ea5e9' : 
        node.type === 'summary' ? '#3b82f6' : '#22c55e';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node label
      ctx.fillStyle = '#f1f5f9';
      ctx.font = isSelected ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = node.topic || node.id;
      ctx.fillText(label.slice(0, 15), pos.x, pos.y);
    }
  }, [graph, selectedEntry]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Graph View</h1>
        <select
          value={selectedEntry}
          onChange={(e) => setSelectedEntry(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
        >
          <option value="">Select an entry</option>
          {entries.map(entry => (
            <option key={entry.id} value={entry.id}>
              {entry.id} ({entry.type})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-slate-400">Loading graph...</div>
      ) : !selectedEntry ? (
        <div className="text-slate-400 text-center py-20">
          Select an entry to view its connection graph
        </div>
      ) : graph && graph.nodes.length > 0 ? (
        <div className="bg-slate-800 rounded-lg overflow-hidden" style={{ height: '500px' }}>
          <canvas ref={canvasRef} className="w-full h-full" />
        </div>
      ) : (
        <div className="text-slate-400 text-center py-20">
          No connections found for this entry
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Connected Nodes</h3>
          <div className="flex flex-wrap gap-2">
            {graph.nodes.map(node => (
              <Link
                key={node.id}
                to={`/entries/${node.id}`}
                className={`link-badge hover:bg-slate-500 ${
                  node.id === selectedEntry ? 'bg-sky-500/30 text-sky-300' : ''
                }`}
              >
                {node.topic || node.id}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
