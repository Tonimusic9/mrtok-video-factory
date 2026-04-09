/**
 * PixelHashWrapper — Unique Pixel Hash para blindagem algorítmica (CLAUDE.md §4).
 *
 * Aplica escala ~1.01x + rotação ~0.1° ao conteúdo inteiro, garantindo
 * que cada exportação tenha hash de pixel diferente. Valores vêm do
 * RenderManifest (gerados aleatoriamente pelo GLM 5.1).
 */
import React from "react";

interface PixelHashWrapperProps {
  scale: number;
  rotationDeg: number;
  children: React.ReactNode;
}

export const PixelHashWrapper: React.FC<PixelHashWrapperProps> = ({
  scale,
  rotationDeg,
  children,
}) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        transform: `scale(${scale}) rotate(${rotationDeg}deg)`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  );
};
