import {mimeFor} from '@/lib/media-mime';

const IDEAS = {
  image: {emoji:'🖼️',prompt:'Build a website using an image already saved in this project as its hero image.'},
  video: {emoji:'🎮',prompt:'Build a simple game that plays a video already saved in this project when the player wins.'},
  audio: {emoji:'🎵',prompt:'Build a music player for audio already saved in this project.'},
  model: {emoji:'🧊',prompt:'Build an interactive 3D viewer using a model already saved in this project.'},
};

/** Suggestions depend only on file types, never claims about unseen media contents. */
export function projectMediaIdeas(paths: string[]) {
  const kinds = new Set(paths.map(path => mimeFor(path).split('/')[0]));
  return Object.entries(IDEAS).filter(([kind]) => kinds.has(kind)).map(([,idea]) => idea);
}
