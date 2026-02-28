import { Plus, Search, Upload } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

export default function WorkspaceTree() {
  const groups = useWorkspaceStore((state) => state.groups);
  const samples = useWorkspaceStore((state) => state.samples);
  const selectedGroupId = useWorkspaceStore((state) => state.selectedGroupId);
  const selectedSampleId = useWorkspaceStore((state) => state.selectedSampleId);
  const workspaceSearch = useWorkspaceStore((state) => state.workspaceSearch);
  const createGroup = useWorkspaceStore((state) => state.createGroup);
  const importFiles = useWorkspaceStore((state) => state.importFiles);
  const selectGroup = useWorkspaceStore((state) => state.selectGroup);
  const selectSample = useWorkspaceStore((state) => state.selectSample);
  const setWorkspaceSearch = useWorkspaceStore((state) => state.setWorkspaceSearch);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredGroups = useMemo(() => {
    if (!workspaceSearch.trim()) {
      return groups;
    }

    const query = workspaceSearch.toLowerCase();

    return groups
      .map((group) => {
        const sampleIds = group.sampleIds.filter((sampleId) => {
          const sample = samples[sampleId];
          return sample?.name.toLowerCase().includes(query) || sample?.fileName.toLowerCase().includes(query);
        });

        const groupMatch = group.name.toLowerCase().includes(query);
        if (!groupMatch && sampleIds.length === 0) {
          return null;
        }

        return {
          ...group,
          sampleIds: groupMatch ? group.sampleIds : sampleIds
        };
      })
      .filter((group): group is NonNullable<typeof group> => Boolean(group));
  }, [groups, samples, workspaceSearch]);

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Workspace</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border border-slate-700 bg-panelSoft p-1 text-muted transition hover:text-ink"
            onClick={() => createGroup()}
            title="Create group"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 bg-panelSoft p-1 text-muted transition hover:text-ink"
            onClick={() => fileInputRef.current?.click()}
            title="Import files"
          >
            <Upload size={14} />
          </button>
        </div>
      </header>

      <div className="border-b border-slate-800 px-3 py-2">
        <label className="flex items-center gap-2 rounded border border-slate-700 bg-panelSoft px-2 py-1 text-muted">
          <Search size={14} />
          <input
            value={workspaceSearch}
            onChange={(event) => setWorkspaceSearch(event.target.value)}
            className="w-full border-none bg-transparent text-sm text-ink outline-none"
            placeholder="Search groups or samples"
          />
        </label>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".fcs"
        className="hidden"
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            await importFiles(files);
          }
          event.target.value = '';
        }}
      />

      <div className="scrollbar-thin flex-1 overflow-auto p-2">
        {filteredGroups.length === 0 ? (
          <div className="rounded border border-dashed border-slate-700 p-3 text-xs text-muted">No groups yet. Import one or more FCS files.</div>
        ) : null}

        {filteredGroups.map((group) => (
          <div key={group.id} className="mb-2 rounded border border-slate-800 bg-panelSoft/80">
            <button
              type="button"
              className={[
                'flex w-full items-center justify-between px-2 py-1 text-left text-sm font-medium transition',
                selectedGroupId === group.id ? 'text-accent' : 'text-ink'
              ].join(' ')}
              onClick={() => selectGroup(group.id)}
            >
              <span className="truncate">{group.name}</span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-muted">{group.sampleIds.length}</span>
            </button>

            <div className="border-t border-slate-800">
              {group.sampleIds.map((sampleId) => {
                const sample = samples[sampleId];
                if (!sample) {
                  return null;
                }

                return (
                  <button
                    key={sample.id}
                    type="button"
                    className={[
                      'flex w-full items-center justify-between px-3 py-1 text-left text-xs transition',
                      selectedSampleId === sample.id
                        ? 'bg-accent/20 text-accent'
                        : 'text-muted hover:bg-slate-800/80 hover:text-ink'
                    ].join(' ')}
                    onClick={() => selectSample(sample.id)}
                  >
                    <span className="truncate">{sample.name}</span>
                    <span className="text-[10px] text-muted">{sample.eventCount.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
