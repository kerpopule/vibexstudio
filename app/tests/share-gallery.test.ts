import {afterEach,expect,it,vi} from 'vitest';
const sharing=vi.hoisted(()=>({available:vi.fn(),share:vi.fn()}));
vi.mock('expo-sharing',()=>({isAvailableAsync:sharing.available,shareAsync:sharing.share}));
import {shareGalleryFile as nativeShare} from '@/lib/share/share-gallery';
import {shareGalleryFile as browserShare} from '@/lib/share/share-gallery.web';
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it('shares the existing native file with its audio MIME type and propagates a failed chooser',async()=>{
 sharing.available.mockResolvedValue(true);sharing.share.mockResolvedValue(undefined);
 const item={id:'song',uri:'file:///app/song.wav',mimeType:'audio/wav'};
 await nativeShare(item);expect(sharing.share).toHaveBeenCalledWith(item.uri,{mimeType:'audio/wav',dialogTitle:'Save or share your creation'});
 sharing.share.mockRejectedValue(Error('Chooser failed'));await expect(nativeShare(item)).rejects.toThrow('Chooser failed');
});
it('does not hand remote URLs to the native share sheet or hide unavailable sharing',async()=>{
 await expect(nativeShare({id:'song',uri:'https://example.com/song.wav',mimeType:'audio/wav'})).rejects.toThrow('local file');
 expect(sharing.share).not.toHaveBeenCalled();sharing.available.mockResolvedValue(false);
 await expect(nativeShare({id:'song',uri:'file:///song.wav',mimeType:'audio/wav'})).rejects.toThrow('unavailable');
});
it('downloads embedded browser media and always removes its temporary link',async()=>{
 const anchor={href:'',download:'',style:{display:''},click:vi.fn(),remove:vi.fn()},appendChild=vi.fn();
 vi.stubGlobal('document',{createElement:()=>anchor,body:{appendChild}});
 await browserShare({id:'song',uri:'data:audio/wav;base64,UklGRg==',mimeType:'audio/wav'});
 expect(anchor.download).toBe('vibex-song.wav');expect(anchor.click).toHaveBeenCalledTimes(1);expect(anchor.remove).toHaveBeenCalledTimes(1);
 anchor.click.mockImplementation(()=>{throw Error('download unavailable');});
 await expect(browserShare({id:'song',uri:'data:audio/wav;base64,UklGRg==',mimeType:'audio/wav'})).rejects.toThrow('download unavailable');
 expect(anchor.remove).toHaveBeenCalledTimes(2);
});
