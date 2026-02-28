# ListenHacks — Relational Sonification for Shopify Analytics (Project Spec)

> Goal: build an embedded Shopify Admin demo that proves a novel analytics interaction: **hearing relationships between commerce metrics** (alignment, divergence, lag, regime shifts) via clean, intuitive audio that **augments** visuals (not replaces them).

---

## 1. Product Thesis

### 1.1 Core principle
Audio is **not** a replacement for visual analytics. Audio adds a **new perceptual dimension** optimized for:
- temporal structure (rhythm/regularity),
- stability vs instability,
- alignment vs mismatch,
- lead–lag timing.

Visual = precision and inspection.  
Audio = rapid pattern recognition and structural change sensing.

### 1.2 What we’re building
An **embedded Shopify Admin app** that overlays an **auditory relational layer** on top of time-series analytics, with interaction designed like a real analytics tool:
- zoom into a time window,
- compare and scrub,
- loop a selection,
- hear how two metrics behave **together**.

---

## 2. Why we pivoted (key learnings)

### 2.1 “Sounding cool” is not enough
A sonification can sound “cool” because of sound design, not because it’s informative. For Shopify judges, it must read as an **analytics instrument**, not abstract audio art.

### 2.2 The first demo sounded “alien”
We implemented a rich mapping (correlation + divergence detune/noise + lag delay + regime distortion) over a 180-day time range compressed into ~20 seconds. Result: perceptual overload.
**Root causes:**
- too many auditory channels changing simultaneously,
- rapid parameter updates (no stability),
- waveform switching and distortion created harsh timbre,
- long horizon compressed too fast for ears to form expectations.

### 2.3 Time scale matters
Audio is best for **local** structure and change. A single compressed playback of 180 days is rarely intuitive.
We need:
- interactive zoom and selection,
- short windows (14–60 days) for clear listening,
- stable baselines + high-contrast changes.

### 2.4 “Real Shopify data only” isn’t practical for a sprint
Bulk dummy order generation inside Shopify is slow (e.g., 30 min at 30%).
Trying to force all demo structure from Shopify data increases risk.
We must allow a hybrid approach:
- Shopify integration for legitimacy,
- deterministic dataset(s) for reliable structural demonstrations.

---

## 3. Target personas

### 3.1 Analyst (dashboard-native)
Wants:
- comparisons (this period vs that),
- relationship inspection (traffic vs sales, cart vs checkout),
- change detection and lead–lag cues.

### 3.2 CEO / operator (quick overview)
Wants:
- “are we aligned/healthy?”
- “is something off?”
- fast, low-cognitive-load insight.

We will prioritize analyst-grade interaction (zoom/scrub/compare), with optional “executive summary” later.

---

## 4. Core Product Concept: Relational Sonification

### 4.1 Definition
Relational sonification maps **relationships between metrics** to sound structure, not raw metric magnitude.

Instead of:
- metric → sound,

we do:
- relationship(metric A, metric B) → sound properties.

### 4.2 Why it’s commerce-first
Commerce insights are often relational:
- traffic ↑ but sales ↔ (quality mismatch),
- add-to-cart ↑ but checkout ↓ (leak),
- spend ↑ but revenue ↓ (efficiency),
- inventory oscillations vs sales (control loop instability).

---

## 5. Data Strategy (Hybrid MVP)

### 5.1 Shopify integration requirements (legitimacy)
Must run as an embedded Admin app. Must have **some real Shopify data path**:
- fetch orders (order count, revenue),
- show it in-app,
- demonstrate the app is truly inside Shopify Admin.

### 5.2 Demo dataset requirements (reliability)
For the relational audio to be intuitive, we need deterministic structural regimes:
- aligned window,
- divergence window,
- lag window,
- regime shift window.

### 5.3 MVP hybrid approach
Two modes (explicit):
1. **Live Shopify Mode**
   - pull daily order_count and revenue from Admin API
   - show graphs
   - (optional) compute correlation between two Shopify-derived series

2. **Demo Dataset Mode (Feasibility + reliable narrative)**
   - deterministic 60–180 day synthetic dataset with known regimes
   - powers audio/visual alignment, divergence, lag, regime shifts
   - used to validate mapping and demo reliably

