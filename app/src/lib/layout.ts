export type WorkspaceLayout = 'compact' | 'wide';

/** iPad and desktop-class windows get a two-column workspace. */
export function workspaceLayoutForWidth(width: number): WorkspaceLayout {
  return width >= 760 ? 'wide' : 'compact';
}
