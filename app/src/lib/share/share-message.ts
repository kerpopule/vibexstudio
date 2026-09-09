import {GET_APP_URL} from '@/lib/github/sharePage';

export function shareMessageFor(name: string): string {
  return (
    `I made “${name}” in VibeXStudio ⚡ Open the attached .vibex file on your iPhone, iPad, or Mac to play it and remix it. ` +
    `Don’t have the app (or not sure what to do with the file)? ${GET_APP_URL}`
  );
}

