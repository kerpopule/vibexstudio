/** Permission defaults are scoped to the exact server being edited. */
export type PermissionChoice = {origin:string; allowed:boolean};
export function generationChoice(origin:string|null, requestedOrigin:string|null,
  choice:PermissionChoice|null, saved:PermissionChoice|null):boolean {
  if (!origin) return false;
  if (choice?.origin === origin) return choice.allowed;
  if (requestedOrigin === origin) return true;
  return saved?.origin === origin && saved.allowed;
}
