# Media Lab Image Template Collection — source notice

This local collection includes prompt records and example preview images from:

- **Project:** [freestylefly/awesome-gpt-image-2](https://github.com/freestylefly/awesome-gpt-image-2)
- **Reviewed commit:** `3a9c63baa03e6bbe2f28c89a2654cf9845466646`
- **Project code/data license:** MIT; see [`LICENSE`](./LICENSE).

The Media Lab browser and chat integration are a custom implementation, not a raw port of the source application.

## Third-party-content warning

The source project says it organizes publicly accessible community prompts and example images for learning, research, methodology study, and automated model testing. It claims no ownership of third-party original content. Source labels and URLs are retained on each case where supplied.

**The MIT license for the repository does not by itself guarantee commercial rights to every third-party prompt or image. Treat these examples as research/learning references. Before commercial use, review the original source and obtain permission from the applicable original author or rightsholder.**

The source project specifically credits public content from [YouMind](https://youmind.com/) and [OpenNana](https://opennana.com/) and asks rightsholders to contact that project when a listing should be corrected or removed.

Some remaining examples show real public figures or brand names and logos. They are here only as layout and prompt references; they are not endorsements, and nothing here grants a right to use a person's likeness or a trademark.

## Provenance rules

This folder ships in a public repository, so every case must be one we may redistribute.

1. **Traceable source.** Every case keeps its original author label and a link to where it was published (`sourceLabel`, plus `githubUrl` for upstream cases or `sourceUrl` for local additions).
2. **Upstream cases** come only from the reviewed commit above, unchanged apart from translation.
3. **Local additions** (`"provenance": "media-lab-local"`) need a `rightsNote` that says the author allows public redistribution. A record marked private, research-only, "no redistribution", "no publication" or "non-commercial" does not belong here; keep it in a studio's own gitignored overlay (`config/local/`, see `docs/LOCAL-OVERLAY.md`).
4. **No franchise characters or franchise branding.** A case may not show, name, cosplay or mock up a character, title screen, logo or game interface from a film, TV, anime, manga, comic or game franchise, even when the prompt only has a placeholder. Style words ("in an anime style", "Pixar-like lighting") are fine; a named character or franchise is not.
5. **Removal requests win.** If an author or rightsholder asks, the case comes out in the next release, no questions asked.

`tests/test_image_template_static_contract.py` enforces rules 1 to 4 for the cases that ship.

## Removed for rights reasons

These case ids from the reviewed commit (and one local addition) were taken out and must not be re-added:

| Case | Why |
|---|---|
| 24 | Cosplay of a Genshin Impact character (miHoYo) |
| 25 | Minecraft skin sheet (Mojang/Microsoft game art) |
| 43 | Game of Thrones characters (HBO) |
| 52 | Labelled as a Vagabond manga character (Takehiko Inoue) |
| 84 | Demon Slayer character map (Koyoharu Gotouge / Shueisha) |
| 85 | Naruto character map (Masashi Kishimoto / Shueisha) |
| 86 | Bleach character map (Tite Kubo / Shueisha) |
| 87 | Dragon Ball character map (Akira Toriyama / Shueisha) |
| 91 | Minecraft title and game art (Mojang/Microsoft) |
| 112 | Saint Seiya Gold Saints (Masami Kurumada / Toei) |
| 125 | Nazuna Nanakusa, Call of the Night (Kotoyama / Shogakukan) |
| 143 | The Amazing World of Gumball house set (Cartoon Network) |
| 145 | Prompt names the Terminator T-800; the upstream record's prompt does not match its image |
| 146 | Mai Shiranui, The King of Fighters (SNK); prompt names the Terminator T-800 |
| 147 | Prompt names the Terminator T-800; the upstream record's prompt does not match its image |
| 148 | Terminator T-800 (Terminator franchise) |
| 161 | Grand Theft Auto VI screenshot mock-up (Rockstar Games) |
| 166 | Saint Seiya Gold Saints (Masami Kurumada / Toei) |
| 174 | Xenomorph from the Alien films (20th Century Studios) |
| 197 | League of Legends game screen (Riot Games) with real politicians |
| 207 | Black Myth game branding (Game Science) |
| 241 | Naruto character map (Masashi Kishimoto / Shueisha) |
| 250 | The Little Prince character co-branded with SpaceX |
| 251 | The Garden of Words film branding (Makoto Shinkai / CoMix Wave) |
| 282 | Cosplay of a Honkai: Star Rail character (miHoYo) |
| 287 | Mai Shiranui, The King of Fighters (SNK) |
| 299 | JoJo's Bizarre Adventure character (Hirohiko Araki / Shueisha) |
| 301 | Terminator T-800 (Terminator franchise) |
| 309 | Tom from Tom and Jerry (Warner Bros.) |
| 527 | Anime franchise character; local record marked private research, no publication or redistribution |
