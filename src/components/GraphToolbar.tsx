import {
  Circle,
  Crosshair,
  MousePointer2,
  Pentagon,
  Redo2,
  Square,
  Undo2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import type { ToolMode } from '../store/types';

const TOOL_ITEMS: Array<{ id: ToolMode; icon: typeof MousePointer2; label: string; shortcut: string }> = [
  { id: 'pointer', icon: MousePointer2, label: 'Pointer', shortcut: 'V' },
  { id: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { id: 'polygon', icon: Pentagon, label: 'Polygon', shortcut: 'P' },
  { id: 'quadrant', icon: Crosshair, label: 'Quadrant', shortcut: 'Q' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', shortcut: 'E' }
];

export default function GraphToolbar() {
  const toolMode = useWorkspaceStore((state) => state.toolMode);
  const setToolMode = useWorkspaceStore((state) => state.setToolMode);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const prevSample = useWorkspaceStore((state) => state.prevSample);
  const nextSample = useWorkspaceStore((state) => state.nextSample);
  const historyPastLength = useWorkspaceStore((state) => state.historyPast.length);
  const historyFutureLength = useWorkspaceStore((state) => state.historyFuture.length);
  const workerProgress = useWorkspaceStore((state) => state.workerProgress);
  const workerStatus = useWorkspaceStore((state) => state.workerStatus);

  return (
    <header className="border-b border-slate-800 bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
          {TOOL_ITEMS.map((tool) => {
            const Icon = tool.icon;
            const active = toolMode === tool.id;

            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setToolMode(tool.id)}
                title={`${tool.label} (${tool.shortcut})`}
                className={[
                  'shrink-0 rounded border px-2 py-1 text-xs transition',
                  active
                    ? 'border-accent/80 bg-accent/15 text-accent'
                    : 'border-slate-700 bg-panelSoft text-muted hover:text-ink'
                ].join(' ')}
              >
                <Icon size={14} />
                <span className="ml-1">{tool.shortcut}</span>
              </button>
            );
          })}

          <div className="ml-1 h-5 w-px shrink-0 bg-slate-700" />

          <button
            type="button"
            onClick={undo}
            disabled={historyPastLength === 0}
            className="shrink-0 rounded border border-slate-700 bg-panelSoft p-1 text-muted transition enabled:hover:text-ink disabled:opacity-40"
            title="Undo (Cmd/Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={historyFutureLength === 0}
            className="shrink-0 rounded border border-slate-700 bg-panelSoft p-1 text-muted transition enabled:hover:text-ink disabled:opacity-40"
            title="Redo (Shift+Cmd/Ctrl+Z)"
          >
            <Redo2 size={14} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={prevSample}
            className="rounded border border-slate-700 bg-panelSoft p-1 text-muted transition hover:text-ink"
            title="Previous sample"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={nextSample}
            className="rounded border border-slate-700 bg-panelSoft p-1 text-muted transition hover:text-ink"
            title="Next sample"
          >
            <ChevronRight size={16} />
          </button>

          <div className="ml-2 flex min-w-28 items-center justify-end gap-2 text-[11px] text-muted">
            <span>{workerStatus === 'running' ? 'Analyzing' : 'Idle'}</span>
            {workerProgress !== null ? <span>{Math.round(workerProgress * 100)}%</span> : null}
          </div>
        </div>
      </div>
    </header>
  );
}
