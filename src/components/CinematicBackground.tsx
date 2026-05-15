"use client";

import { useEffect, useMemo, useState } from "react";

export type BackgroundMode = "initial" | "processing" | "success";

type Props = {
  mode: BackgroundMode;
};

const PROCESSING_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4";
const SUCCESS_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260511_230229_7c9bc431-46cf-489a-948d-e8144d8eb5d4.mp4";
const INITIAL_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_080021_d598092b-c4c2-4e53-8e46-94cf9064cd50.mp4";

function modeVideo(mode: BackgroundMode) {
  if (mode === "initial") return INITIAL_VIDEO_URL;
  if (mode === "processing") return PROCESSING_VIDEO_URL;
  if (mode === "success") return SUCCESS_VIDEO_URL;
  return undefined;
}

export function CinematicBackground({ mode }: Props) {
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setVideoFailed(false);
  }, [mode]);

  const videoUrl = useMemo(() => modeVideo(mode), [mode]);

  return (
    <>
      <div className={`embudo-bg-base embudo-bg-${mode}`} aria-hidden />

      {videoUrl && !videoFailed && (
        <video
          key={videoUrl}
          className={`embudo-bg-video ${mode === "processing" ? "embudo-bg-video-processing" : "embudo-bg-video-initial"}`}
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          onError={() => setVideoFailed(true)}
        />
      )}

      <div className={`embudo-bg-overlay embudo-bg-overlay-${mode}`} aria-hidden />
      <div className={`embudo-bg-gradient embudo-bg-gradient-${mode}`} aria-hidden />
    </>
  );
}
