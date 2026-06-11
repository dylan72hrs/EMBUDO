"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type BackgroundMode = "initial" | "processing" | "success";

type Props = {
  mode: BackgroundMode;
};

const INITIAL_VIDEO_URL = "/videos/embudo-inicio.mp4";
const PROCESSING_VIDEO_URL = "/videos/embudo-procesamiento.mp4";
const SUCCESS_VIDEO_URL = "/videos/embudo-final.mp4";

function modeVideo(mode: BackgroundMode) {
  if (mode === "initial") return INITIAL_VIDEO_URL;
  if (mode === "processing") return PROCESSING_VIDEO_URL;
  if (mode === "success") return SUCCESS_VIDEO_URL;
  return undefined;
}

export function CinematicBackground({ mode }: Props) {
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setVideoFailed(false);
  }, [mode]);

  const videoUrl = useMemo(() => modeVideo(mode), [mode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || videoFailed) return;

    let rafId: number | undefined;
    let restartTimeoutId: number | undefined;
    let fadingOut = false;

    const fadeIn = () => {
      video.style.transition = "opacity 0.5s ease";
      video.style.opacity = "1";
    };

    const startPlayback = () => {
      video.style.opacity = "0";
      video.currentTime = 0;
      void video.play().then(() => {
        requestAnimationFrame(fadeIn);
      });
    };

    const tick = () => {
      const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
      if (hasDuration) {
        const remaining = video.duration - video.currentTime;
        if (remaining <= 0.5 && !fadingOut) {
          fadingOut = true;
          video.style.transition = "opacity 0.5s ease";
          video.style.opacity = "0";
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    const handleEnded = () => {
      fadingOut = false;
      video.style.opacity = "0";
      restartTimeoutId = window.setTimeout(() => {
        startPlayback();
      }, 100);
    };

    video.addEventListener("ended", handleEnded);
    startPlayback();
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (restartTimeoutId) window.clearTimeout(restartTimeoutId);
      video.removeEventListener("ended", handleEnded);
    };
  }, [videoFailed, videoUrl]);

  return (
    <>
      <div className={`embudo-bg-base embudo-bg-${mode}`} aria-hidden />

      {videoUrl && !videoFailed && (
        <video
          ref={videoRef}
          key={videoUrl}
          className={`embudo-bg-video ${mode === "processing" ? "embudo-bg-video-processing" : "embudo-bg-video-initial"}`}
          src={videoUrl}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-hidden
          onError={() => setVideoFailed(true)}
        />
      )}

      {mode === "success" && <div className="embudo-bg-success-hero-blur" aria-hidden />}
      <div className={`embudo-bg-overlay embudo-bg-overlay-${mode}`} aria-hidden />
      <div className={`embudo-bg-gradient embudo-bg-gradient-${mode}`} aria-hidden />
    </>
  );
}
