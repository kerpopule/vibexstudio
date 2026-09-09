import {expect,it} from 'vitest';
import {projectMediaIdeas} from '@/lib/project-media-ideas';
it('offers relevant reuse prompts for imported media without inspecting contents',()=>{
 const ideas=projectMediaIdeas(['assets/photo.png','assets/another.jpg','assets/win.webm','assets/music.flac','assets/scene.glb','index.html']);
 expect(ideas).toHaveLength(4);
 expect(ideas.every(idea=>idea.prompt.includes('already saved in this project'))).toBe(true);
 expect(ideas.some(idea=>idea.prompt.includes('when the player wins'))).toBe(true);
});
it('leaves ordinary new-project ideas available for source-only projects',()=>{
 expect(projectMediaIdeas(['index.html','styles.css','app.js'])).toEqual([]);
});