> Notes:
- We tried “all data inside Shopify” via dummy data generator app; it was too slow and too random to guarantee clean relational regimes.
- Hybrid is necessary for sprint feasibility and demo reliability.

---

## 6. Interactive Analytics UX (must-have)

### 6.1 Graph-native selection (brush)
Primary interaction is direct on the chart:
- drag handles to set start/end (integer day indices),
- drag inside selection to pan window,
- click to set playhead,
- click-drag to scrub playhead.

Sliders / numeric inputs may exist for fine-tune, but brush is primary.

### 6.2 Zoom + focus
- selection defines analysis window,
- “Zoom to selection” and “Reset” buttons,
- enforce minimum selection length >= 7 days.

### 6.3 Playback constrained to selection
- play within selection window,
- loop selection by default,
- speed control (ms/day),
- audio and visuals must be synchronized.

### 6.4 Playhead
- vertical line on chart + optional marker dots at series values,
- click to seek,
- drag to scrub,
- audio updates smoothly with ramps to avoid pops.

---

## 7. The “Math Toolbox” we actually ship (MVP subset)

We have a larger toolbox, but MVP implements only the highest ROI, shippable pieces:

### 7.1 Preprocessing
- z-score normalization per window:
  - \tilde{x}_t = (x_t - \mu_x) / \sigma_x
  - \tilde{y}_t = (y_t - \mu_y) / \sigma_y
- optional EMA smoothing of relational metrics (for stability)

### 7.2 Relational metrics
1. **Rolling Pearson correlation**
   - \rho_t = corr(\tilde{x}_{t-w+1:t}, \tilde{y}_{t-w+1:t})

2. **Divergence energy**
   - d_t = |\tilde{x}_t - \tilde{y}_t|
   - optional EMA smoothing: \bar d_t = EMA(d_t)

3. **Lead–lag estimate via cross-correlation**
   - c_t(ℓ) = corr(\tilde{x}_{t-w+1:t}, \tilde{y}_{t-w+1+ℓ:t+ℓ})
   - ℓ*_t = argmax_{ℓ ∈ [-L, L]} c_t(ℓ)

4. **Regime shift marker (simple change-point heuristic)**
   - Δρ_t = ρ_t - ρ_{t-1}
   - trigger if |EMA(Δρ_t)| > θ
   - (for MVP, markers can be pre-defined in demo dataset)

---

## 8. Audio System Design (locked-in improvements)

### 8.1 Non-negotiable perceptual rules
We learned the baseline sounded messy. Fixes are now policy:

1) **No waveform switching** based on correlation state  
2) **No distortion** as part of correlation mapping  
3) Correlation encoded **only** via interval (pitch ratio)  
4) Use **smoothing + hysteresis** to prevent jitter/flapping  
5) Use **attack/release + frequency ramps** to avoid clicks/pops  
6) Update chord state slower than playhead (hold time / cadence)  
7) Modular layers, **OFF by default** except harmony

### 8.2 Audio layers
- **Harmony (default ON):** correlation → consonance interval
- **Tension (optional):** divergence → subtle gain shading (not detune)
- **Echo (optional):** lag → small delay ONLY if lag ≥ 2 days (avoid “spacey”)
- **Events (optional):** regime shift → short “tick” earcon (not distortion)

### 8.3 Core harmony mapping
- base frequency f0 = 220 Hz
- oscillator A at f0
- oscillator B at f0 * ratio

Discrete correlation states:
- corr > 0.7 → perfect fifth (3/2)
- 0.3–0.7 → major third (5/4)
- -0.3–0.3 → unison (1)
- corr < -0.3 → tritone-ish (sqrt(2) or 45/32)

Stability:
- EMA smoothing of correlation:
  - rhoE[t] = 0.8*rhoE[t-1] + 0.2*rho[t]
- hysteresis thresholds:
  - enter fifth if rhoE > 0.75; leave if rhoE < 0.65
  - enter third if rhoE > 0.35; leave if rhoE < 0.25
  - enter tritone if rhoE < -0.35; leave if rhoE > -0.25
  - else unison
- chord update cadence: every 2–3 days or min hold duration

