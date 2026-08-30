'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const APP_STORE_URL = 'https://apps.apple.com/app/vibexstudio/id6779501769';
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/B7xNVhhF';

const navItems = [
  ['01', 'STUDIO', '#studio'],
  ['02', 'FLOW', '#flow'],
  ['03', 'LOCAL', '#local'],
  ['04', 'SHARE', '#share'],
] as const;

const localStops = [
  { figure: '0', unit: 'CLOUD', caption: 'LOCAL PROJECT FILES' },
  { figure: '0', unit: 'TRACKERS', caption: 'NO ANALYTICS OR TELEMETRY' },
  { figure: '100', unit: '% YOURS', caption: 'USER-OWNED PROJECTS' },
  { figure: '1', unit: 'TAP', caption: 'PREVIEW ON THE DEVICE' },
];

const capabilities = [
  { index: '01', word: 'PROMPT', sentence: 'TURN INTENT INTO WORKING FILES.' },
  { index: '02', word: 'PREVIEW', sentence: 'SEE EVERY CHANGE ON THE DEVICE.' },
  { index: '03', word: 'PUBLISH', sentence: 'SHARE THROUGH GITHUB PAGES WHEN READY.' },
];

const indexRows = [
  ['WORKSPACE', 'IPHONE'],
  ['PROJECTS', 'LOCAL FILES'],
  ['AI', 'YOUR PROVIDER'],
  ['PREVIEW', 'WEBVIEW'],
  ['PUBLISH', 'GITHUB PAGES'],
  ['TELEMETRY', 'NONE'],
] as const;

function FixedNavigation({ active }: { active: number }) {
  return (
    <>
      <nav className={active === 4 ? 'nav nav-final' : 'nav'} aria-label="Primary navigation">
        <a className="nav-brand" href="#studio" aria-label="VibeXStudio, back to beginning">
          <Image src="/icon.png" alt="" width={44} height={44} priority />
          <span>VX</span>
        </a>
        <ul className="nav-links t-label">
          {navItems.map(([number, label, href], index) => (
            <li className="nav-idx" key={number}>
              <a className={active === index + 1 ? 'is-active' : ''} href={href}>
                {number} {label}
              </a>
            </li>
          ))}
          <li>
            <a className="nav-enter" href="#enter">
              ENTER ↗
            </a>
          </li>
        </ul>
      </nav>
      <div className="rail" aria-hidden="true">
        <span className="rail-fill" />
        <span className="rail-index t-label">{String(active).padStart(2, '0')}</span>
      </div>
    </>
  );
}

