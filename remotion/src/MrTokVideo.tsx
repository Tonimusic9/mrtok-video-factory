/**
 * MrTokVideo — Composição principal do MrTok (Tarefa 10).
 *
 * Recebe um RenderManifest como inputProps e compõe 3 clips sequenciais
 * (hook → body → cta) com transições e Unique Pixel Hash.
 *
 * Transições suportadas:
 *   - "cut"      : corte seco (sem efeito)
 *   - "fade"     : fade-in de 10 frames
 *   - "slide_up" : slide vertical de 10 frames
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

/**
 * Resolve `video_url` do manifest para um src que o Remotion consegue baixar.
 * URLs absolutas (http/https/file) passam direto; paths relativos são
 * resolvidos via `staticFile()` contra o diretório `public/` do bundle.
 */
const resolveVideoSrc = (videoUrl: string): string => {
  if (/^(https?:|file:)/i.test(videoUrl)) return videoUrl;
  return staticFile(videoUrl);
};
import { PixelHashWrapper } from "./PixelHashWrapper";

/** Número de frames para transições (fade/slide_up). */
const TRANSITION_FRAMES = 10;

interface TextOverlay {
  text: string;
  position: "top" | "center" | "bottom";
  style: "ugc_caption" | "cta_bold";
}

interface Clip {
  block: "hook" | "body" | "cta";
  video_url: string;
  start_frame: number;
  duration_frames: number;
  transition_in: "cut" | "fade" | "slide_up";
  text_overlay?: TextOverlay;
}

interface PixelHash {
  scale: number;
  rotation_deg: number;
}

export interface MrTokVideoProps {
  fps: number;
  width: number;
  height: number;
  clips: Clip[];
  pixel_hash: PixelHash;
  total_duration_frames: number;
  [key: string]: unknown;
}

const POSITION_MAP: Record<TextOverlay["position"], React.CSSProperties> = {
  top: { top: 60, left: 0, right: 0 },
  center: { top: "50%", left: 0, right: 0, transform: "translateY(-50%)" },
  bottom: { bottom: 120, left: 0, right: 0 },
};

const STYLE_MAP: Record<TextOverlay["style"], React.CSSProperties> = {
  ugc_caption: {
    fontSize: 36,
    fontWeight: 500,
    color: "white",
    textShadow: "0 2px 8px rgba(0,0,0,0.7)",
    textAlign: "center",
    padding: "0 24px",
  },
  cta_bold: {
    fontSize: 48,
    fontWeight: 800,
    color: "white",
    textShadow: "0 3px 12px rgba(0,0,0,0.8)",
    textAlign: "center",
    padding: "0 24px",
  },
};

const ClipWithTransition: React.FC<{
  clip: Clip;
}> = ({ clip }) => {
  const frame = useCurrentFrame();

  let opacity = 1;
  let translateY = 0;

  if (clip.transition_in === "fade") {
    opacity = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  } else if (clip.transition_in === "slide_up") {
    translateY = interpolate(frame, [0, TRANSITION_FRAMES], [100, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${translateY}%)`,
      }}
    >
      <OffthreadVideo src={resolveVideoSrc(clip.video_url)} style={{ width: "100%", height: "100%" }} />
      {clip.text_overlay && (
        <div
          style={{
            position: "absolute",
            ...POSITION_MAP[clip.text_overlay.position],
            ...STYLE_MAP[clip.text_overlay.style],
          }}
        >
          {clip.text_overlay.text}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const MrTokVideo: React.FC<MrTokVideoProps> = (props) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <PixelHashWrapper
        scale={props.pixel_hash.scale}
        rotationDeg={props.pixel_hash.rotation_deg}
      >
        {props.clips.map((clip) => (
          <Sequence
            key={clip.block}
            from={clip.start_frame}
            durationInFrames={clip.duration_frames}
          >
            <ClipWithTransition clip={clip} />
          </Sequence>
        ))}
      </PixelHashWrapper>
    </AbsoluteFill>
  );
};
