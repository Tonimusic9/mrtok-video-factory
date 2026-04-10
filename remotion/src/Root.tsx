/**
 * Root — Registry de composições Remotion do MrTok.
 *
 * Registra a composição `MrTokVideo` com dimensões 720×1280 (9:16 720p) a 30fps
 * — resolução canônica v2.0 do ecossistema MrTok (proibido 1080p/4K).
 * As props reais vêm do RenderManifest passado como inputProps no render.
 */
import React from "react";
import { Composition } from "remotion";
import { MrTokVideo } from "./MrTokVideo";

const defaultProps = {
  fps: 30 as const,
  width: 720 as const,
  height: 1280 as const,
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
      width={720}
      height={1280}
      defaultProps={defaultProps}
    />
  );
};
