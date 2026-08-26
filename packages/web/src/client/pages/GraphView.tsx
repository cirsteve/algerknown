import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, LinkGraph, IndexEntryRef } from '../lib/api';
import { useTheme, type EffectiveTheme } from '../context/ThemeContext';

/*
 * The canvas is a raster, so none of the semantic tokens reach it - it has to be
 * told the palette. These two tables are the canvas-side spelling of the same
 * light/dark contract the rest of the page gets from CSS variables, and the
 * paint effect re-runs when the effective theme changes.
 */
interface GraphPalette {
  background: string;
  edge: string;
  edgeLabel: string;
  nodeStroke: string;
  nodeLabel: string;
  selected: string;
  summary: string;
  entry: string;
}

const PALETTES: Record<EffectiveTheme, GraphPalette> = {
  light: {
    background: '#f8fafc', // slate-50, matching bg-surface-raised
    edge: '#94a3b8',       // slate-400
    edgeLabel: '#475569',  // slate-600
    nodeStroke: '#cbd5e1', // slate-300
    nodeLabel: '#ffffff',
    selected: '#0284c7',   // sky-600
    summary: '#2563eb',    // blue-600
    entry: '#16a34a',      // green-600
  },
  dark: {
    background: '#1e293b', // slate-800
    edge: '#475569',       // slate-600
    edgeLabel: '#64748b',  // slate-500
    nodeStroke: '#64748b', // slate-500
    nodeLabel: '#f1f5f9',  // slate-100
    selected: '#0ea5e9',   // sky-500
    summary: '#3b82f6',    // blue-500
    entry: '#22c55e',      // green-500
  },
};

/*
 * The canvas is sized from the viewport rather than pinned at 500px: at 320px a
 * fixed 500px box is most of the screen, and on a short landscape viewport it
 * pushes the node list out of reach. The floor keeps the graph legible, the
 * ceiling keeps it from dominating a tall desktop window.
 */
const canvasBox =
  'h-[60vh] supports-[height:100dvh]:h-[60dvh] min-h-[16rem] max-h-[32rem]';

export function GraphView() {
  const { id } = useParams<{ id: string }>();
  const { theme } = useTheme();
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

    const palette = PALETTES[theme];

    const draw = () => {
      // The box is sized in CSS, so the backing store is re-derived on every
      // paint: the element's width changes with the viewport, and a device
      // pixel ratio above 1 needs a larger buffer to stay sharp.
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      if (width === 0 || height === 0) return;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      // Clear
      ctx.fillStyle = palette.background;
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
      ctx.strokeStyle = palette.edge;
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
          ctx.fillStyle = palette.edgeLabel;
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
        ctx.fillStyle = isSelected
          ? palette.selected
          : node.type === 'summary'
            ? palette.summary
            : palette.entry;
        ctx.fill();
        ctx.strokeStyle = palette.nodeStroke;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Node label
        ctx.fillStyle = palette.nodeLabel;
        ctx.font = isSelected ? 'bold 12px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = node.topic || node.id;
        ctx.fillText(label.slice(0, 15), pos.x, pos.y);
      }
    };

    draw();

    // The box is viewport-relative, so a rotation or a resize changes its size
    // without changing any of this effect's dependencies.
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [graph, selectedEntry, theme]);

  return (
    <div className="min-w-0 space-y-6">
      {/* The entry picker holds long ids, so it takes the full width below `sm`
          rather than squeezing itself in beside the title. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-xl font-bold text-content-strong sm:text-2xl">Graph View</h1>
        <select
          aria-label="Entry to graph"
          value={selectedEntry}
          onChange={(e) => setSelectedEntry(e.target.value)}
          className="w-full rounded-lg border border-edge bg-surface-raised px-3 py-2 text-content transition-colors hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-auto sm:max-w-xs"
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
        <div className="text-content-muted">Loading graph...</div>
      ) : !selectedEntry ? (
        <div className="py-20 text-center text-content-muted">
          Select an entry to view its connection graph
        </div>
      ) : graph && graph.nodes.length > 0 ? (
        <div className={`overflow-hidden rounded-lg border border-edge bg-surface-raised ${canvasBox}`}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Connection graph for ${selectedEntry}, ${graph.nodes.length} nodes. The connected nodes are listed below.`}
            className="h-full w-full"
          />
        </div>
      ) : (
        <div className="py-20 text-center text-content-muted">
          No connections found for this entry
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <div className="min-w-0 rounded-lg border border-edge bg-surface-raised p-4">
          {/* This list is also the accessible reading of the canvas: the graph
              truncates labels to fit a node, these do not. */}
          <h3 className="mb-2 text-sm font-medium text-content-muted">Connected Nodes</h3>
          <div className="flex flex-wrap gap-2">
            {graph.nodes.map(node => (
              <Link
                key={node.id}
                to={`/entries/${node.id}`}
                aria-current={node.id === selectedEntry ? 'true' : undefined}
                /* Spelled out rather than reusing `.link-badge`: that class is
                   plain CSS declared after the utilities, so its own background
                   would win over the selected variant at equal specificity. */
                className={`break-all rounded px-2 py-0.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                  node.id === selectedEntry
                    ? 'bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-500/30 dark:text-sky-200'
                    : 'bg-control text-content hover:bg-control-hover'
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
