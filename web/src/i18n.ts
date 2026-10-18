const en = {
  newNote: 'New note', search: 'Search…  (tag:x notebook:y todo:true)', allNotes: 'All notes', pinned: 'Pinned',
  reminders: 'Reminders', notebooks: 'Notebooks', tags: 'Tags', trash: 'Trash', savedSearches: 'Saved searches',
  untitled: 'Untitled', noNotes: 'No notes here', selectNote: 'Select or create a note', title: 'Title',
  addTag: 'Add tag…', saving: 'Saving…', saved: 'Saved', newNotebook: 'New notebook', notebookName: 'Notebook name',
  rename: 'Rename', delete: 'Delete', restore: 'Restore', deleteForever: 'Delete forever', emptyTrash: 'Empty trash',
  confirmDelete: 'Delete this permanently?', confirmEmptyTrash: 'Permanently delete everything in the trash?',
  confirmNotebook: 'Delete this notebook? Its notes move to another notebook.', exportMd: 'Export Markdown',
  exportEnex: 'Export ENEX', importEnex: 'Import ENEX…', history: 'History', noHistory: 'No earlier versions yet',
  restoreVersion: 'Restore', pin: 'Pin', unpin: 'Unpin', reminder: 'Reminder', clearReminder: 'Clear',
  attach: 'Attach file', image: 'Image', link: 'Link', linkPrompt: 'URL', saveSearch: 'Save search',
  searchName: 'Name for this search', imported: 'Imported {n} notes', reminderDue: 'Reminder', more: 'More',
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', highlight: 'Highlight',
  bullets: 'Bullet list', numbers: 'Numbered list', checklist: 'Checklist', quote: 'Quote', code: 'Code block',
  table: 'Table', rule: 'Divider', local: 'Stored locally on this device',
};
const es: typeof en = {
  newNote: 'Nueva nota', search: 'Buscar…  (tag:x notebook:y todo:true)', allNotes: 'Todas las notas', pinned: 'Fijadas',
  reminders: 'Recordatorios', notebooks: 'Cuadernos', tags: 'Etiquetas', trash: 'Papelera', savedSearches: 'Búsquedas guardadas',
  untitled: 'Sin título', noNotes: 'No hay notas', selectNote: 'Selecciona o crea una nota', title: 'Título',
  addTag: 'Añadir etiqueta…', saving: 'Guardando…', saved: 'Guardado', newNotebook: 'Nuevo cuaderno', notebookName: 'Nombre del cuaderno',
  rename: 'Renombrar', delete: 'Eliminar', restore: 'Restaurar', deleteForever: 'Eliminar para siempre', emptyTrash: 'Vaciar papelera',
  confirmDelete: '¿Eliminar definitivamente?', confirmEmptyTrash: '¿Eliminar definitivamente todo lo de la papelera?',
  confirmNotebook: '¿Eliminar este cuaderno? Sus notas pasan a otro cuaderno.', exportMd: 'Exportar Markdown',
  exportEnex: 'Exportar ENEX', importEnex: 'Importar ENEX…', history: 'Historial', noHistory: 'Aún no hay versiones anteriores',
  restoreVersion: 'Restaurar', pin: 'Fijar', unpin: 'Desfijar', reminder: 'Recordatorio', clearReminder: 'Quitar',
  attach: 'Adjuntar archivo', image: 'Imagen', link: 'Enlace', linkPrompt: 'URL', saveSearch: 'Guardar búsqueda',
  searchName: 'Nombre de esta búsqueda', imported: 'Importadas {n} notas', reminderDue: 'Recordatorio', more: 'Más',
  bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado', strike: 'Tachado', highlight: 'Resaltar',
  bullets: 'Lista con viñetas', numbers: 'Lista numerada', checklist: 'Lista de tareas', quote: 'Cita', code: 'Bloque de código',
  table: 'Tabla', rule: 'Separador', local: 'Guardado localmente en este dispositivo',
};
export type Key = keyof typeof en;
const dict = navigator.language.toLowerCase().startsWith('es') ? es : en;
export const t = (key: Key, vars?: Record<string, string | number>) =>
  dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));
export const locale = navigator.language;
