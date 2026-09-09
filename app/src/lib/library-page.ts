/** Bound rendered cards while search and folders still operate on the full catalog. */
export const LIBRARY_PAGE_SIZE = 24;
export function libraryPage<T>(items:readonly T[],requestedPage:number) {
  const pages=Math.max(1,Math.ceil(items.length/LIBRARY_PAGE_SIZE));
  const page=Math.min(pages-1,Math.max(0,Number.isFinite(requestedPage)?Math.floor(requestedPage):0));
  const start=page*LIBRARY_PAGE_SIZE;
  return {items:items.slice(start,start+LIBRARY_PAGE_SIZE),page,pages,
    first:items.length?start+1:0,last:Math.min(items.length,start+LIBRARY_PAGE_SIZE),total:items.length};
}
