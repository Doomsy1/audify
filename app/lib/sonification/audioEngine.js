const BASE_FREQUENCY = 220;
const MASTER_GAIN = 0.12;
const OSC_GAIN = 0.5;
const ATTACK_SECONDS = 0.04;
const RELEASE_SECONDS = 0.12;
const GLIDE_SECONDS = 0.07;
const UPDATE_INTERVAL_STEPS = 2;
const MIN_STATE_HOLD_STEPS = 2;
const SEEK_THROTTLE_MS = 30;
const TRITONE_RATIO = Math.SQRT2;

export const CHORD_RATIOS = {
  fifth: 3 / 2,
  third: 5 / 4,
  unison: 1,
  tritone: TRITONE_RATIO,
};

export const CHORD_NAMES = {
  fifth: "perfect fifth (3:2)",
  third: "major third (5:4)",
  unison: "unison (1:1)",
  tritone: "tritone (sqrt(2):1)",
};

function ramp(param, now, target, seconds = GLIDE_SECONDS) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

function playEventTick(ctx) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.value = 0;

    osc.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.006);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);

    osc.start(now);
    osc.stop(now + 0.09);
  } catch (_) {
    // Ignore one-shot tick failures.
  }
}

function chordStateFromRhoE(rhoE) {
  const r = rhoE ?? 0;
  if (r > 0.65) return "fifth";
  if (r > 0.25) return "third";
  if (r < -0.25) return "tritone";
  return "unison";
}

function updateChordState(current, rhoE) {
  const r = rhoE ?? 0;

  switch (current) {
    case "fifth":
      if (r < 0.55) return r > 0.25 ? "third" : r < -0.25 ? "tritone" : "unison";
      return "fifth";
    case "third":
      if (r > 0.65) return "fifth";
      if (r < 0.15) return r < -0.25 ? "tritone" : "unison";
      return "third";
    case "tritone":
      if (r > -0.15) return r > 0.65 ? "fifth" : r > 0.25 ? "third" : "unison";
      return "tritone";
    default:
      if (r > 0.65) return "fifth";
      if (r > 0.25) return "third";
      if (r < -0.25) return "tritone";
      return "unison";
  }
}

