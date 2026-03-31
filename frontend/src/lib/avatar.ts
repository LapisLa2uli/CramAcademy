/** Grey placeholder when the user has not set a custom photo (served from /public). */
export const AVATAR_PLACEHOLDER = "/avatar-placeholder.svg";

export function profileAvatarSrc(avatarUrl: string | null | undefined): string {
  const u = avatarUrl?.trim();
  if (!u) return AVATAR_PLACEHOLDER;
  return u;
}
