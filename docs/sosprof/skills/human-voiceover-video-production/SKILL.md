---
name: "human-voiceover-video-production"
description: "Use for every video I make for Elios (Elios Academy, SOSProf.net, Formatic Academy or any brand): ads, Reels, tutorials, explainers, demos. Strategy, style, script first, silent visuals, human voice only, never AI narration."
---

# Premium short-form video production system (all brands)

Permanent workflow: **IDEA → CREATIVE STRATEGY → TUNISIAN SCRIPT → SILENT VISUAL PRODUCTION → USER'S VOICE RECORDING → FINAL EDIT → EXPORT.**

This skill is the shared base for every video skill: `educational-capsule-video`, `premium-educational-video-editor`, `educational-documentary-video` and `educational-smart-cuts`. Specialised skills add technique; these rules always win. Platform tutorials (website/app walkthroughs) have no separate skill: they follow §10 of this skill.

The sections below are the reference library. Each one has the name of its reference file:
- `video-duration-strategy`
- `viral-video-styles`
- `human-voiceover-policy`
- `higgsfield-workflow`
- `short-form-storyboard`
- `brand-video-guidelines`
- `platform-tutorial-workflow`

---

## 1. Production phases (follow in order)
1. **Creative strategy.** Brand, audience, marketing objective, chosen style (§3, with one sentence on why), recommended duration (§2), the one main message.
2. **Script.** A recording script plus a technical storyboard (§5).
3. **Silent visual production.** Use Higgsfield or code/editing tools (§6). Use no speech at all. Music and SFX go on a separate track. Provisional subtitles are labelled provisional.
4. **The user's voice recording.** Wait for it. Never fill the gap with a synthetic voice.
5. **Final sync.** Retime the scenes, animation, subtitles, music and SFX to the real recording (§4, §8).
6. **Export.** The MP4 plus source assets (§9). A narrated video is never "complete" before the user's voice is in it.

If the user asks for visuals before recording, deliver phase 3 as a **silent draft** and say so.

## 2. video-duration-strategy
Durations are guidelines, not limits.

| Objective | Duration | Priorities |
|---|---|---|
| Awareness / viral | 15–30 s | Hook in the first 1–2 s, immediate visual story, one message, dynamic pacing, short memorable CTA |
| Promotional ad | 15–30 s | Emotional story, Problem → Solution → Benefit → CTA, strong visual contrast, authentic customer situations, elegant motion. It should feel like social content, not a TV ad. |
| Tutorial / educational explainer | 30–60 s | Real screen recordings, clear steps, smooth UI zooms, highlighted buttons, animated pointer, readable subtitles. It may exceed 60 s if the flow needs it; never trade clarity for length. |

Speech budget for Tunisian Derja: about 2.2–2.5 words/s.
- A 15 s video holds about 25–30 words.
- A 30 s video holds about 55–65 words.
- A 60 s video holds about 110–130 words.

Leave 0.3–0.6 s of breathing room between scenes. Never overload short videos.

## 3. viral-video-styles
For each request, pick the style that fits the objective. Don't reuse one cinematic template every time.

| # | Style | Best for | Structure | Visual/tech notes |
|---|---|---|---|---|
| 1 | Split Screen: Before vs After | Showing the platform's value fast | 0–2 s split appears; left "without" (grey, slow), right "with" (brand colours, smooth); swap/merge; CTA | Two synced halves, a strong colour contrast, a labelled divider, the same character on both sides |
| 2 | POV: relatable scenario | Awareness, students | "POV: …" text in 1 s; first-person situation; twist/relief with the product; CTA | Handheld-feel camera, on-screen text as inner voice, quick cuts |
| 3 | Micro-storytelling | Emotional promos, parents | Character + problem (0–5 s) → turning point → result → brand → CTA | Consistent characters (Higgsfield references), 3–5 shots, a gentle camera |
| 4 | Premium motion graphics / 3D | Brand launch, feature overview | Kinetic headline → floating device/UI → feature beats → logo reveal | Floating phones, glass spheres, advanced easing; use 3D sparingly |
| 5 | Screen recording + UI motion (full method in §10) | Tutorials, demos | Hook → step badges → zooms, highlights, pointer clicks → result → CTA | Real captures only, blur personal data, safe zones |
| 6 | Relatable comedy / mini-skit | Viral reach | Setup → exaggerated pain → punchline with the product → CTA | Expressive characters, timing beats, light SFX; no mocking real people |
| 7 | Curiosity gap / unexpected reveal | Stopping the scroll | An intriguing question or statement → build-up → reveal → CTA | Withhold the answer until 60–70 % of the runtime, then a visual "click" on the reveal |
| 8 | Interactive challenge / quiz | Engagement, comments | Question on screen → timer → answer reveal (or "answer in comments") → CTA | Big readable question, countdown, a pause for the viewer |
| 9 | Authentic talking head / UGC | Trust, testimonials, teacher voice | The user (or a real person) on camera → B-roll/UI inserts → CTA | Real footage only; never fake testimonials or AI faces posing as real customers |
| 10 | Behind the scenes / day in the life | Brand warmth, teachers | Morning → work moments → result → CTA | Natural light, warm grade, real or clearly illustrated scenes |

