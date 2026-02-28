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

export function usePlaybackQueue() {
  const [queue, setQueue] = useState([]);
  const [activeItemId, setActiveItemId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [error, setError] = useState("");
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
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

    audio.onended = () => {
      setQueue((prevQueue) =>
        prevQueue.map((item) => ({
          ...item,
          status: item.id === currentItem.id ? "played" : item.status,
        })),
      );
      playQueueIndex(queueItems, index + 1);
    };

    audio.onerror = () => {
      setError(`Failed to play "${currentItem.label}"`);
      setIsPlaying(false);
      setActiveItemId("");
    };

    audio.play().catch(() => {
      setError(`Playback was blocked for "${currentItem.label}"`);
      setIsPlaying(false);
      setActiveItemId("");
    });
  }, []);

  const enqueueResponseAudio = useCallback((audioItems, rate = playbackRate) => {
    const normalized = normalizeAudioQueue(audioItems, rate);
    setQueue(normalized);
    setActiveItemId("");
    setError("");
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

  return {
    queue,
    activeItemId,
    isPlaying,
    playbackRate,
    error,
    statusLabel,
    enqueueResponseAudio,
    replay,
    stop,
    setPlaybackRate,
  };
}

