/**
 * Schemas Zod do Upload-Post API.
 * Espelha §4.2 de /knowledge/mrtok-reverse-engineering.md (payload canônico).
 */
import { z } from "zod";

/** Plataformas suportadas pelo broadcast single-call do Upload-Post (§4.3). */
export const uploadPostPlatformSchema = z.enum([
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "x",
  "threads",
  "pinterest",
  "reddit",
  "bluesky",
]);
export type UploadPostPlatform = z.infer<typeof uploadPostPlatformSchema>;

export const uploadPostPhotoSchema = z.object({
  order: z.number().int().positive(),
  url: z.string().url(),
});
export type UploadPostPhoto = z.infer<typeof uploadPostPhotoSchema>;

export const uploadPostMetadataSchema = z.object({
  project_id: z.string().min(1),
  creative_matrix_id: z.string().uuid(),
  unique_pixel_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type UploadPostMetadata = z.infer<typeof uploadPostMetadataSchema>;

export const uploadPostRequestSchema = z.object({
  profile: z.string().min(1),
  platforms: z.array(uploadPostPlatformSchema).min(1),
  caption: z.string().min(1),
  photos: z.array(uploadPostPhotoSchema).min(1),
  schedule_iso: z.string().datetime().nullable().default(null),
  metadata: uploadPostMetadataSchema,
});
export type UploadPostRequest = z.infer<typeof uploadPostRequestSchema>;

export const uploadPostResponseSchema = z.object({
  request_id: z.string().min(1),
  status: z.string().min(1),
});
export type UploadPostResponse = z.infer<typeof uploadPostResponseSchema>;

export const uploadPostStatusResponseSchema = z
  .object({
    request_id: z.string(),
    status: z.string(),
  })
  .passthrough();
export type UploadPostStatusResponse = z.infer<
  typeof uploadPostStatusResponseSchema
>;