## 4. human-voiceover-policy (absolute)
- Never use AI narration, TTS, voice cloning, synthetic dialogue, automatic narrators or placeholder speech, in any tool: Higgsfield, ElevenLabs, edge-tts, Kokoro, editors and so on.
- Allowed: music, ambience and nonverbal SFX, kept on separate tracks from the narration.
- The user records. Accept MP3/WAV/M4A/MP4 and extract to WAV 48 kHz.
- Analyse the recording:
  - Measure the duration and pauses (silencedetect -35 dB / 0.12 s).
  - Transcribe with faster-whisper (word timestamps) and correct it against the script, keeping what was actually said.
- Clean the voice gently:
  - High-pass 70–80 Hz.
  - Light denoise and de-hum only if needed.
  - Subtle EQ and 2–3:1 compression.
  - Loudness consistent, no clipping.
  - Never alter pitch, accent, gender presentation or identity.
- If a line is wrong or unusable, name it (time and text) and ask for a re-record. Never regenerate any part of the voice.
- Exceptions only if the user explicitly asks in that conversation.

## 5. short-form-storyboard (script templates)

**A. Recording script** (ready to read):
- Natural Tunisian Derja (unless another language is asked), short conversational sentences, a strong first line, a clear CTA.
- One numbered line per scene with its target seconds.
- Delivery notes: tone, smile, energy, and the **bold** words to stress.
- Pause marks: `/` short, `//` long.
- Pronunciation notes for brand and French words (e.g. SOSProf.net = "SOS-Prof point net").
- Recording tips: a quiet room, phone 15–20 cm from the mouth, one file per line or one take with 1 s gaps.

**B. Technical storyboard** (table): scene #, start–end, VO text, estimated speech time, visual, camera movement, animation, on-screen text, SFX, transition, tone, pauses.

The scene timing must fit the narration without rushing.

**Provisional subtitles** (SRT from the script and planned timings) are clearly labelled provisional. Never claim they are synced to a recording that does not exist yet.

## 6. higgsfield-workflow
- Before production, inspect the Higgsfield tools/models (`models_explore`), credits and preferences.
- Use Higgsfield for:
  - characters (a reference sheet per character, then keyframes from those references)
  - image-to-video (e.g. Kling 3.0 std, 5 s, 9:16, **sound off**)
  - cinematic camera moves and dynamic scenes
- Always disable audio, speech and dialogue. Add "no speech, no dialogue, no narration, no lip-sync talking" to prompts, and check the outputs for synthetic voice.
- Keep characters consistent: the same reference images, outfits and palette in every prompt. Check frames from each clip side by side.
- Use code/editing tools instead of Higgsfield when precision matters: real UI screens, kinetic typography, logo reveals, subtitles. A video model would redraw the UI and invent details.
- Submit jobs one at a time if a batch fails on credits.
- Use the Higgsfield sandbox (`sandbox_exec`) for ffmpeg and Playwright renders:
  - Input: presigned PUT from the user's PC, then `media_confirm`.
  - Output: `media_upload`, then `curl PUT` in the same command (no If-None-Match header for general files), then `media_confirm`.
  - Then the PC downloads from the CDN URL.
- If Higgsfield is unavailable, say exactly what's missing before using another tool. Never claim it was used.

## 7. brand-video-guidelines (never mix brands)

| Brand | Colours | Assets and look |
|---|---|---|
| Elios Academy | Navy #23356e, orange #f49e1f, green #7ba25b | Official Elios logo, modern educational style, professional Arabic typography, Tunisian students and classrooms. The capsule house style is in `educational-capsule-video`. |
| SOSProf.net | Blue #004ABD, yellow #FEB00C, white (measured from the official logo) | Official SOSProf.net logo, brand name written exactly "SOSProf.net", real app.sosprof.net screenshots, Tunisian student/parent/teacher scenarios, modern EdTech motion (floating phones, glass spheres, kinetic Arabic type) |
| Formatic Academy | From its official assets/guidelines; measure the colours from the logo if no guide exists | Never borrow the other brands' palette or logo |

**SOSProf.net content pillars (SOSProf.net only):** every SOSProf.net video is planned against one of its six permanent pillars (01 Student Problems, 02 Platform Features, 03 Teacher Recruitment, 04 Educational Value, 05 Trust & Community, 06 Parents & Guidance). In the strategy step, name the pillar, the audience side (students & parents or teachers), the objective and its KPI, then pick the style from the library above. A pillar is not a style: any compatible style can serve any pillar. Teachers are a customer audience in their own right. Rules, hooks and allocation are in `references/sosprof-six-pillars.md`. Keep the existing SOSProf.net visual system and the vertical-video positioning in §8 unchanged. None of this applies to Elios Academy or other brands.

- Never invent features, profiles, ratings, prices, testimonials or results.
- Never guarantee grades or income.
- Blur real users' personal data.
- Ask before showing named real people in paid ads.

