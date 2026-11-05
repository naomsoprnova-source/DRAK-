# WAR LEGENDS — Game Development Brief

> Arabic-first, fully offline, 3D tactical arena strategy game for Android.

## Vision

Build an original military-fantasy strategy game inspired by the lane-based, card-driven tactical battles of Clash Royale, with a grounded modern-war setting and high-quality realistic presentation. The visual target is *inspired by* the character detail, lighting, materials, animation quality, and environmental fidelity of modern AAA remakes; do not claim or attempt to reproduce a specific game's assets or proprietary content.

## Non-negotiable requirements

- Fully playable offline after installation. No account, server, online matchmaking, ads, or network dependency.
- Arabic user interface with right-to-left layout.
- Arabic voice dialogue between original characters. Include subtitles and a text fallback if voice assets are unavailable.
- Original characters, story, maps, audio, names, and art. Do not copy protected assets, logos, dialogue, or maps from other games.
- Android build with scalable graphics settings and reliable performance on supported RedMagic devices. Detect device capabilities and offer Low / Medium / High / Ultra presets rather than assuming every device can sustain 60 FPS.
- Save campaign progress locally and safely.

## Core gameplay

Create real-time 3D arena battles. The player builds a deck/army before battle and deploys units using a regenerating command-energy resource. Units move, acquire targets, fight, and use abilities autonomously. Battles include destructible defensive structures and clear win/loss conditions.

Initial playable vertical slice:
1. One polished battlefield with two opposing bases and defensive structures.
2. At least six distinct unit types: infantry, heavy infantry, sniper, engineer, armored vehicle, and commander.
3. A working deployment/card interface and regenerating energy.
4. Enemy AI that deploys units, defends, and attacks.
5. Unit pathfinding, targeting, health, damage, cooldowns, and basic abilities.
6. Battle start, victory, defeat, pause, and restart flows.
7. Local save for campaign progress and unlocked units.
8. Arabic UI, subtitles, and several voiced battle callouts.

## World and campaign

Create an original fictional conflict involving several factions. Build a connected single-player campaign with chapters, missions, named commanders, character relationships, twists, and consequences. Keep the narrative coherent across missions. Add more maps only after the vertical slice is stable.

Potential environments: ruined city, desert outpost, mountain pass, forest base, fortified harbor, and ancient fortress adapted as a military stronghold. Each map should have distinct tactical layout and visual identity.

## Characters, units, and equipment

Each unit needs a readable battlefield role, original visual identity, stats, animations, sound effects, upgrade path, and balanced strengths/weaknesses. Weapons and vehicles should be fictionalized or used only as generic visual references; avoid real-world operational instructions.

## Arabic dialogue

Use natural, professionally written Arabic dialogue. Characters should have distinct voices and personalities. Include short contextual lines during combat and fully subtitled story scenes. Support Modern Standard Arabic as the default, with optional regional flavor where appropriate. Never rely on generated placeholder audio in the final release.

Example:
- القائد: «استعدوا! رُصد تحرّك معادٍ قرب البوابة الشرقية.»
- الجندي: «وصلت التعزيزات، سيدي. ننتظر أوامرك.»
- القائد: «ثبّتوا مواقعكم واحموا القلعة!»

## Technical direction

Choose the engine based on a working Android performance prototype. Prefer a lightweight scalable pipeline; evaluate Unity URP or Godot for the first vertical slice. Use Unreal Engine only if the team can demonstrate acceptable Android performance and asset-memory budgets on the target device. Do not select an engine solely because it is associated with AAA graphics.

Required engineering:
- Modular architecture for battle simulation, units, cards, AI, campaign, UI, audio, and save system.
- Object pooling for frequently spawned units and effects.
- Level-of-detail models, texture compression, baked lighting where appropriate, occlusion culling, and scalable effects.
- Touch controls designed for phones and Arabic RTL layout.
- Offline asset delivery; no remote asset bundles required.
- Automated tests for battle rules, save/load, and progression.
- Crash-safe local saves and graceful handling of low memory.

## Visual quality and performance

Aim for realistic proportions, detailed materials, expressive faces, high-quality animation, convincing lighting, and readable combat effects. Use original/licensed assets only. Provide graphics presets and an FPS limiter. Measure frame time, memory, battery use, and thermal behavior on actual target hardware. Treat 60 FPS as a goal, not a guarantee.

## Deliverables

1. A complete source repository with project files and reproducible build instructions.
2. A playable Android vertical-slice APK.
3. Source assets or a clear inventory of licensed third-party assets and their licenses.
4. Arabic UI and dialogue/subtitle assets.
5. Unit tests and a test report.
6. Performance report from a real Android device.
7. A roadmap separating implemented features from planned features.

## Work order

**Milestone 1 — Prototype:** implement one complete offline battle with two bases, six unit types, energy/deployment, enemy AI, victory/defeat, Arabic UI, and local save.

**Milestone 2 — Polish:** improve character models, animation, lighting, VFX, audio, touch UX, and performance.

**Milestone 3 — Campaign:** add story chapters, missions, Arabic voice scenes, progression, unlocks, and additional maps.

**Milestone 4 — Release:** test on real devices, fix crashes and performance issues, document the build, and produce a signed APK.

## Instructions to the coding agent

Do not stop after writing a plan, mockup, or static UI. Inspect the repository, implement the first playable milestone in working code, run available tests/builds, and report exact results. Never claim a feature or APK exists unless it has actually been implemented and verified. If a requirement cannot be completed, state the blocker and provide the next concrete step.
