/**
 * Root — Registry de composições Remotion do MrTok.
 *
 * Registra a composição `MrTokVideo` com dimensões 1080×1920 (9:16) a 30fps.
 * As props reais vêm do RenderManifest passado como inputProps no render.
 */
import React from "react";
import { Composition } from "remotion";
import { MrTokVideo } from "./MrTokVideo";

const defaultProps = {
  fps: 30 as const,
  width: 1080 as const,
  height: 1920 as const,
  clips: [] as never[],
  pixel_hash: { scale: 1.01, rotation_deg: 0.05 },
  total_duration_frames: 630,
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MrTokVideo"
      component={MrTokVideo}
      durationInFrames={630}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
  );
};
