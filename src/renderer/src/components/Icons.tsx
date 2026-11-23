import type { ReactNode } from 'react';

/** 16 px line icons in the current text colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Speech bubble with a plus: a new conversation. */
export const ChatIcon = () => (
  <Icon>
    <path d="M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2z" />
    <path d="M8 5.5v3.5M6.25 7.25h3.5" />
  </Icon>
);

/** Folder with a plus: a new project folder. */
export const NewProjectIcon = () => (
  <Icon>
    <path d="M1.75 4.25v8h12.5v-6.5h-6.5l-1.5-1.5z" />
    <path d="M8 7.25v3.5M6.25 9h3.5" />
  </Icon>
);

/** Folder with a return arrow: back to existing work. */
export const ExistingProjectIcon = () => (
  <Icon>
    <path d="M1.75 4.25v8h12.5v-6.5h-6.5l-1.5-1.5z" />
    <path d="M10 10.25H6.5M7.75 8.75l-1.5 1.5 1.5 1.5" />
  </Icon>
);

/** Ruled page: the shared ground rules. */
export const RulesIcon = () => (
  <Icon>
    <path d="M3.5 1.75h6.5l2.5 2.5v10h-9z" />
    <path d="M5.75 7h4.5M5.75 9.25h4.5M5.75 11.5h3" />
  </Icon>
);
