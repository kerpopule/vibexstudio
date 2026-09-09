import {it,expect} from 'vitest';
import {toQR} from 'toqr';
import {makeTransferQR,readTransferQR,TRANSFER_QR_LIMIT} from '../src/lib/connection-transfer/qr';
const file=JSON.stringify({format:'vibex/encrypted-ai-connections',version:1,cipher:'AES-256-GCM',data:'A'.repeat(400)}),key='a'.repeat(64);
it('preserves canonical ciphertext and key without a URL, route or server',()=>{
 const qr=makeTransferQR(file,key)!;
 expect(readTransferQR(qr)).toEqual({file,unlockCode:key});
 expect(qr).not.toContain('://');
 const matrix=toQR(qr,0);expect(Number.isInteger(Math.sqrt(matrix.length))).toBe(true);expect(new Set(matrix)).toEqual(new Set([0,1]));
});
it('bounds rendered QR payloads and rejects unrelated/malformed scanned codes',()=>{
 const large=file.replace('A'.repeat(400),'A'.repeat(TRANSFER_QR_LIMIT*2));expect(makeTransferQR(large,key)).toBeNull();
 for(const value of ['https://example.test','vibex://pair?url=example','vibex-ai-setup-v1:'+key+':bad','vibex-ai-setup-v1:'+key+'!'+'A'.repeat(400),'x'.repeat(TRANSFER_QR_LIMIT+1)])expect(()=>readTransferQR(value)).toThrow();
 expect(()=>makeTransferQR(file,'invalid')).toThrow();
});
