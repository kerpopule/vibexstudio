import { describe, expect, it } from 'vitest';
import { createPendingJobStore } from '@/lib/pending-job-store';
import { addPendingJob, matchFinishedJobs, retryPendingJob, type PendingMediaJob } from '@/lib/medialab-core';
const job = (serverUrl = 'https://spark.example'): PendingMediaJob => ({ serverUrl, jobId: 'same-id', projectId: 'p', targetPath: 'assets/win.mp4', kind: 'video', prompt: 'win', createdAt: Date.now() });

describe('server-bound pending jobs', () => {
  it('never matches another host or an unknown legacy origin by ID', () => {
    const own = job();
    const foreign = job('https://other.example');
    const legacy = { ...job(), serverUrl: undefined };
    const malformed = job('not a URL');
    const result = matchFinishedJobs([own, foreign, legacy, malformed], [{id:'same-id', status:'done', url:'/media/win.mp4'}], 'https://spark.example/');
    expect(result.resolved.map(x => x.job)).toEqual([own]);
    expect(result.remaining).toEqual([foreign, legacy, malformed]);
  });
  it('keeps coinciding job IDs from separate hosts and projects', () => {
    const list = addPendingJob(addPendingJob([job()], job('https://other.example')), {...job(), projectId:'second'});
    expect(list).toHaveLength(3);
  });
  it('preserves all existing pending jobs when the queue grows beyond 100', () => {
    const pending = Array.from({length:100}, (_,i)=>({...job(),jobId:String(i)}));
    expect(addPendingJob(pending, job())).toHaveLength(101);
  });
  it('does not expire an offline host based on another host poll', () => {
    const old = {...job(), createdAt:0};
    expect(matchFinishedJobs([old], [], 'https://other.example').remaining).toEqual([old]);
  });
});

describe('pending persistence', () => {
  it('preserves a submission racing with result settlement and persists retry counts', async () => {
    let saved = JSON.stringify([job()]);
    const store = createPendingJobStore({getItem:async()=>saved, setItem:async(_k,v)=>{saved=v;}}, 'jobs');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release=resolve; });
    const settling = store.update(async jobs => { await gate; return {jobs:jobs.map(j=>retryPendingJob(j)!), result:'retry'}; });
    const submitting = store.update(jobs => ({jobs:addPendingJob(jobs, job('https://other.example')), result:'submitted'}));
    release();
    expect(await Promise.all([settling, submitting])).toEqual(['retry','submitted']);
    const stored = await store.read();
    expect(stored).toHaveLength(2);
    expect(stored[0].attempts).toBe(1);
  });
  it('leaves corrupt stored data intact instead of replacing it with an empty list', async () => {
    let saved = '{broken';
    const store = createPendingJobStore({getItem:async()=>saved, setItem:async(_k,v)=>{saved=v;}}, 'jobs');
    await expect(store.update(()=>({jobs:[],result:null}))).rejects.toThrow();
    expect(saved).toBe('{broken');
  });
  it('reports write failures and allows the next operation to recover', async () => {
    let fail = true;
    let saved = '[]';
    const store = createPendingJobStore({getItem:async()=>saved, setItem:async(_k,v)=>{if(fail)throw Error('disk full');saved=v;}}, 'jobs');
    await expect(store.update(()=>({jobs:[job()],result:null}))).rejects.toThrow('disk full');
    fail=false;
    await store.update(()=>({jobs:[job()],result:null}));
    expect(await store.read()).toHaveLength(1);
  });
});
