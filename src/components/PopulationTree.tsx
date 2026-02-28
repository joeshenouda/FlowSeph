import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

function gateLabel(type: string): string {
  switch (type) {
    case 'rectangle':
      return 'Rect';
    case 'polygon':
      return 'Poly';
    case 'quadrant':
      return 'Quad';
    case 'ellipse':
      return 'Ellipse';
    default:
      return type;
  }
}

export default function PopulationTree() {
  const populations = useWorkspaceStore((state) => state.populations);
  const populationOrder = useWorkspaceStore((state) => state.populationOrder);
  const selectedPopulationId = useWorkspaceStore((state) => state.selectedPopulationId);
  const selectPopulation = useWorkspaceStore((state) => state.selectPopulation);
  const deletePopulation = useWorkspaceStore((state) => state.deletePopulation);
  const renamePopulation = useWorkspaceStore((state) => state.renamePopulation);
  const togglePopulationVisibility = useWorkspaceStore((state) => state.togglePopulationVisibility);

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="border-b border-slate-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Population Tree</h2>
      </header>

      <div className="scrollbar-thin flex-1 overflow-auto p-2">
        <button
          type="button"
          className={[
            'mb-2 flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm',
            selectedPopulationId === 'ungated'
              ? 'border-accent/70 bg-accent/15 text-accent'
              : 'border-slate-700 bg-panelSoft text-ink'
          ].join(' ')}
          onClick={() => selectPopulation('ungated')}
        >
          <span>Ungated</span>
          <span className="text-[10px] uppercase text-muted">Root</span>
        </button>

        {populationOrder.length === 0 ? (
          <div className="rounded border border-dashed border-slate-700 p-3 text-xs text-muted">
            No gates yet. Use rectangle, polygon, quadrant, or ellipse in the graph toolbar.
          </div>
        ) : null}

        {populationOrder.map((populationId) => {
          const population = populations[populationId];
          if (!population) {
            return null;
          }

          const active = selectedPopulationId === populationId;

          return (
            <div
              key={populationId}
              className={[
                'mb-2 rounded border px-2 py-1',
                active ? 'border-accent/70 bg-accent/10' : 'border-slate-700 bg-panelSoft/80'
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectPopulation(populationId)}
                  className={[
                    'flex flex-1 items-center gap-2 rounded px-1 py-1 text-left text-sm transition',
                    active ? 'text-accent' : 'text-ink hover:text-accentSoft'
                  ].join(' ')}
                >
                  <span className="truncate">{population.name}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-muted">{gateLabel(population.type)}</span>
                </button>

                <button
                  type="button"
                  className="rounded p-1 text-muted transition hover:text-ink"
                  onClick={() => togglePopulationVisibility(populationId)}
                  title="Toggle visibility"
                >
                  {population.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted transition hover:text-ink"
                  onClick={() => {
                    const next = prompt('Rename gate', population.name);
                    if (next) {
                      renamePopulation(populationId, next);
                    }
                  }}
                  title="Rename"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted transition hover:text-red-300"
                  onClick={() => deletePopulation(populationId)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