Click-free audio:
- gain attack: 40ms
- gain release: 120ms
- frequency ramp: 50–80ms on changes

---

## 9. Visual Pairing Design

### 9.1 Visual elements
- main chart: two series (traffic x, sales y)
- correlation strip chart beneath
- selection overlay (inside vs outside)
- regime shift marker (vertical dashed line)
- divergence highlight (soft red fill)
- playhead vertical line (+ optional markers)

### 9.2 Visual–audio synchronization
Changes must align:
- chord changes align with correlation state change,
- divergence highlight aligns with tension layer,
- lag indicator aligns with echo layer,
- regime marker aligns with event earcon.

---

## 10. Dataset spec (feasibility demo dataset)

### 10.1 Deterministic 180-day dataset (initial)
Four regimes:
- Region A (0–59): correlated + mild seasonality
- Region B (60–89): divergence (traffic spike, sales flat)
- Region C (90–129): lag (sales follows traffic after 3 days)
- Region D (130–179): regime shift (conversion drop)

Equations:
- A: x = 100 + 20*sin(2πt/14), y = 0.05x + N(0,3)
- B: x = 250 + 30*sin(2πt/7),  y = constant-ish + N(0,3)
- C: x = 120 + 25*sin(2πt/14), y = 0.05*x[t-3] + N(0,3)
- D: x = 110 + 15*sin(2πt/14), y = 0.02x + N(0,3)

### 10.2 Scale guideline
For intuitive listening, do not autoplay huge horizons. Use:
- short selection windows: 14–60 days
- interactive zoom and looping
- recommended speeds:
  - baseline: ~800–1000 ms/day
  - divergence: ~500 ms/day
  - lag: ~900–1200 ms/day
  - regime marker: ~1200–1600 ms/day (±5 days)

---

## 11. Demo plan (4 minutes, revised)

### 0:00–0:45 — Intuitive hook
- show Traffic vs Sales
- play harmony in aligned window
- “when aligned it sounds harmonious; when mismatch, dissonant”

### 0:45–1:30 — Divergence
- zoom into divergence window
- hear tension (optional layer)
- show divergence shading

### 1:30–2:30 — Lag
- zoom into lag window
- enable echo layer
- show detected lag value

### 2:30–3:20 — Regime shift
- zoom around regime marker
- play event earcon at shift
- show before/after pattern

### 3:20–4:00 — Generalization + Shopify tie-in
- show pairing dropdown (future: cart→checkout, spend→revenue)
- show “Live Shopify mode” pulling orders/revenue (legitimacy)

---

## 12. Implementation scope (hackathon MVP)

### Must ship
- Embedded Shopify Admin app skeleton
- Demo dataset mode with interactive brush + playhead
- Rolling correlation computation on selection window
- Clean Harmony-only audio (per locked-in rules)
- Optional toggles for tension/echo/events (off by default)
- Jump buttons: Calibrate (Region A), Divergence, Lag, Shift

### Nice-to-have
- Live Shopify data mode:
  - fetch daily order_count and revenue via Admin API
  - show on same chart
  - allow switching to demo dataset

### Explicitly out-of-scope (MVP)
- heavy DSP/music synthesis
- multi-metric orchestra sonification
- PCA/UMAP/clustering/graphs/text signals
- full forecasting models
- “all data inside Shopify” large-scale order generation

---

## 13. Success criteria

### Perceptual success (most important)
- Region A sounds calm and stable (not messy)
- divergence window produces an immediate audible contrast
- lag feels like timing offset when enabled
- regime marker produces a clearly noticeable event

### Demo success
- user can select 20-day window and instantly understand what they’re hearing
- audio changes align with visible changes
- Shopify judges believe it could live inside Admin analytics

---

## 14. Next steps checklist (pre-hackathon)
- [ ] Implement locked-in audio simplification (no waveform switching, no distortion)
- [ ] Add EMA + hysteresis + chord hold
- [ ] Ensure brush selection is primary UX
- [ ] Add playhead seek/scrub with smooth ramps
- [ ] Add jump-to-region buttons + recommended speed presets
- [ ] (Optional) wire a minimal Shopify orders endpoint to prove integration