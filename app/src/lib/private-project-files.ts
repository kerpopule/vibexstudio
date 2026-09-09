/** Planning notes travel in full backups, never in code-only shares. */
export const DIRECTOR_HISTORY_PATH='Notes/Sparky.json';
export function isPrivateProjectFile(path:string){
 return path.replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase()===DIRECTOR_HISTORY_PATH.toLowerCase();
}
