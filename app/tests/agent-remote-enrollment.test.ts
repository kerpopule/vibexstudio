import {describe,it,expect} from 'vitest';
import {parseRemoteEnrollment,remoteSetupRequest} from '../src/lib/agent-connect/remote';
const config={version:1,host:'spark.example.test',user:'vibex_tunnel',sshPort:22,remotePort:19841,hostKey:'ssh-ed25519 AAAA',devicePublicKey:'ssh-ed25519 BBBB'};
describe('remote enrollment boundary',()=>{
 it('passes only recognized public configuration fields',()=>{
  expect(parseRemoteEnrollment(JSON.stringify({...config,privateKey:'must not propagate',command:'must not execute'}))).toEqual(config);
 });
 it('rejects malformed and oversized exchange data',()=>{
  for(const text of ['null','[]','{','x'.repeat(16301)])expect(()=>parseRemoteEnrollment(text)).toThrow();
 });
 it('rejects endpoint injection and invalid ports before invoking native code',()=>{
  for(const patch of [{host:'-oProxyCommand=evil'},{host:'server\nelsewhere'},{host:'https://server'},{user:'root;echo'},{remotePort:80},{remotePort:65536},{sshPort:0},{sshPort:'22'},{hostKey:'ssh-ed25519 AAAA\ncommand'}]){
   expect(()=>parseRemoteEnrollment(JSON.stringify({...config,...patch}))).toThrow();
  }
 });
 it('keeps server setup separate from pairing and limits server access',()=>{
  const request=remoteSetupRequest(config.devicePublicKey);
  expect(request).toContain(config.devicePublicKey);
  expect(request).toContain('not an agent pairing token');
  expect(request).toContain('both the per-device authorized key and matching sshd policy');
  expect(request).toContain('desktop must remain open');
  expect(request).toContain('Never return private keys or passwords');
 });
});