export default function LaunchFilm() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(1);
  const [loaderValue, setLoaderValue] = useState(0);

  useEffect(() => {
    let destroyed = false;
    let lenis: Lenis | null = null;
    let ticker: ((time: number) => void) | null = null;
    let context: gsap.Context | null = null;
    let media: gsap.MatchMedia | null = null;
    let syncChromeListener: (() => void) | null = null;

    const init = async () => {
      if (!root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      await document.fonts.ready;
      if (destroyed || !root.current) return;

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const html = document.documentElement;
      html.classList.add('js');
      html.classList.toggle('has-motion', !reduced);

      if (!reduced) {
        html.classList.add('is-locked');
        const counter = { value: 0 };
        gsap.to(counter, {
          value: 100,
          duration: 0.9,
          ease: 'power2.inOut',
          onUpdate: () => setLoaderValue(Math.round(counter.value)),
        });
        gsap
          .timeline({
            onComplete: () => {
              html.classList.remove('is-locked');
              ScrollTrigger.refresh();
            },
          })
          .to('.loader-line', { scaleX: 1, duration: 0.85, ease: 'power2.inOut' })
          .to('.loader', { yPercent: -100, duration: 0.45, ease: 'power3.inOut' }, 0.98)
          .set('.loader', { display: 'none' });

        lenis = new Lenis({ duration: 1.05, smoothWheel: true, wheelMultiplier: 0.9 });
        lenis.on('scroll', ScrollTrigger.update);
        ticker = (time: number) => lenis?.raf(time * 1000);
        gsap.ticker.add(ticker);
        gsap.ticker.lagSmoothing(0);
      }

      context = gsap.context(() => {
        gsap.set('.deco', { visibility: 'visible' });

        const sections = gsap.utils.toArray<HTMLElement>('.scene');
        let chromeScene: HTMLElement | null = null;
        const syncChrome = () => {
          const viewportCenter = window.innerHeight / 2;
          const nearest = sections.reduce<{ scene: HTMLElement; distance: number } | null>((best, scene) => {
            const rect = scene.getBoundingClientRect();
            const distance = rect.top <= viewportCenter && rect.bottom >= viewportCenter
              ? 0
              : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter));
            return !best || distance < best.distance ? { scene, distance } : best;
          }, null)?.scene;
          if (!nearest || nearest === chromeScene) return;
          chromeScene = nearest;
          setActive(Number(nearest.dataset.nav ?? 1));
          html.dataset.sceneTheme = nearest.dataset.theme ?? 'dark';
        };
        syncChromeListener = syncChrome;
        window.addEventListener('scroll', syncChrome, { passive: true });
        ScrollTrigger.create({
          trigger: root.current,
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: syncChrome,
          onRefresh: syncChrome,
        });
        syncChrome();

        gsap.to('.rail-fill', {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
        });

        media = gsap.matchMedia();
        media.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
          gsap
            .timeline({
              scrollTrigger: { trigger: '.scene-hero', start: 'top top', end: '+=180%', pin: true, scrub: 0.8 },
            })
            .from('.hero-meta > *', { clipPath: 'inset(0 100% 0 0)', stagger: 0.08, duration: 0.35 })
            .to('.hero-vibe', { xPercent: -118, duration: 1.1 }, 0.35)
            .to('.hero-sub, .hero-meta, .hero-cue, .scene-hero .scene-tag', { opacity: 0, duration: 0.35 }, 0.65)
            .to('.hero-x', { scale: 10, xPercent: -5, transformOrigin: 'center center', duration: 1.4 }, 0.75)
            .to('.hero-rule', { scaleX: 0.04, xPercent: 48, duration: 0.9 }, 0.9);

          gsap
            .timeline({
              scrollTrigger: { trigger: '.scene-inx', start: 'top top', end: '+=180%', pin: true, scrub: 0.85 },
            })
            .from('.inx-plane-a', { xPercent: -46, duration: 1 }, 0)
            .from('.inx-plane-b', { xPercent: 46, duration: 1 }, 0)
            .from('.inx-line > span', { yPercent: 110, stagger: 0.14, duration: 0.7 }, 0.25)
            .from('.inx-frag', { scale: 2.2, rotate: 18, opacity: 0, duration: 1.1 }, 0.1)
            .from('.inx-measure', { opacity: 0, x: -60, duration: 0.55 }, 0.35)
            .to('.inx-lines', { xPercent: 12, duration: 0.75 }, 1.15)
            .fromTo('.inx-exit-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.8 }, 1.15);

          const track = document.querySelector<HTMLElement>('.local-track');
          if (track) {
            gsap
              .timeline({
                scrollTrigger: { trigger: '.scene-local', start: 'top top', end: '+=320%', pin: true, scrub: 0.9 },
              })
              .fromTo('.local-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.3 })
              .to(track, { x: () => -(track.scrollWidth - window.innerWidth), ease: 'none', duration: 2.9 }, 0.2)
              .to('.local-wipe', { yPercent: -115, duration: 0.75 }, 2.7);
          }

          const capSteps = gsap.utils.toArray<HTMLElement>('.caps-step');
          gsap.set(capSteps.slice(1), { autoAlpha: 0, yPercent: 18 });
          const caps = gsap.timeline({
            scrollTrigger: { trigger: '.scene-caps', start: 'top top', end: '+=300%', pin: true, scrub: 0.8 },
          });
          capSteps.forEach((step, index) => {
            const previousStep = capSteps[index - 1];
            if (previousStep) {
              caps.to(previousStep!, { autoAlpha: 0, yPercent: -18, duration: 0.45 });
              caps.to(step, { autoAlpha: 1, yPercent: 0, duration: 0.55 }, '<0.1');
            }
            caps.fromTo(step.querySelector('.caps-word'), { xPercent: index % 2 ? 30 : -30 }, { xPercent: 0, duration: 0.5 }, '<');
            caps.to('.caps-rule', { scaleX: (index + 1) / capSteps.length, duration: 0.4 }, '<');
          });

          const rows = gsap.utils.toArray<HTMLElement>('.xdex-row');
          const xdex = gsap.timeline({
            scrollTrigger: { trigger: '.scene-xdex', start: 'top top', end: '+=220%', pin: true, scrub: 0.75 },
          });
          rows.forEach((row, index) => {
            xdex.call(() => rows.forEach((item, itemIndex) => item.classList.toggle('is-live', itemIndex === index)));
            xdex.to('.xdex-rows', { y: -index * 2, duration: 0.25 });
          });
          xdex.to('.xdex-row', { y: (index: number) => (2.5 - index) * 26, opacity: 0, stagger: 0.025, duration: 0.7 });
          xdex.fromTo('.xdex-collapse', { scaleX: 0 }, { scaleX: 1, duration: 0.55 }, '<0.1');

          gsap
            .timeline({
              scrollTrigger: { trigger: '.scene-climax', start: 'top top', end: '+=210%', pin: true, scrub: 0.85 },
            })
            .from('.climax-stage', { scale: 8, xPercent: -25, transformOrigin: '35% 45%', duration: 1.2 })
            .from('.climax-line > span', { yPercent: 110, stagger: 0.12, duration: 0.55 }, 0.45)
            .to('.climax-stage', { scale: 0.82, transformOrigin: 'left center', duration: 0.65 }, 1.1)
            .fromTo('.climax-final', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 1.5)
            .to('.climax-stage', { autoAlpha: 0, duration: 0.25 }, 1.5)
            .fromTo('.climax-flood', { scaleX: 0 }, { scaleX: 1, duration: 0.45 }, 1.75);
        });

        media.add('(max-width: 767px) and (prefers-reduced-motion: no-preference)', () => {
          gsap.from('.hero-word', { xPercent: -14, scrollTrigger: { trigger: '.scene-hero', start: 'top top', end: 'bottom top', scrub: 0.8 } });
          gsap.from('.inx-line > span', { yPercent: 100, stagger: 0.1, scrollTrigger: { trigger: '.scene-inx', start: 'top 70%', end: 'center center', scrub: 0.7 } });
          gsap.utils.toArray<HTMLElement>('.local-stop').forEach((stop) => {
            gsap.from(stop, { xPercent: 16, opacity: 0.25, scrollTrigger: { trigger: stop, start: 'top 85%', end: 'center 55%', scrub: 0.65 } });
          });
          gsap.utils.toArray<HTMLElement>('.caps-step').forEach((step) => {
            gsap.from(step.querySelector('.caps-word'), { xPercent: -18, scrollTrigger: { trigger: step, start: 'top 80%', end: 'center 50%', scrub: 0.65 } });
          });
          gsap.from('.climax-stage', { scale: 2.4, transformOrigin: '30% center', scrollTrigger: { trigger: '.scene-climax', start: 'top bottom', end: 'center center', scrub: 0.8 } });
        });
      }, root);

      ScrollTrigger.refresh();
    };

    void init();

    return () => {
      destroyed = true;
      document.documentElement.classList.remove('is-locked', 'has-motion', 'js');
      media?.revert();
      context?.revert();
      if (ticker) gsap.ticker.remove(ticker);
      if (syncChromeListener) window.removeEventListener('scroll', syncChromeListener);
      lenis?.destroy();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return (
    <main ref={root}>
      <a className="skip-link" href="#studio">Skip to the studio story</a>

      <div className="loader" aria-hidden="true">
        <div className="loader-brand t-head"><span>VIBEX</span><span>STUDIO</span></div>
        <div className="loader-line" />
        <div className="loader-pct t-label">INITIALIZING {String(loaderValue).padStart(3, '0')}%</div>
        <div className="loader-meta t-label"><span>LOCAL SYSTEM</span><span>STUDIO.VIBEX.APP</span></div>
      </div>

      <FixedNavigation active={active} />

      <section className="scene scene-hero" id="studio" data-theme="dark" data-nav="1" aria-labelledby="hero-title">
        <span className="scene-tag t-label">01 / THE STUDIO</span>
        <h1 id="hero-title" className="hero-word t-mega" aria-label="VibeXStudio">
          <span className="hero-vibe">VIBE</span><span className="hero-x hx">X</span>
        </h1>
        <div className="hero-sub"><span className="hero-studio t-head">STUDIO</span><span className="t-label">BUILD THE WEB<br />FROM YOUR IPHONE</span></div>
        <div className="hero-rule" />
        <div className="hero-meta t-label"><span>LOCAL-FIRST / NO ACCOUNT</span><span>YOUR AI / YOUR GITHUB</span><span>STATIC WEB APPS / REAL FILES</span></div>
        <div className="hero-cue t-label">SCROLL TO ENTER</div>
      </section>

      <section className="scene scene-inx" id="flow" data-theme="paper" data-nav="2" aria-labelledby="flow-title">
        <span className="scene-tag t-label">02 / INSIDE THE X</span>
        <div className="inx-plane inx-plane-a deco" aria-hidden="true"><div className="bar" /></div>
        <div className="inx-plane inx-plane-b deco" aria-hidden="true"><div className="bar" /></div>
        <span className="inx-frag t-mega deco" aria-hidden="true">X</span>
        <div className="inx-measure deco t-label" aria-hidden="true" style={{ left: '6%', top: '27%' }}><span className="tick" />X / 36.08°</div>
        <div className="inx-measure deco t-label" aria-hidden="true" style={{ right: '8%', bottom: '22%' }}>DEVICE / LOCAL<span className="tick" /></div>
        <h2 id="flow-title" className="inx-lines t-mega">
          <span className="inx-line"><span>THINK</span></span>
          <span className="inx-line"><span>MAKE</span></span>
          <span className="inx-line"><span>SHIP</span></span>
          <span className="inx-line"><span>THE WHOLE IDEA</span></span>
        </h2>
        <div className="inx-exit-rule deco" aria-hidden="true" />
      </section>

      <section className="scene scene-local" id="local" data-theme="paper" data-nav="3" aria-labelledby="local-title">
        <span className="scene-tag t-label">03 / LOCAL-FIRST</span>
        <h2 id="local-title" className="sr-only">Local-first by design</h2>
        <div className="local-rule deco" aria-hidden="true" />
        <div className="local-track">
          {localStops.map((stop) => (
            <article className="local-stop" key={`${stop.figure}-${stop.unit}`}>
              <p className="local-figure t-mega"><span>{stop.figure}</span><span className="unit">{stop.unit}</span></p>
              <p className="local-caption t-label">{stop.caption}</p>
            </article>
          ))}
        </div>
        <div className="local-wipe deco" aria-hidden="true" />
      </section>

      <section className="scene scene-caps" data-theme="dark" data-nav="2" aria-labelledby="caps-title">
        <span className="scene-tag t-label">04 / FROM IDEA TO LINK</span>
        <h2 id="caps-title" className="sr-only">Prompt, preview, and publish capabilities</h2>
        <div className="caps-steps">
          {capabilities.map((capability) => (
            <article className="caps-step" key={capability.index}>
              <span className="caps-index t-mega" aria-hidden="true">{capability.index}</span>
              <div className="caps-word-mask"><h3 className="caps-word t-mega">{capability.word}</h3></div>
              <p className="caps-sentence">{capability.sentence}</p>
            </article>
          ))}
        </div>
        <div className="caps-rule deco" aria-hidden="true" />
      </section>

      <section className="scene scene-xdex" data-theme="dark" data-nav="3" aria-labelledby="index-title">
        <span className="scene-tag t-label">05 / X INDEX</span>
        <h2 id="index-title" className="sr-only">VibeXStudio product index</h2>
        <span className="xdex-x t-mega deco" aria-hidden="true">X</span>
        <dl className="xdex-rows">
          {indexRows.map(([term, value]) => (
            <div className="xdex-row" key={term}><dt>{term}</dt><dd className="val">{value}</dd></div>
          ))}
        </dl>
        <div className="xdex-collapse deco" aria-hidden="true" />
      </section>

      <section className="scene scene-climax" data-theme="signal" data-nav="4" aria-labelledby="climax-title">
        <span className="scene-tag t-label">06 / THE WORKING STUDIO</span>
        <div className="climax-grid deco" aria-hidden="true">{[20, 40, 60, 80].map((left) => <i key={left} style={{ left: `${left}%` }} />)}</div>
        <h2 id="climax-title" className="climax-stage t-mega">
          <span className="climax-line"><span>NOT A CHAT</span></span>
          <span className="climax-line"><span>WINDOW.</span></span>
          <span className="climax-line"><span>A WORKING</span></span>
          <span className="climax-line"><span>STUDIO.</span></span>
        </h2>
        <p className="climax-final t-mega deco" aria-hidden="true"><span className="word">VIBEXSTUDIO</span></p>
        <div className="climax-flood deco" aria-hidden="true" />
      </section>

      <section className="scene scene-enter" id="enter" data-theme="dark" data-nav="4" aria-labelledby="enter-title">
        <span className="scene-tag t-label">07 / ENTER</span>
        <div className="enter-mark"><Image src="/icon.png" alt="VibeX neon-script app icon" width={88} height={88} /><span className="t-head">VIBEXSTUDIO</span></div>
        <h2 id="enter-title" className="enter-title t-mega">BUILD FROM<br />ANYWHERE.</h2>
        <p className="enter-tag t-head">YOUR IDEA. YOUR FILES. YOUR LINK.</p>
        <div className="enter-actions">
          <a className="enter-cta" href={APP_STORE_URL} rel="noreferrer">ENTER VIBEXSTUDIO ↗</a>
          <a className="enter-alt t-label" href={TESTFLIGHT_URL} rel="noreferrer">JOIN TESTFLIGHT ↗</a>
        </div>
        <p className="enter-footnote t-label">IPHONE / LOCAL-FIRST / BRING YOUR AI PROVIDER / NO TELEMETRY</p>
        <footer className="enter-meta t-label"><span>VIBEXSTUDIO © 2026</span><span>STUDIO.VIBEX.APP</span><span>AUTOMATED AI SOLUTIONS LLC</span></footer>
        <div className="enter-x" aria-hidden="true"><span className="t-mega">X</span></div>
      </section>
    </main>
  );
}
