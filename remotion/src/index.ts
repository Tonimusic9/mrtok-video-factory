/**
 * Remotion entry-point — registra o RemotionRoot para o CLI.
 *
 * Este arquivo é consumido por `npx remotion render src/index.ts MrTokVideo ...`
 * na VPS Hostinger, após o rsync do `./remotion/src/` orquestrado pelo
 * `scripts/deploy-render.sh`.
 */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
