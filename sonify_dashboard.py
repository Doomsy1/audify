#!/usr/bin/env python3
"""
Sales Follow Traffic — Sonification
=====================================
One idea: revenue always follows traffic by 1-2 days.

Two bar charts show it visually.
One button lets you hear it.

AUDIO
  LEFT  = traffic: warm organ pad, pitch rises with sessions.
  RIGHT = revenue echo: chorus (3 layers), muffled, reverb — arrives lag_days later.
  Echo LOUD = converting well.  Echo FAINT = funnel leak.

CONTROLS
  Sound: Continuous  — smooth gliding theremin-style tone across all 30 days
  Sound: Per-Day     — one plucked note per day; the gap between left/right = lag
  Ticks: On/Off      — soft woodblock click every day so you can count the lag
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.animation import FuncAnimation
from matplotlib.widgets import Button
import threading, time, os, subprocess, tempfile

try:
    from scipy.io import wavfile
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

try:
    import sounddevice as sd
    HAS_SOUNDDEVICE = True
except ImportError:
    HAS_SOUNDDEVICE = False

# Match device sample rate — AirPods use 48000, not 44100
def _detect_sr():
    try:
        dev = sd.query_devices(sd.default.device[1]
                               if hasattr(sd.default.device, '__len__')
                               else sd.default.device)
        return int(dev["default_samplerate"])
    except Exception:
        return 48000

SAMPLE_RATE = _detect_sr()


# ─────────────────────────────────────────────
# 1. DATA
# ─────────────────────────────────────────────
def generate_data(seed=42):
    np.random.seed(seed)
    days = np.arange(30)

    weekly  = 1 + 0.3 * np.sin(2 * np.pi * days / 7 + 1.0)
    trend   = 1 + days * 0.015
    noise   = np.random.lognormal(0, 0.10, 30)
    sessions = (1400 * weekly * trend * noise).astype(int)

    sessions[10:13] = (sessions[10:13] * 3.2).astype(int)
    sessions[18:23] = (sessions[18:23] * 1.9).astype(int)
    sessions[25]    = int(sessions[25] * 4.5)

    avg_order_value = 87.0
    conversion_rate = 0.034
    revenue = np.zeros(30)
    for day in range(30):
        revenue[day] = (
            0.30 * sessions[day] +
            0.50 * sessions[max(0, day - 1)] +
            0.20 * sessions[max(0, day - 2)]
        ) * avg_order_value * conversion_rate
    revenue += np.random.normal(0, revenue.std() * 0.05, 30)
    revenue = np.clip(revenue, 0, None)

    return days, sessions, revenue


# ─────────────────────────────────────────────
# 2. AUDIO
# ─────────────────────────────────────────────

AUDIO_DURATION = 18.0   # seconds for the full 30-day sweep


def _add_day_ticks(audio, total_samples):
    """Soft woodblock click at every day boundary in both channels.
    Lets you count ticks between a traffic spike and the echo that follows —
    that count is the lag in days."""
    click_dur  = int(0.018 * SAMPLE_RATE)
    click_t    = np.arange(click_dur) / SAMPLE_RATE
    click_wave = (np.exp(-click_t * 300.0) *
                  np.sin(2 * np.pi * 900.0 * click_t)) * 0.13
    spd = total_samples / 30.0
    for day_i in range(30):
        onset = int(day_i * spd)
        end   = min(onset + click_dur, total_samples)
        clen  = end - onset
        audio[onset:end, 0] += click_wave[:clen]
        audio[onset:end, 1] += click_wave[:clen]


def build_audio(sessions, revenue, lag_days=1, mode='continuous', ticks=True):
    """
    mode='continuous': smooth gliding theremin-style tone across all 30 days.
    mode='per-day':    one plucked pad note per day; echo arrives lag_days later.

    LEFT  = traffic (organ pad, pitch = sessions)
    RIGHT = revenue echo (chorus, muffled, more reverb)
    ticks=True: woodblock click every day to count lag.
    """
    from scipy.interpolate import interp1d
    from scipy.signal import butter, sosfilt

    total_samples = int(AUDIO_DURATION * SAMPLE_RATE)

    # ── Shared helpers ──────────────────────────────────────────────────
    def _lp(sig, cutoff_hz):
        sos = butter(2, min(cutoff_hz / (SAMPLE_RATE / 2), 0.99),
                     btype='low', output='sos')
        return sosfilt(sos, sig)

    def _reverb(sig, taps):
        out = sig.copy()
        for delay_ms, decay in taps:
            d = int(SAMPLE_RATE * delay_ms / 1000)
            if d < len(out):
                out[d:] += sig[:-d] * decay
        return out

    def _organ(phase):
        """Warm organ: heavy on fundamentals, fades toward upper harmonics."""
        return (1.00 * np.sin(phase) +
                0.50 * np.sin(2 * phase) +
                0.25 * np.sin(3 * phase) +
                0.10 * np.sin(4 * phase))

    def _bright(phase):
        """Bright string/synth: rising upper harmonics — clearly distinct from organ."""
        return (1.00 * np.sin(phase) +
                0.80 * np.sin(2 * phase) +
                0.60 * np.sin(3 * phase) +
                0.45 * np.sin(4 * phase) +
                0.30 * np.sin(5 * phase) +
                0.18 * np.sin(6 * phase))

    # ── Continuous mode ─────────────────────────────────────────────────
    if mode == 'continuous':
        day_x = np.arange(30, dtype=float)
        t_x   = np.linspace(0, 29, total_samples)
        t_arr = np.arange(total_samples) / SAMPLE_RATE

        s_smooth = np.clip(
            interp1d(day_x, sessions.astype(float), kind='cubic',
                     fill_value='extrapolate')(t_x), 1, None)
        r_smooth = np.clip(
            interp1d(day_x, revenue.astype(float), kind='cubic',
                     fill_value='extrapolate')(t_x), 0, None)

        s_log  = np.log1p(s_smooth)
        s_logn = (s_log - s_log.min()) / (s_log.max() - s_log.min() + 1e-9)
        freq   = 80.0 * (2.0 ** (3.0 * s_logn))   # 80–640 Hz, 3 octaves, exponential

        s_n   = (s_smooth - s_smooth.min()) / (s_smooth.max() - s_smooth.min() + 1e-9)
        amp_L = 0.25 + 0.55 * s_n

        rps   = r_smooth / (s_smooth + 1e-9)
        rps_n = (rps - rps.min()) / (rps.max() - rps.min() + 1e-9)

        # LEFT: organ pad + gentle vibrato + small room reverb
        vibrato  = 1.0 + 0.004 * np.sin(2 * np.pi * 5.2 * t_arr)
        phase_L  = np.cumsum(2 * np.pi * freq * vibrato / SAMPLE_RATE)
        signal_L = _lp(_organ(phase_L) * amp_L, 1000)
        signal_L = _reverb(signal_L, [(18, 0.20), (37, 0.12), (58, 0.07)])

        # RIGHT: driven by conversion rate data (its own graph), not traffic.
        # Pitch and amplitude both follow rps — so the ear tracks the right chart.
        rps_log  = np.log1p(rps)
        rps_logn = (rps_log - rps_log.min()) / (rps_log.max() - rps_log.min() + 1e-9)
        freq_R   = 80.0 * (2.0 ** (3.0 * rps_logn))   # same 3-octave range as left
        amp_R    = 0.25 + 0.55 * rps_n

        def _pad_c(fm):
            ph = np.cumsum(2 * np.pi * freq_R * fm / SAMPLE_RATE)
            return _bright(ph)
        chorus      = (_pad_c(1.000) + _pad_c(1.015) + _pad_c(0.985)) / 3.0
        echo_signal = _lp(chorus * amp_R, 2500)
        echo_signal = _reverb(echo_signal,
                              [(28, 0.45), (55, 0.32), (90, 0.20), (135, 0.12)])

        lag_samples = int(lag_days * (AUDIO_DURATION / 30) * SAMPLE_RATE)
        signal_R    = np.zeros(total_samples)
        signal_R[lag_samples:] = echo_signal[:total_samples - lag_samples]

    # ── Per-Day mode ─────────────────────────────────────────────────────
    else:
        s_log  = np.log1p(sessions.astype(float))
        s_logn = (s_log - s_log.min()) / (s_log.max() - s_log.min() + 1e-9)
        s_n    = ((sessions.astype(float) - sessions.min()) /
                  (sessions.max() - sessions.min() + 1e-9))
        rps      = revenue / (sessions.astype(float) + 1e-9)
        rps_n    = (rps - rps.min()) / (rps.max() - rps.min() + 1e-9)
        rps_log  = np.log1p(rps)
        rps_logn = (rps_log - rps_log.min()) / (rps_log.max() - rps_log.min() + 1e-9)

        signal_L = np.zeros(total_samples)
        signal_R = np.zeros(total_samples)
        spd      = total_samples / 30.0   # samples per day

        for day_i in range(30):
            onset = int(day_i * spd)
            blen  = int(spd * 0.72)       # 72% of slot = note, 28% = gap
            end   = min(onset + blen, total_samples)
            blen  = end - onset

            f_L  = 80.0 * (2.0 ** (3.0 * s_logn[day_i]))   # 80–640 Hz, 3 octaves
            a_L  = 0.25 + 0.55 * s_n[day_i]
            t_b  = np.arange(blen) / SAMPLE_RATE
            atk  = min(int(0.006 * SAMPLE_RATE), blen)

            # Pluck envelope: fast attack, exponential decay
            env_L = np.exp(-t_b * 3.2)
            env_L[:atk] = np.linspace(0, 1, atk)

            note_L = _lp(_organ(2 * np.pi * f_L * t_b) * a_L * env_L, 1000)
            signal_L[onset:end] += note_L

            # Echo lands lag_days slots later
            echo_day = day_i + lag_days
            if echo_day < 30:
                o_R   = int(echo_day * spd)
                e_R   = min(o_R + blen, total_samples)
                elen  = e_R - o_R
                t_e   = np.arange(elen) / SAMPLE_RATE
                # Driven by conversion rate data — its own pitch and amplitude
                f_R   = 80.0 * (2.0 ** (3.0 * rps_logn[day_i]))
                a_R   = 0.25 + 0.55 * rps_n[day_i]
                atk_e = min(int(0.006 * SAMPLE_RATE), elen)

                env_R = np.exp(-t_e * 2.2)   # slower decay — more bloom
                env_R[:atk_e] = np.linspace(0, 1, atk_e)

                # _bright timbre + wide chorus — clearly distinct from _organ left
                def _cho(fm, t=t_e, f=f_R):
                    return _bright(2 * np.pi * f * fm * t)

                chorus_d = (_cho(1.000) + _cho(1.015) + _cho(0.985)) / 3.0
                note_R   = _lp(chorus_d * a_R * env_R, 2500)
                note_R   = _reverb(note_R, [(28, 0.35), (55, 0.20)])
                signal_R[o_R:e_R] += note_R

    # ── Stereo mix ────────────────────────────────────────────────────────
    audio = np.zeros((total_samples, 2))
    audio[:, 0] = signal_L
    audio[:, 1] = signal_R

    # Normalise channels to different targets: echo (right) louder than traffic (left)
    for ch, target in enumerate([0.80, 0.80]):
        mx = np.max(np.abs(audio[:, ch]))
        if mx > 0:
            audio[:, ch] *= target / mx

    if ticks:
        _add_day_ticks(audio, total_samples)

    np.clip(audio, -1.0, 1.0, out=audio)
    return audio


# ─────────────────────────────────────────────
# 3. PLAYBACK
# ─────────────────────────────────────────────
_t0 = None

def play_async(audio):
    """Always write a WAV and play via afplay — simplest, most reliable on macOS."""
    global _t0

    def _run():
        global _t0
        try:
            arr = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            wavfile.write(tmp.name, SAMPLE_RATE, arr)
            tmp.close()
            print(f"   Audio file: {tmp.name}  ({arr.shape[0]/SAMPLE_RATE:.1f}s)")
            _t0 = time.time()
            result = subprocess.run(["afplay", tmp.name], capture_output=True)
            if result.returncode != 0:
                print(f"   afplay error: {result.stderr.decode()}")
            os.unlink(tmp.name)
        except Exception as e:
            print(f"   Playback error: {e}")
            _t0 = time.time()

    threading.Thread(target=_run, daemon=True).start()


# ─────────────────────────────────────────────
# 4. DASHBOARD
# ─────────────────────────────────────────────
EVENTS = {10: "Email\ncampaign", 18: "Paid\nsurge", 25: "Black\nFriday"}
EVENT_COLOR = "#FFD700"

def build_dashboard(days, sessions, revenue, audio, lag_days):
    fig, axes = plt.subplots(1, 2, figsize=(14, 6), facecolor="#0d0d0d")
    fig.subplots_adjust(left=0.07, right=0.96, top=0.88, bottom=0.22,
                        wspace=0.38)

    fig.suptitle("Sales Follow Traffic  —  30-Day Lag Sonification",
                 color="white", fontsize=14, fontweight="bold")

    ax_s, ax_r = axes

    # ── Traffic chart ─────────────────────────────────────────
    bar_colors_s = ["#FFD700" if d in EVENTS else "#29B6F6" for d in days]
    ax_s.bar(days, sessions, color=bar_colors_s, alpha=0.85, width=0.75)
    _style(ax_s)
    ax_s.set_title("Daily Traffic  (Sessions)", color="white", fontsize=11, pad=8)
    ax_s.set_xlabel("Day", color="#aaa", fontsize=9)
    ax_s.set_ylabel("Sessions", color="#29B6F6", fontsize=9)
    ax_s.tick_params(axis='y', colors="#29B6F6")

    for d, label in EVENTS.items():
        ax_s.annotate(label, xy=(d, sessions[d]),
                      xytext=(d, sessions[d] * 1.06),
                      color=EVENT_COLOR, fontsize=7, ha="center",
                      arrowprops=dict(arrowstyle="-", color=EVENT_COLOR, lw=0.8))

    # ── Conversion rate chart ──────────────────────────────────
    rps      = revenue / (sessions.astype(float) + 1e-9)
    rps_norm = (rps - rps.min()) / (rps.max() - rps.min() + 1e-9)

    cmap      = plt.cm.RdYlGn
    bar_cols  = [cmap(float(v)) for v in rps_norm]
    ax_r.bar(days, rps, color=bar_cols, alpha=0.88, width=0.75)
    _style(ax_r)
    ax_r.set_title(f"Conversion Rate  (revenue ÷ traffic)  =  echo volume",
                   color="white", fontsize=10, pad=8)
    ax_r.set_xlabel("Day", color="#aaa", fontsize=9)
    ax_r.set_ylabel("Revenue per Session  ($)", color="#66BB6A", fontsize=9)
    ax_r.tick_params(axis='y', colors="#66BB6A")

    sm = plt.cm.ScalarMappable(cmap=cmap,
                               norm=plt.Normalize(vmin=rps.min(), vmax=rps.max()))
    sm.set_array([])
    cb = fig.colorbar(sm, ax=ax_r, pad=0.02, fraction=0.04)
    cb.ax.tick_params(colors="#aaa", labelsize=7)
    cb.set_label("Conversion strength", color="#aaa", fontsize=7)

    for d, label in EVENTS.items():
        ax_r.annotate(label, xy=(d, rps[d]),
                      xytext=(d, rps[d] * 1.06),
                      color=EVENT_COLOR, fontsize=7, ha="center",
                      arrowprops=dict(arrowstyle="-", color=EVENT_COLOR, lw=0.8))

    # ── Scanning cursors ──────────────────────────────────────
    cursor_s = ax_s.axvline(x=-2, color="white", lw=1.8, alpha=0.9, zorder=10)
    cursor_r = ax_r.axvline(x=-2, color="white", lw=1.8, alpha=0.9, zorder=10)

    # ── Legend strip ──────────────────────────────────────────
    legend_ax = fig.add_axes([0.07, 0.09, 0.86, 0.06])
    legend_ax.axis("off")
    legend_ax.set_facecolor("#0d0d0d")
    legend_ax.text(
        0.5, 0.5,
        "LEFT = traffic  · organ pad  · pitch rises with sessions     "
        "RIGHT = revenue echo  · chorus + reverb  · arrives lag_days later     "
        "TICKS (if on) = 1 per day  · count ticks between spike and echo = lag",
        color="#cccccc", fontsize=8.5, ha="center", va="center",
        transform=legend_ax.transAxes, fontfamily="monospace"
    )

    # ── Mutable audio state ────────────────────────────────────
    # Rebuilt whenever the user toggles Sound or Ticks options.
    state = {'mode': 'continuous', 'ticks': True, 'audio': audio}

    def _rebuild():
        print(f"   Rebuilding audio  [mode={state['mode']}  ticks={state['ticks']}]...")
        state['audio'] = build_audio(sessions, revenue, lag_days=lag_days,
                                     mode=state['mode'], ticks=state['ticks'])
        print("   Done.")

    # ── Five buttons across the bottom (equal width, 0.01 gap) ───────────
    # [Sound: Continuous] [▶ Traffic] [▶ Both] [▶ Revenue] [Ticks: On]
    BW = 0.164   # button width  (5 × 0.164 + 4 × 0.01 = 0.86 = full span)
    BY, BH = 0.01, 0.07

    def _bx(i):
        return 0.07 + i * (BW + 0.01)

    # Sound mode toggle
    ax_mode  = fig.add_axes([_bx(0), BY, BW, BH])
    btn_mode = Button(ax_mode, "Sound: Continuous", color="#1a3a4a", hovercolor="#2a5a6a")
    btn_mode.label.set_color("white")
    btn_mode.label.set_fontsize(8)

    def on_mode(event):
        state['mode'] = 'per-day' if state['mode'] == 'continuous' else 'continuous'
        btn_mode.label.set_text(
            "Sound: Continuous" if state['mode'] == 'continuous' else "Sound: Per-Day")
        btn_mode.ax.set_facecolor("#1a3a4a" if state['mode'] == 'continuous' else "#3a2a4a")
        _rebuild()
        fig.canvas.draw_idle()

    btn_mode.on_clicked(on_mode)

    # ▶ Traffic (left channel only)
    ax_left  = fig.add_axes([_bx(1), BY, BW, BH])
    btn_left = Button(ax_left, "▶  Traffic", color="#1a3040", hovercolor="#29B6F6")
    btn_left.label.set_color("#29B6F6")
    btn_left.label.set_fontsize(9)

    # ▶ Both
    ax_both  = fig.add_axes([_bx(2), BY, BW, BH])
    btn_both = Button(ax_both, "▶  Both", color="#2a4a2a", hovercolor="#2d8c2d")
    btn_both.label.set_color("white")
    btn_both.label.set_fontsize(10)
    btn_both.label.set_fontweight("bold")

    # ▶ Revenue (right channel only)
    ax_right  = fig.add_axes([_bx(3), BY, BW, BH])
    btn_right = Button(ax_right, "▶  Revenue", color="#304030", hovercolor="#66BB6A")
    btn_right.label.set_color("#66BB6A")
    btn_right.label.set_fontsize(9)

    # Ticks toggle
    ax_tck  = fig.add_axes([_bx(4), BY, BW, BH])
    btn_tck = Button(ax_tck, "Ticks: On", color="#1a4a1a", hovercolor="#2a6a2a")
    btn_tck.label.set_color("white")
    btn_tck.label.set_fontsize(8)

    def on_ticks(event):
        state['ticks'] = not state['ticks']
        btn_tck.label.set_text("Ticks: On" if state['ticks'] else "Ticks: Off")
        btn_tck.ax.set_facecolor("#1a4a1a" if state['ticks'] else "#4a1a1a")
        _rebuild()
        fig.canvas.draw_idle()

    btn_tck.on_clicked(on_ticks)

    # ── Play callbacks ────────────────────────────────────────
    playing = [False]

    def _start(audio_to_play, label):
        global _t0
        _t0 = None
        cursor_s.set_xdata([-2, -2])
        cursor_r.set_xdata([-2, -2])
        playing[0] = True
        print(f"\n▶  {label}")
        play_async(audio_to_play)

    def on_play_left(event):
        a = state['audio'].copy()
        a[:, 1] = 0.0
        _start(a, "Traffic only  (left ear)")

    def on_play_both(event):
        _start(state['audio'], "Both channels")

    def on_play_right(event):
        a = state['audio'].copy()
        a[:, 0] = 0.0
        _start(a, "Revenue only  (right ear)")

    btn_left.on_clicked(on_play_left)
    btn_both.on_clicked(on_play_both)
    btn_right.on_clicked(on_play_right)

    # keep a ref so btn isn't shadowed below
    btn = btn_both

    # ── Animation — cursors glide smoothly with the audio ─────
    def animate(frame):
        global _t0
        if _t0 is None or not playing[0]:
            return cursor_s, cursor_r
        elapsed  = time.time() - _t0
        day      = elapsed / AUDIO_DURATION * 29
        day      = max(0, min(day, 29))
        rev_day  = max(0, day - lag_days)
        cursor_s.set_xdata([day, day])
        cursor_r.set_xdata([rev_day, rev_day])
        return cursor_s, cursor_r

    ani = FuncAnimation(fig, animate, interval=40,
                        blit=False, cache_frame_data=False)

    # Return all button refs to prevent garbage collection
    return fig, ani, btn, btn_mode, btn_left, btn_right, btn_tck


def _style(ax):
    ax.set_facecolor("#111111")
    for sp in ax.spines.values():
        sp.set_color("#333")
    ax.tick_params(colors="#aaa", labelsize=8)


# ─────────────────────────────────────────────
# 5. MAIN
# ─────────────────────────────────────────────
def main():
    print(f"\nSample rate: {SAMPLE_RATE} Hz")
    print("Generating data and audio...")

    days, sessions, revenue = generate_data()

    s = (sessions - sessions.mean()) / sessions.std()
    r = (revenue  - revenue.mean())  / revenue.std()
    best_lag, best_corr = 1, -1
    for lag in range(0, 4):
        if lag == 0:
            c = float(np.mean(s * r))
        else:
            c = float(np.mean(s[:-lag] * r[lag:]))
        if c > best_corr:
            best_corr, best_lag = c, lag

    print(f"Detected lag: {best_lag} day(s)  (correlation = {best_corr:.3f})")

    audio = build_audio(sessions, revenue, lag_days=best_lag,
                        mode='continuous', ticks=True)
    fig, ani, btn, btn_mode, btn_left, btn_right, btn_tck = build_dashboard(
        days, sessions, revenue, audio, lag_days=best_lag)

    print("\nClick  ▶ Play  in the window.")
    print("Toggle  Sound: Continuous / Per-Day  and  Ticks: On / Off")
    print("Use headphones for the clearest stereo separation.\n")
    plt.show()


if __name__ == "__main__":
    main()