export function createSonificationAudioEngine({
  getAnalytics,
  getSelection,
  getMsPerDay,
  getLoop,
  getIsDragging,
  getIsScrubbing,
  onStepChange,
  onPlayingChange,
  onChordStateChange,
  onActiveChange,
}) {
  let ctx = null;
  let masterGain = null;
  let osc1 = null;
  let osc2 = null;
  let osc1Gain = null;
  let osc2Gain = null;
  let echoDelay = null;
  let timer = null;
  let currentIndex = 0;
  let enabledLayers = {
    harmony: true,
    tension: false,
    echo: false,
    events: false,
  };
  let renderMode = "deterministic";
  let aiPlan = null;
  let chordState = "unison";
  let stateHoldRemaining = 0;
  let stepsSinceChordEval = 0;
  let lastPlaybackAudioUpdateAt = 0;
  let lastEventIndex = null;

  function setPlaying(nextPlaying) {
    onPlayingChange?.(nextPlaying);
  }

  function setActive(nextActive) {
    onActiveChange?.(nextActive);
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getActivePlanSegment(index = currentIndex) {
    if (renderMode !== "ai" || !aiPlan?.audio_plan?.segments?.length) return null;
    const { start, end } = getSelection();
    const relativeIndex = clamp(index - start, 0, Math.max(0, end - start));
    return aiPlan.audio_plan.segments.find((segment) => (
      relativeIndex >= segment.startStep && relativeIndex <= segment.endStep
    )) ?? null;
  }

  function currentSnapshot(index = currentIndex) {
    const { rhoE, divE, lags, shifts } = getAnalytics();
    const activeSegment = getActivePlanSegment(index);
    return {
      rho: rhoE[index] ?? 0,
      div: divE[index] ?? 0,
      lag: lags[index] ?? 0,
      isShift: shifts.has(index),
      activeSegment,
    };
  }

  function applyLayerMix(index = currentIndex) {
    if (!ctx || !masterGain || !osc1Gain || !osc2Gain || !echoDelay) return;

    const { rho, div, lag, activeSegment } = currentSnapshot(index);
    const now = ctx.currentTime;
    const harmonyGain = enabledLayers.harmony ? MASTER_GAIN : 0;
    const deterministicAlignment = 0.6 + 0.4 * clamp(Math.abs(rho), 0, 1);
    const deterministicTension = enabledLayers.tension ? Math.max(0.82, 1 - (div * 0.05)) : 1;
    const planTension = activeSegment ? clamp(activeSegment.tension, 0, 1) : 0;
    const planGain = 0.9 - (0.18 * planTension);
    const salesGain = renderMode === "ai" && activeSegment
      ? OSC_GAIN * (enabledLayers.tension ? planGain : 1)
      : OSC_GAIN * deterministicAlignment * deterministicTension;
    const delayTime = renderMode === "ai" && activeSegment
      ? (enabledLayers.echo ? clamp(activeSegment.echo_ms / 1000, 0, 0.22) : 0)
      : enabledLayers.echo && Math.abs(lag) >= 2
        ? Math.min(0.08, Math.abs(lag) * 0.015)
        : 0;

    ramp(masterGain.gain, now, harmonyGain, 0.05);
    ramp(osc1Gain.gain, now, OSC_GAIN, 0.06);
    ramp(osc2Gain.gain, now, salesGain, 0.06);
    ramp(echoDelay.delayTime, now, delayTime, 0.06);
  }

  function applyPlaybackIndex(index, { force = false } = {}) {
    currentIndex = index;
    onStepChange?.(currentIndex);

    if (!ctx || !osc1 || !osc2) return;

    const nowMs = Date.now();
    if (!force && nowMs - lastPlaybackAudioUpdateAt < SEEK_THROTTLE_MS) return;
    lastPlaybackAudioUpdateAt = nowMs;

    const { rho, activeSegment } = currentSnapshot(currentIndex);
    const now = ctx.currentTime;
    const nextState = renderMode === "ai" && activeSegment
      ? activeSegment.chord
      : chordStateFromRhoE(rho);

    chordState = nextState;
    stateHoldRemaining = MIN_STATE_HOLD_STEPS;
    stepsSinceChordEval = 0;
    onChordStateChange?.(nextState);

    ramp(osc1.frequency, now, BASE_FREQUENCY, 0.05);
    ramp(osc2.frequency, now, BASE_FREQUENCY * CHORD_RATIOS[nextState], 0.05);
    applyLayerMix(currentIndex);
  }

  function scheduleNextTick() {
    clearTimer();
    timer = setTimeout(tick, getMsPerDay());
  }

  function finishPlayback() {
    if (!ctx || !masterGain) {
      setPlaying(false);
      return;
    }

    const now = ctx.currentTime;
    ramp(masterGain.gain, now, 0, 0.06);
    setPlaying(false);
  }

  function tick() {
    if (!ctx) return;

    if (getIsDragging?.() || getIsScrubbing?.()) {
      timer = setTimeout(tick, 50);
      return;
    }

    const { start, end } = getSelection();
    const index = currentIndex;

    if (index > end) {
      if (getLoop()) {
        lastEventIndex = null;
        applyPlaybackIndex(start, { force: true });
        scheduleNextTick();
      } else {
        currentIndex = end;
        onStepChange?.(end);
        finishPlayback();
      }
      return;
    }

    const { rho, isShift, activeSegment } = currentSnapshot(index);
    const now = ctx.currentTime;

    if (renderMode === "ai" && activeSegment) {
      if (activeSegment.chord !== chordState) {
        chordState = activeSegment.chord;
        onChordStateChange?.(activeSegment.chord);
        ramp(osc2.frequency, now, BASE_FREQUENCY * CHORD_RATIOS[activeSegment.chord]);
      }
    } else {
      if (stateHoldRemaining > 0) stateHoldRemaining -= 1;
      stepsSinceChordEval += 1;
      if (stateHoldRemaining === 0 && stepsSinceChordEval >= UPDATE_INTERVAL_STEPS) {
        stepsSinceChordEval = 0;
        const nextState = updateChordState(chordState, rho);
        if (nextState !== chordState) {
          chordState = nextState;
          stateHoldRemaining = MIN_STATE_HOLD_STEPS;
          onChordStateChange?.(nextState);
          ramp(osc2.frequency, now, BASE_FREQUENCY * CHORD_RATIOS[nextState]);
        }
      }
    }

    applyLayerMix(index);

    const shouldTick = renderMode === "ai" && activeSegment
      ? activeSegment.tick && index === (getSelection().start + activeSegment.startStep)
      : isShift;
    if (enabledLayers.events && shouldTick && lastEventIndex !== index) {
      lastEventIndex = index;
      playEventTick(ctx);
    }

    onStepChange?.(index);
    currentIndex = index + 1;
    scheduleNextTick();
  }

  function start() {
    if (ctx) return;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtor();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.value = BASE_FREQUENCY;
    osc1Gain = ctx.createGain();
    osc1Gain.gain.value = OSC_GAIN;
    osc1.connect(osc1Gain);
    osc1Gain.connect(masterGain);

    const { start: selectionStart } = getSelection();
    const initialRho = getAnalytics().rhoE[selectionStart] ?? 0;
    const initialSegment = getActivePlanSegment(selectionStart);
    chordState = renderMode === "ai" && initialSegment
      ? initialSegment.chord
      : chordStateFromRhoE(initialRho);
    stateHoldRemaining = MIN_STATE_HOLD_STEPS;
    stepsSinceChordEval = 0;
    lastEventIndex = null;
    onChordStateChange?.(chordState);

    osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.value = BASE_FREQUENCY * CHORD_RATIOS[chordState];

    echoDelay = ctx.createDelay(0.2);
    echoDelay.delayTime.value = 0;
    osc2Gain = ctx.createGain();
    osc2Gain.gain.value = OSC_GAIN;

    osc2.connect(echoDelay);
    echoDelay.connect(osc2Gain);
    osc2Gain.connect(masterGain);

    osc1.start();
    osc2.start();

    currentIndex = selectionStart;
    setActive(true);
    applyPlaybackIndex(selectionStart, { force: true });
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(
      enabledLayers.harmony ? MASTER_GAIN : 0,
      ctx.currentTime + ATTACK_SECONDS,
    );
    setPlaying(true);
    scheduleNextTick();
  }

  function pause() {
    if (!ctx || !masterGain) return;
    clearTimer();

    const now = ctx.currentTime;
    ramp(masterGain.gain, now, 0, ATTACK_SECONDS);
    setPlaying(false);
  }

  function resume() {
    if (!ctx || !masterGain) return;
    clearTimer();

    const now = ctx.currentTime;
    ramp(masterGain.gain, now, enabledLayers.harmony ? MASTER_GAIN : 0, ATTACK_SECONDS);
    setPlaying(true);
    scheduleNextTick();
  }

  function stop() {
    clearTimer();

    const oldCtx = ctx;
    const oldMaster = masterGain;
    const oldOsc1 = osc1;
    const oldOsc2 = osc2;

    ctx = null;
    masterGain = null;
    osc1 = null;
    osc2 = null;
    osc1Gain = null;
    osc2Gain = null;
    echoDelay = null;
    lastEventIndex = null;

    setPlaying(false);
    setActive(false);

    if (!oldCtx || !oldMaster) return;

    try {
      const now = oldCtx.currentTime;
      ramp(oldMaster.gain, now, 0, RELEASE_SECONDS);
    } catch (_) {
      // Ignore release ramp failures during teardown.
    }

    setTimeout(() => {
      try { oldOsc1?.stop(); } catch (_) {
        // Ignore stale oscillator stop calls.
      }
      try { oldOsc2?.stop(); } catch (_) {
        // Ignore stale oscillator stop calls.
      }
      try { oldCtx.close(); } catch (_) {
        // Ignore close races during teardown.
      }
    }, 140);
  }

  function beginScrub() {
    pause();
  }

  function endScrub(shouldResume) {
    if (shouldResume) {
      resume();
    } else if (ctx && masterGain) {
      const now = ctx.currentTime;
      ramp(masterGain.gain, now, enabledLayers.harmony ? MASTER_GAIN : 0, 0.05);
    }
  }

  return {
    start,
    pause,
    resume,
    beginScrub,
    endScrub,
    setRenderMode(nextMode) {
      renderMode = nextMode === "ai" ? "ai" : "deterministic";
      applyPlaybackIndex(currentIndex, { force: true });
    },
    setAiPlan(nextPlan) {
      aiPlan = nextPlan;
      applyPlaybackIndex(currentIndex, { force: true });
    },
    setEnabledLayers(nextLayers) {
      enabledLayers = { ...enabledLayers, ...nextLayers };
      applyLayerMix();
    },
    setPlaybackIndex(index) {
      applyPlaybackIndex(index);
    },
    stop,
    isActive() {
      return Boolean(ctx);
    },
  };
}
