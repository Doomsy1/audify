import { useCallback, useMemo, useRef, useState } from "react";

function clampPlaybackRate(playbackRate) {
  const numericRate = Number(playbackRate);
  if (!Number.isFinite(numericRate)) {
    return 1;
  }
  return Math.max(0.5, Math.min(2, numericRate));
}

function sortAudioItems(audioItems) {
  return [...audioItems].sort((a, b) => {
    if (a.type === b.type) {
      return 0;
    }
    if (a.type === "tts") {
      return -1;
    }
    if (b.type === "tts") {
      return 1;
    }
    return 0;
  });
}

export function normalizeAudioQueue(audioItems = [], playbackRate = 1) {
  const stablePlaybackRate = clampPlaybackRate(playbackRate);

  return sortAudioItems(audioItems).map((item, index) => ({
    id: `clip_${index + 1}`,
    type: item.type,
    label: item.label,
    audio_url: item.audio_url,
    playback_rate: stablePlaybackRate,
    status: "queued",
  }));
}

export function applyPlaybackRateToQueue(queue, playbackRate) {
  const stablePlaybackRate = clampPlaybackRate(playbackRate);
  return queue.map((item) => ({
    ...item,
    playback_rate: stablePlaybackRate,
  }));
}

export function computeVisualProgress({
  queue = [],
  activeItemId = "",
  activeProgress = 0,
}) {
  const sonificationItems = queue.filter((item) => item.type === "sonification");
  if (!sonificationItems.length) {
    return Math.max(0, Math.min(1, Number(activeProgress) || 0));
  }

  const total = sonificationItems.length;
  const playedCount = sonificationItems.filter((item) => item.status === "played").length;
  const activeIndex = sonificationItems.findIndex((item) => item.id === activeItemId);
  if (activeIndex >= 0) {
    const stableProgress = Math.max(0, Math.min(1, Number(activeProgress) || 0));
    return Math.max(0, Math.min(1, (playedCount + stableProgress) / total));
  }

  return Math.max(0, Math.min(1, playedCount / total));
}

export function usePlaybackQueue() {
  const [queue, setQueue] = useState([]);
  const [activeItemId, setActiveItemId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [error, setError] = useState("");
  const [activeProgress, setActiveProgress] = useState(0);
  const [activeCurrentTime, setActiveCurrentTime] = useState(0);
  const [activeDuration, setActiveDuration] = useState(0);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
    setActiveProgress(0);
    setActiveCurrentTime(0);
    setActiveDuration(0);
  }, []);

  const playQueueIndex = useCallback((queueItems, index) => {
    if (index >= queueItems.length) {
      setIsPlaying(false);
      setActiveItemId("");
      return;
    }

    const currentItem = queueItems[index];
    const audio = new Audio(currentItem.audio_url);
    audio.playbackRate = currentItem.playback_rate;
    audioRef.current = audio;
    setIsPlaying(true);
    setActiveItemId(currentItem.id);
    setActiveProgress(0);
    setActiveCurrentTime(0);
    setActiveDuration(0);
    setQueue((prevQueue) =>
      prevQueue.map((item) => ({
        ...item,
        status:
          item.id === currentItem.id
            ? "playing"
            : item.status === "playing"
              ? "played"
              : item.status,
      })),
    );

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setActiveDuration(audio.duration);
      }
    };

    audio.ontimeupdate = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const progress = duration ? Math.max(0, Math.min(1, audio.currentTime / duration)) : 0;
      setActiveCurrentTime(audio.currentTime || 0);
      setActiveDuration(duration);
      setActiveProgress(progress);
    };

    audio.onended = () => {
      setQueue((prevQueue) =>
        prevQueue.map((item) => ({
          ...item,
          status: item.id === currentItem.id ? "played" : item.status,
        })),
      );
      setActiveProgress(1);
      playQueueIndex(queueItems, index + 1);
    };

    audio.onerror = () => {
      setError(`Failed to play "${currentItem.label}"`);
      setIsPlaying(false);
      setActiveItemId("");
      setActiveProgress(0);
    };

    audio.play().catch(() => {
      setError(`Playback was blocked for "${currentItem.label}"`);
      setIsPlaying(false);
      setActiveItemId("");
      setActiveProgress(0);
    });
  }, []);

  const enqueueResponseAudio = useCallback((audioItems, rate = playbackRate) => {
    const normalized = normalizeAudioQueue(audioItems, rate);
    setQueue(normalized);
    setActiveItemId("");
    setError("");
    setActiveProgress(0);
    setActiveCurrentTime(0);
    setActiveDuration(0);
    return normalized;
  }, [playbackRate]);

  const replay = useCallback(() => {
    if (!queue.length) {
      return;
    }
    stop();
    setQueue((prevQueue) =>
      prevQueue.map((item) => ({
        ...item,
        status: "queued",
      })),
    );
    playQueueIndex(queue, 0);
  }, [playQueueIndex, queue, stop]);

  const setPlaybackRate = useCallback((nextRate) => {
    setPlaybackRateState(clampPlaybackRate(nextRate));
    setQueue((prevQueue) => applyPlaybackRateToQueue(prevQueue, nextRate));
    if (audioRef.current) {
      audioRef.current.playbackRate = clampPlaybackRate(nextRate);
    }
  }, []);

  const statusLabel = useMemo(() => {
    if (error) {
      return `Error: ${error}`;
    }
    if (isPlaying) {
      return "Playing queue";
    }
    if (queue.length) {
      return "Ready to replay";
    }
    return "No audio queued";
  }, [error, isPlaying, queue.length]);

  const visualProgress = useMemo(() => (
    computeVisualProgress({
      queue,
      activeItemId,
      activeProgress,
    })
  ), [activeItemId, activeProgress, queue]);

  return {
    queue,
    activeItemId,
    isPlaying,
    playbackRate,
    error,
    statusLabel,
    activeProgress,
    visualProgress,
    activeCurrentTime,
    activeDuration,
    enqueueResponseAudio,
    replay,
    stop,
    setPlaybackRate,
  };
}

