import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import GraphGallery from './components/GraphGallery';
import GraphPropertiesPanel from './components/GraphPropertiesPanel';
import GraphToolbar from './components/GraphToolbar';
import LeftRail from './components/LeftRail';
import PopulationTree from './components/PopulationTree';
import PrimaryPlotCanvas from './components/PrimaryPlotCanvas';
import WorkspaceTree from './components/WorkspaceTree';
import { useWorkspaceStore } from './store/useWorkspaceStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

export default function App() {
  const setToolMode = useWorkspaceStore((state) => state.setToolMode);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const railMode = useWorkspaceStore((state) => state.railMode);
  const error = useWorkspaceStore((state) => state.error);
  const setError = useWorkspaceStore((state) => state.setError);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const lower = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && !event.shiftKey && lower === 'z') {
        event.preventDefault();
        undo();
        return;
      }

      if (modifier && event.shiftKey && lower === 'z') {
        event.preventDefault();
        redo();
        return;
      }

      if (modifier) {
        return;
      }

      if (lower === 'v') {
        setToolMode('pointer');
      } else if (lower === 'r') {
        setToolMode('rectangle');
      } else if (lower === 'p') {
        setToolMode('polygon');
      } else if (lower === 'q') {
        setToolMode('quadrant');
      } else if (lower === 'e') {
        setToolMode('ellipse');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setToolMode, undo, redo]);

  return (
    <main className="h-screen overflow-auto bg-slate-950 text-ink">
      <div className="flex h-full min-w-[1240px]">
        <LeftRail />

        <div className="relative flex-1 min-w-0 p-2">
          {railMode === 'graphs' ? (
            <PanelGroup
              direction="horizontal"
              autoSaveId="flow-main-panels-v2"
              className="h-full min-h-[680px] rounded-xl border border-slate-800 bg-slate-900"
            >
              <Panel defaultSize={24} minSize={18}>
                <PanelGroup direction="vertical" autoSaveId="flow-left-panels-v2" className="h-full">
                  <Panel defaultSize={58} minSize={24}>
                    <WorkspaceTree />
                  </Panel>
                  <PanelResizeHandle className="panel-resize-handle h-1" />
                  <Panel defaultSize={42} minSize={18}>
                    <PopulationTree />
                  </Panel>
                </PanelGroup>
              </Panel>

              <PanelResizeHandle className="panel-resize-handle w-1" />

              <Panel defaultSize={60} minSize={44}>
                <PanelGroup direction="vertical" autoSaveId="flow-center-panels-v2" className="h-full">
                  <Panel defaultSize={76} minSize={52}>
                    <div className="flex h-full flex-col">
                      <GraphToolbar />
                      <div className="min-h-0 flex-1">
                        <PrimaryPlotCanvas />
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="panel-resize-handle h-1" />

                  <Panel defaultSize={24} minSize={18}>
                    <GraphGallery />
                  </Panel>
                </PanelGroup>
              </Panel>

              <PanelResizeHandle className="panel-resize-handle w-1" />

              <Panel defaultSize={16} minSize={16}>
                <GraphPropertiesPanel />
              </Panel>
            </PanelGroup>
          ) : (
            <section className="grid h-full place-items-center rounded-xl border border-slate-800 bg-panel">
              <div className="max-w-lg rounded border border-dashed border-slate-700 bg-panelSoft p-6 text-center text-sm text-muted">
                <div className="mb-2 text-base text-ink">{railMode[0].toUpperCase() + railMode.slice(1)} mode</div>
                This mode is stubbed in v1. Switch back to Graphs for full FlowJo-style analysis.
              </div>
            </section>
          )}

          {error ? (
            <div className="absolute bottom-4 right-4 max-w-md rounded border border-red-700/60 bg-red-950/80 px-3 py-2 text-xs text-red-200 shadow-panel">
              <div className="mb-1 font-semibold">Import Error</div>
              <div className="whitespace-pre-wrap">{error}</div>
              <button
                type="button"
                className="mt-2 rounded border border-red-500/50 px-2 py-0.5 text-[11px]"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
