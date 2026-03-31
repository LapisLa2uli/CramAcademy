import { redirect } from "next/navigation";

export default function ModerationIndexPage() {
  redirect("/dashboard/moderation/queue");
}
