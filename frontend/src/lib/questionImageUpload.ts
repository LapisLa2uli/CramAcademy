import { supabase } from "./supabase";

const BUCKET = "question-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadQuestionImage(
  userId: string,
  file: File
): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error("Please use a JPEG, PNG, WebP, or GIF image.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }
  const ext =
    file.name.split(".").pop()?.toLowerCase().replace("jpeg", "jpg") || "jpg";
  const safeExt = ["jpg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${safeExt}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) {
    let msg = error.message;
    if (/bucket not found|not found/i.test(msg)) {
      msg =
        'Storage bucket "question-images" is missing. In Supabase: open SQL Editor and run ' +
        "database/storage_bucket_question_images.sql (or Storage → New bucket → name: question-images, public).";
    }
    throw new Error(msg);
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
