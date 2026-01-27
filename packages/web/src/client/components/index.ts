/**
 * Algerknown Component Library
 * 
 * This component library follows Brad Frost's Atomic Design methodology:
 * https://atomicdesign.bradfrost.com/chapter-2/
 * 
 * Structure:
 * - atoms/     - Basic building blocks (buttons, inputs, badges)
 * - molecules/ - Simple groups of atoms (cards, forms, alerts)
 * - organisms/ - Complex UI sections (sidebar, headers, grids)
 * - templates/ - Page-level layouts
 * 
 * Legacy components (Layout, EntryCard, etc.) are re-exported for 
 * backwards compatibility but should migrate to atomic imports.
 */

// Atoms - Basic building blocks
export * from './atoms';

// Molecules - Groups of atoms
export * from './molecules';

// Organisms - Complex UI sections
export * from './organisms';

// Templates - Page layouts
export * from './templates';

// Legacy exports for backwards compatibility
// These re-export from the new atomic structure
export { MainLayout as Layout } from './templates/MainLayout';
export { EntryCard } from './molecules/EntryCard';
export { HistoryList as HistoryTab } from './organisms/HistoryList';
export { RagStatusPanel as RagStatus } from './organisms/RagStatusPanel';
