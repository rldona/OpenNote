export interface Notebook { id: string; name: string; stack: string | null; noteCount: number }
export interface NoteSummary {
  id: string; notebookId: string; title: string; snippet: string; pinned: boolean;
  trashedAt: number | null; reminderAt: number | null; createdAt: number; updatedAt: number;
  tags: string[]; attachmentCount: number;
}
export interface Note extends NoteSummary { content: string; sourceUrl: string | null }
export interface TagCount { name: string; count: number }
export interface SavedSearch { id: string; name: string; query: string }
export interface Version { id: number; title: string; savedAt: number }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface NoteQuery { notebook?: string; tag?: string; q?: string; trashed?: boolean; pinned?: boolean; reminders?: boolean }

export const api = {
  notebooks: () => req<Notebook[]>('GET', '/notebooks'),
  createNotebook: (name: string, stack?: string | null) => req<Notebook>('POST', '/notebooks', { name, stack }),
  updateNotebook: (id: string, patch: { name?: string; stack?: string | null }) => req<Notebook>('PATCH', `/notebooks/${id}`, patch),
  deleteNotebook: (id: string) => req<void>('DELETE', `/notebooks/${id}`),
  notes: (query: NoteQuery) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
    return req<NoteSummary[]>('GET', `/notes?${p}`);
  },
  note: (id: string) => req<Note>('GET', `/notes/${id}`),
  createNote: (input: Partial<Note>) => req<Note>('POST', '/notes', input),
  updateNote: (id: string, patch: Partial<Note>) => req<Note>('PATCH', `/notes/${id}`, patch),
  trashNote: (id: string) => req<void>('DELETE', `/notes/${id}`),
  deleteNote: (id: string) => req<void>('DELETE', `/notes/${id}?permanent=true`),
  restoreNote: (id: string) => req<Note>('POST', `/notes/${id}/restore`),
  emptyTrash: () => req<{ deleted: number }>('DELETE', '/trash'),
  tags: () => req<TagCount[]>('GET', '/tags'),
  searches: () => req<SavedSearch[]>('GET', '/searches'),
  saveSearch: (name: string, query: string) => req<SavedSearch>('POST', '/searches', { name, query }),
  deleteSearch: (id: string) => req<void>('DELETE', `/searches/${id}`),
  versions: (id: string) => req<Version[]>('GET', `/notes/${id}/versions`),
  restoreVersion: (id: string, v: number) => req<Note>('POST', `/notes/${id}/versions/${v}/restore`),
  async upload(noteId: string, file: File): Promise<{ url: string; filename: string; mime: string }> {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch(`/api/notes/${noteId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    return res.json();
  },
  async importEnex(file: File, notebook: string): Promise<{ notes: number; attachments: number }> {
    const res = await fetch(`/api/import/enex?notebook=${encodeURIComponent(notebook)}`, { method: 'POST', body: await file.text() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'import failed');
    return data;
  },
};