## 8. Quality bar and subtitles
- Show professional art direction, visual hierarchy, eased motion, consistent typography, smooth and varied transitions, consistent characters, purposeful camera moves, clean composition, designed audio and animated subtitles.
- Avoid slideshows, static scenes, random stock footage, cluttered effects, uncanny characters, needless 3D, mixed fonts and repetitive transitions. Short never means lower quality.
- Subtitles after the recording:
  - Taken from the real transcript and precisely synced.
  - Tunisian expressions kept as spoken.
  - Correct Arabic RTL, with Latin runs isolated in `<bdi>`.
  - Keywords highlighted in the brand accent colour.
  - Kept inside mobile safe zones (top 250 px and bottom 380 px clear of UI; right edge clear of TikTok/Reels buttons).
  - **Light position adjustment (applies to every vertical video):** place subtitles slightly higher than in earlier edits (about 100 px higher, so they never sit near the bottom interface), and place the top logo, top branding and any top text slightly lower (about 60 px further from the top edge). Everything else (style, composition, animation, branding) stays as before.

## 9. Export and deliverables
- **Default:** 9:16, 1080×1920, 30 fps, H.264 MP4 + AAC 48 kHz.
- **Loudness:** −16 LUFS for social ads and −14 LUFS for educational lessons, true peak ≤ −1.5 dBTP, music ducked about 10–12 dB under speech.
- **Format:** mobile-first composition, Facebook/Instagram/TikTok safe zones, high-contrast subtitles, clear branding. 1:1 or 4:5 variants on request.
- **Deliver:**
  - final MP4 (or the silent draft before the recording)
  - separate voice / music+SFX / mix WAVs
  - SRT
  - storyboard with timestamps
  - editable source
  - QC report
- The QC report confirms:
  - strong first 2 s and one clear message
  - brand colours and logo
  - Arabic readability
  - subtitles match the speech
  - no fictional features
  - **no synthetic voice anywhere**
  - clear CTA
  - export specs measured with ffprobe and ebur128
- Never claim a file exists until it is verified on disk.

## 10. platform-tutorial-workflow (website/app tutorials)
The proven method from the SOSProf.net Forum and free-session tutorials. Use it for any "how to do X on the platform" video, for any brand. Duration 30–60 s (§2); longer only if the flow needs it.

**A. Capture the real platform first**
- Walk the real flow on the live site (e.g. app.sosprof.net) before writing the script. Note every tab, button and label exactly as written (keep French UI words as they appear: Suivre, Calendrier, Publier, Rejoindre la séance).
- Capture with Playwright or the user's browser at a phone viewport (430×932, DPR 3, so 1290×2796 PNG). Save a `.json` of element boxes next to each PNG so zooms, highlights and blurs hit the right spot.
- Logged-in screens: use the user's own already-signed-in browser or a test account they provide. Never type, store or ask for a password in chat.
- Never publish, comment, vote, pay, book or delete for real. Fill forms to show them, then clear them; if anything was changed (a follow, an upload), tell the user and how to undo it.
- Write `captures/notes.md`: the real flow step by step, what was verified, what could not be verified, and any real bugs seen (layout overflow, clipped sheets).
- Low-frame screen recordings are reference only; build the edit from the sharp PNG stills.

**B. Script and storyboard (§5)**
- One step per scene: Hook → Step 1…N → result → CTA. Each step names the exact button the viewer must tap.
- If one step is mandatory for the rest to work (e.g. "Suivre the teacher or the session won't appear in Calendrier"), say it in the voice, show a warning card on screen, and repeat it in the CTA.
- Only claim what the captures prove. Keep wording general where something wasn't verified, and list it under "Honest limitations" in the QC report.

**C. Visual system**
- Real screens inside a clean phone mock-up on a brand background, with gentle zoom/pan into the active area (ease-out, 0.4–0.8 s).
- Numbered step badges ("1", "2"…) with a short Derja label and emoji, e.g. "اعمل Suivre للأستاذ ✅".
- Tap highlight: a pulse ring plus an animated pointer on the exact button box; show the before/after state when the UI changes (e.g. Suivre → "✓ Abonné").
- Arrows to guide the eye from one element to the next (e.g. from Abonné to the Calendrier tab).
- Blur names, avatars and photos of real users and teachers unless they agreed. Ask before showing a named real person in a paid ad.
- CTA card: official logo, a 3-point recap of the steps, the website, brand colours only.
- Build all of this with code/editing tools (HTML/CSS overlays rendered with Playwright, ffmpeg). Never let a video model redraw the UI. Higgsfield is fine only for a short non-UI hook shot (character, sound off).

**D. Voice, sync and delivery**
- Deliver the recording script first, then a silent draft (music + SFX, provisional subtitles labelled provisional).
- When the user's recording arrives, cut scenes on the measured pauses, retime badges/taps to the words that name each button, and sync subtitles to the real transcript (§4, §8).
- Deliverables: final MP4, SRT, stems, captures folder with notes, storyboard, QC report with honest limitations, editable source (§9).