/** Inline stroke icons (24x24 grid). Drawn with currentColor so they follow the theme; no icon font or network needed. */
const paths = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  notes: 'M7 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20zM14.5 3.5V8H19M10 12h6M10 15.5h6',
  notebook: 'M6 3.5h11.5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6zM6 3.5v17M3.5 7.5H6M3.5 12H6M3.5 16.5H6M10 8h5',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0zM8.5 8.5h.01',
  tasks: 'M4 5.5l1.5 1.5L8 4.5M4 12.5 5.5 14 8 11.5M4 19.5 5.5 21 8 18.5M11.5 6h8.5M11.5 13h8.5M11.5 20h8.5',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  pin: 'M9 3.5h6l-1 5 3 3.5v1.5H7V12l3-3.5zM12 13.5v7',
  trash: 'M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.8 13.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8l.8-13.2M10 10.5v6M14 10.5v6',
  search: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15.5 15.5l5 5',
  plus: 'M12 5v14M5 12h14',
  sync: 'M20 11a8 8 0 0 0-14.2-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.2 4.2L20 15.5M20 20v-4.5h-4.5',
  lock: 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  unlock: 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  monitor: 'M3.5 5h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 20.5h7M12 17v3.5',
  sidebar: 'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM9.5 4.5v15',
  focus: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
  list: 'M4 6.5h16M4 12h16M4 17.5h16',
  compact: 'M4 5h16M4 9.5h16M4 14h16M4 18.5h16',
  sort: 'M7 4.5v15M7 19.5l-3-3M7 19.5l3-3M17 19.5v-15M17 4.5l-3 3M17 4.5l3 3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4.5V8H7M12 7.5V12l3 2',
  copy: 'M9 9h10.5a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM15.5 9V4.5a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1V15a1 1 0 0 0 1 1H8',
  template: 'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM3.5 10h17M10 10v9.5',
  download: 'M12 4v11M7.5 11 12 15.5 16.5 11M4.5 19.5h15',
  upload: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 19.5h15',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.5-2.2-.5-1.2.3-2.3 1.6-2.3H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.8 3.5 12 3.5zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  folder: 'M3.5 6.5a1 1 0 0 1 1-1H10l2 2.5h7.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z',
  mic: 'M12 14.5a3 3 0 0 0 3-3v-6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v4',
  pencil: 'M4 20l1-4.5L16.5 4a1.5 1.5 0 0 1 2.1 0l1.4 1.4a1.5 1.5 0 0 1 0 2.1L8.5 19zM14.5 6l3.5 3.5',
  clip: 'M19 11.5l-7 7a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7-7',
  calendar: 'M5.5 5.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM4.5 10h15M8.5 3.5v4M15.5 3.5v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
