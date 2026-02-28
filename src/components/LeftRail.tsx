import { AppWindow, FolderTree, LayoutGrid, LineChart, Settings2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import type { RailMode } from '../store/types';

const ITEMS: Array<{ id: RailMode; label: string; icon: typeof FolderTree }> = [
  { id: 'workspace', label: 'Workspace', icon: FolderTree },
  { id: 'graphs', label: 'Graphs', icon: LineChart },
  { id: 'tables', label: 'Tables', icon: AppWindow },
  { id: 'layout', label: 'Layout', icon: LayoutGrid },
  { id: 'settings', label: 'Settings', icon: Settings2 }
];

export default function LeftRail() {
  const railMode = useWorkspaceStore((state) => state.railMode);
  const setRailMode = useWorkspaceStore((state) => state.setRailMode);

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-2 border-r border-slate-800 bg-rail py-3">
      <div className="mb-2 rounded-md border border-accent/40 bg-panel px-2 py-1 text-xs font-semibold text-accent">FJ</div>
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = railMode === item.id;

        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={() => setRailMode(item.id)}
            className={[
              'group flex h-10 w-10 items-center justify-center rounded-lg border text-xs transition',
              active
                ? 'border-accent/80 bg-accent/15 text-accent'
                : 'border-transparent bg-panelSoft text-muted hover:border-slate-700 hover:text-ink'
            ].join(' ')}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </aside>
  );
}
