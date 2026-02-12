import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Comment {
  id: string;
  content: string;
  user_id: string | null;
  created_at: string;
  profile?: { display_name: string | null; email: string | null };
}

export default function PhotoComments({ photoId }: { photoId: string }) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadComments();

    const channel = supabase
      .channel(`comments-${photoId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `photo_id=eq.${photoId}` }, () => loadComments())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [photoId]);

  async function loadComments() {
    const { data } = await supabase
      .from("comments")
      .select("*")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: true });

    if (data) {
      // Fetch profiles for commenter names
      const userIds = [...new Set(data.map((c) => c.user_id).filter(Boolean))] as string[];
      const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);
      const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

      setComments(
        data.map((c) => ({
          ...c,
          profile: c.user_id ? profileMap.get(c.user_id) : undefined,
        }))
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || !user) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.from("comments").insert({
        photo_id: photoId,
        user_id: user.id,
        content: content.trim(),
      });
      if (error) throw error;
      setContent("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
  }

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <div className="max-h-60 space-y-3 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="group flex gap-2 text-sm">
              <div className="flex-1">
                <span className="font-medium">
                  {c.profile?.display_name || c.profile?.email?.split("@")[0] || "Unknown"}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                </span>
                <p className="mt-0.5 text-muted-foreground">{c.content}</p>
              </div>
              {(c.user_id === user?.id || isAdmin) && (
                <button
                  onClick={() => handleDelete(c.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a comment..."
          rows={1}
          className="min-h-[40px] resize-none"
        />
        <Button type="submit" size="icon" disabled={!content.trim() || submitting}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
