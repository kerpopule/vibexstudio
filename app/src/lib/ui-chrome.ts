/**
 * App-chrome switches shared between screens and the tab pill. The Media
 * Lab tab hides the VibeX tab pill while Cut (or an older studio page that
 * still has its own bottom nav) needs the whole window — two floating pills
 * stacked on each other was the alternative.
 */
import { create } from 'zustand';

interface UiChrome {
  tabPillHidden: boolean;
  setTabPillHidden: (hidden: boolean) => void;
}

export const useUiChrome = create<UiChrome>((set) => ({
  tabPillHidden: false,
  setTabPillHidden: (hidden) => set({ tabPillHidden: hidden }),
}));
