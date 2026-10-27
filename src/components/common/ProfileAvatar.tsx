import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/supabase/AuthProvider";

export function ProfileAvatar({
  className,
}: {
  className?: string | undefined;
}) {
  const { client, profile } = useAuth();
  const image = useQuery({
    queryKey: ["profile-avatar", profile?.user_id, profile?.avatar_path],
    enabled: Boolean(client && profile?.avatar_path),
    queryFn: async () => {
      if (!client || !profile?.avatar_path) return null;
      const { data, error } = await client.storage
        .from("isp-profile-photos")
        .createSignedUrl(profile.avatar_path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  const initials =
    profile?.full_name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "ISP";
  return (
    <Avatar className={className}>
      <AvatarImage
        src={image.data ?? undefined}
        alt={profile?.full_name ?? "Foto do perfil"}
      />
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
